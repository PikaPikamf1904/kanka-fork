// Geometry enhancement for printing. The chosen method (see docs/chronicle/STL-WORKSHOP.md for the
// measurements behind it): curvature-adaptive, interpolating refinement from manifold-3d.
//
//   smoothOut(minSharpAngle)  — fits a G1-continuous curved surface through the EXISTING vertices;
//                               edges sharper than the angle stay sharp; flat faces stay flat.
//   refineToTolerance(tol)    — splits edges only where the facets are further than `tol` from that
//                               curved surface, so curved areas gain resolution and flat ones do not.
//
// Every original vertex stays exactly where it was: no detail is moved, invented or "recovered". What
// changes is the faceting between vertices on curved surfaces. Parts that are not closed manifolds are
// passed through unchanged. Every result is measured against the original and refused if it degrades.
//
// The other methods here (midpoint, Loop, Taubin) exist so the choice can be re-measured; the workshop
// does not offer them.
import type { Mesh } from './mesh.ts';
import { buildEdges, components, signedVolume, surfaceArea, triangleCount } from './mesh.ts';
import { compare, type Comparison } from './metrics.ts';

// ---------- manifold-3d (loaded lazily by the caller: browser worker or test) ----------
export interface ManifoldModule {
  Manifold: {
    new (mesh: unknown): ManifoldObject;
  };
  Mesh: new (o: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array }) => { merge(): boolean };
}
export interface ManifoldObject {
  status(): unknown;
  numTri(): number;
  smoothOut(minSharpAngle?: number, minSmoothness?: number): ManifoldObject;
  refineToTolerance(tolerance: number): ManifoldObject;
  refineToLength(length: number): ManifoldObject;
  getMesh(): { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array };
  delete(): void;
}

export interface EnhanceSettings {
  /** 0 (gentle) … 1 (strong). Higher keeps fewer edges sharp and refines further. */
  strength: number;
  /** Triangle limit for the result (memory safety in a browser tab). */
  maxTriangles: number;
  /** Largest part sent to the geometry library (default MAX_REFINE_PART_TRIANGLES). */
  maxPartTriangles?: number;
}

/** Largest single part sent to the geometry library (memory: ~1.5 kB per triangle, measured). */
export const MAX_REFINE_PART_TRIANGLES = 750_000;

export function settingsFor(strength: number) {
  const s = Math.min(1, Math.max(0, strength));
  return {
    // Edges whose faces meet at more than this angle stay sharp (manifold-3d's default is 52.5°).
    minSharpAngle: 40 + s * 25, // 40° … 65°
    // Maximum distance of the printed facets from the smooth surface, mm. 34 µm is one printer pixel.
    toleranceMm: 0.012 - s * 0.009, // 12 µm … 3 µm
  };
}

/** Split a mesh into its connected parts (each with its own compact vertex list). Typed arrays only. */
export function splitParts(m: Mesh): Mesh[] {
  const comp = components(m, buildEdges(m));
  if (comp.count === 1) return [m];
  const nt = m.tri.length / 3, nv = m.pos.length / 3;
  // Counting sort of triangles by part, then one part at a time (a vertex touching two parts is copied).
  const start = new Uint32Array(comp.count + 1);
  for (let t = 0; t < nt; t++) { const i = comp.of[t]! + 1; start[i] = start[i]! + 1; }
  for (let c = 0; c < comp.count; c++) start[c + 1] = start[c + 1]! + start[c]!;
  const order = new Uint32Array(nt);
  const fill = start.slice(0, comp.count);
  for (let t = 0; t < nt; t++) order[fill[comp.of[t]!]!++] = t;
  const owner = new Int32Array(nv).fill(-1), local = new Uint32Array(nv);
  const parts: Mesh[] = [];
  for (let c = 0; c < comp.count; c++) {
    const n = start[c + 1]! - start[c]!;
    const tri = new Uint32Array(n * 3);
    const pos = new Float64Array(n * 9);
    let count = 0;
    for (let i = 0; i < n; i++) {
      const t = order[start[c]! + i]!;
      for (let k = 0; k < 3; k++) {
        const v = m.tri[t * 3 + k]!;
        if (owner[v] !== c) { owner[v] = c; local[v] = count; pos[count * 3] = m.pos[v * 3]!; pos[count * 3 + 1] = m.pos[v * 3 + 1]!; pos[count * 3 + 2] = m.pos[v * 3 + 2]!; count++; }
        tri[i * 3 + k] = local[v]!;
      }
    }
    parts.push({ pos: pos.slice(0, count * 3), tri });
  }
  return parts;
}

export function joinParts(parts: Mesh[]): Mesh {
  let nv = 0, nt = 0;
  for (const p of parts) { nv += p.pos.length / 3; nt += p.tri.length / 3; }
  const pos = new Float64Array(nv * 3), tri = new Uint32Array(nt * 3);
  let vo = 0, to = 0;
  for (const p of parts) {
    pos.set(p.pos, vo * 3);
    for (let i = 0; i < p.tri.length; i++) tri[to * 3 + i] = p.tri[i]! + vo;
    vo += p.pos.length / 3; to += p.tri.length / 3;
  }
  return { pos, tri };
}

/**
 * How far the flat facets lie from a smooth surface through the same vertices, estimated per edge: an
 * edge of length L between faces turned by θ is a chord of an arc of angle θ, whose sagitta is
 * L/2 · tan(θ/4). Edges sharper than `minSharpAngle` are intended creases and are skipped. This is the
 * most a smoothing refinement could move the surface: if it is below the printer's resolution, there is
 * nothing printable to gain.
 */
export function facetDeviation(m: Mesh, minSharpAngleDeg: number): { max: number; p95: number; smoothEdges: number } {
  const e = buildEdges(m);
  const nt = m.tri.length / 3;
  const n = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = m.tri[t * 3]! * 3, b = m.tri[t * 3 + 1]! * 3, c = m.tri[t * 3 + 2]! * 3;
    const ux = m.pos[b]! - m.pos[a]!, uy = m.pos[b + 1]! - m.pos[a + 1]!, uz = m.pos[b + 2]! - m.pos[a + 2]!;
    const vx = m.pos[c]! - m.pos[a]!, vy = m.pos[c + 1]! - m.pos[a + 1]!, vz = m.pos[c + 2]! - m.pos[a + 2]!;
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z) || 1;
    n[t * 3] = x / l; n[t * 3 + 1] = y / l; n[t * 3 + 2] = z / l;
  }
  const limit = (minSharpAngleDeg * Math.PI) / 180;
  const sag: number[] = [];
  let max = 0;
  for (let i = 0; i < e.count; i++) {
    if (e.uses[i] !== 2) continue;
    const f = e.f0[i]!, g = e.f1[i]!;
    const dot = Math.min(1, Math.max(-1, n[f * 3]! * n[g * 3]! + n[f * 3 + 1]! * n[g * 3 + 1]! + n[f * 3 + 2]! * n[g * 3 + 2]!));
    const th = Math.acos(dot);
    if (th >= limit) continue;
    const a = e.a[i]! * 3, b = e.b[i]! * 3;
    const L = Math.hypot(m.pos[a]! - m.pos[b]!, m.pos[a + 1]! - m.pos[b + 1]!, m.pos[a + 2]! - m.pos[b + 2]!);
    const s = (L / 2) * Math.tan(th / 4);
    if (s > max) max = s;
    if (sag.length < 400_000 || i % 7 === 0) sag.push(s);
  }
  sag.sort((x, y) => x - y);
  return { max, p95: sag[Math.floor(sag.length * 0.95)] ?? 0, smoothEdges: sag.length };
}

function isClosedManifold(m: Mesh): boolean {
  const e = buildEdges(m);
  for (let i = 0; i < e.count; i++) if (e.uses[i] !== 2 || e.d0[i] === e.d1[i]) return false;
  return true;
}

/** One part through manifold-3d. Returns null when the library refuses the part. */
function refinePart(M: ManifoldModule, part: Mesh, minSharpAngle: number, toleranceMm: number): Mesh | null {
  const mesh = new M.Mesh({ numProp: 3, vertProperties: Float32Array.from(part.pos), triVerts: part.tri });
  let base: ManifoldObject | null = null, smooth: ManifoldObject | null = null, fine: ManifoldObject | null = null;
  try {
    base = new M.Manifold(mesh);
    if (String(base.status()) !== 'NoError' && base.numTri() === 0) return null;
    if (base.numTri() !== part.tri.length / 3) return null; // the library merged or dropped faces: do not trust it
    smooth = base.smoothOut(minSharpAngle, 0);
    fine = smooth.refineToTolerance(toleranceMm);
    const out = fine.getMesh();
    const n = out.vertProperties.length / out.numProp;
    const pos = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = out.vertProperties[i * out.numProp + k]!;
    for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i]!)) return null;
    return { pos, tri: Uint32Array.from(out.triVerts) };
  } catch {
    return null;
  } finally {
    fine?.delete(); smooth?.delete(); base?.delete();
  }
}

export interface EnhanceResult {
  mesh: Mesh;
  /** Which parts were refined, and which were left as they were (with the reason). */
  partsRefined: number;
  partsUnchanged: { reason: string; triangles: number }[];
  settings: { minSharpAngle: number; toleranceMm: number };
  comparison: Comparison;
  verdict: 'improved' | 'no-visible-change' | 'rejected';
  message: string;
}

/**
 * Reasons to refuse a result. Generous enough for real curvature, strict enough to catch artefacts:
 * - no original vertex may move (this method only adds vertices between them);
 * - the surface may not move further than half a typical edge (a facet's curvature cannot justify more);
 * - the volume may only change as much as the measured surface movement explains.
 */
export function degradation(c: Comparison, medianEdgeMm: number, areaMm2 = 0, volumeMm3 = 0): string | null {
  const maxMove = Math.max(0.05, medianEdgeMm * 0.5);
  if (!Number.isFinite(c.hausdorff)) return 'the result could not be measured';
  if (c.originalVerticesToEnhanced && c.originalVerticesToEnhanced.max > 0.005) return `original vertices moved by up to ${(c.originalVerticesToEnhanced.max * 1000).toFixed(0)} µm: original detail would change`;
  if (c.enhancedToOriginal.max > maxMove) return `the surface moved up to ${(c.enhancedToOriginal.max * 1000).toFixed(0)} µm from the original (limit ${(maxMove * 1000).toFixed(0)} µm), which would change the design`;
  if (c.originalToEnhanced.max > maxMove) return `original surface points ended up ${(c.originalToEnhanced.max * 1000).toFixed(0)} µm from the result: detail could be lost`;
  const explained = areaMm2 > 0 ? (1.5 * areaMm2 * c.enhancedToOriginal.mean + 0.002 * Math.abs(volumeMm3)) / Math.max(Math.abs(volumeMm3), 1e-9) * 100 : 3;
  if (Math.abs(c.volumeChangePct) > explained) return `the volume changed by ${c.volumeChangePct.toFixed(1)} %, more than the surface movement explains (${explained.toFixed(1)} %)`;
  if (c.sizeChangeMm > Math.max(0.05, medianEdgeMm)) return `the overall size changed by ${(c.sizeChangeMm * 1000).toFixed(0)} µm`;
  return null;
}

/**
 * Enhance a (repaired) mesh. Tries the requested strength; if the result degrades the geometry, tries a
 * gentler setting once; if that also fails, returns the original unchanged with the reason.
 */
export function enhance(M: ManifoldModule, input: Mesh, settings: EnhanceSettings, medianEdgeMm: number, onProgress?: (fraction: number, label: string) => void): EnhanceResult {
  const parts = splitParts(input);
  const area = surfaceArea(input), volume = signedVolume(input);
  const attempt = (strength: number) => {
    const s = settingsFor(strength);
    const out: Mesh[] = [];
    const unchanged: { reason: string; triangles: number }[] = [];
    let refined = 0, alreadyFine = 0;
    parts.forEach((p, i) => {
      onProgress?.(i / parts.length, `Refining part ${i + 1} of ${parts.length}`);
      const nt = p.tri.length / 3;
      if (!isClosedManifold(p)) { out.push(p); unchanged.push({ reason: 'not a closed surface (open or non-manifold edges)', triangles: nt }); return; }
      // Already finer than the tolerance everywhere: refinement would add nothing (and would cost memory).
      if (facetDeviation(p, s.minSharpAngle).max < s.toleranceMm * 0.5) { out.push(p); alreadyFine++; return; }
      // The geometry library needs roughly 1.5 kB of memory per triangle; a browser tab cannot spare more.
      const partLimit = settings.maxPartTriangles ?? MAX_REFINE_PART_TRIANGLES;
      if (nt > partLimit) { out.push(p); unchanged.push({ reason: `too large to refine safely in a browser tab (${nt.toLocaleString()} triangles; limit ${partLimit.toLocaleString()} per part)`, triangles: nt }); return; }
      const r = refinePart(M, p, s.minSharpAngle, s.toleranceMm);
      if (!r) { out.push(p); unchanged.push({ reason: 'the geometry library could not process this part', triangles: nt }); return; }
      out.push(r); refined++;
    });
    return { mesh: refined > 0 ? joinParts(out) : input, refined, alreadyFine, unchanged, s };
  };
  let strength = settings.strength;
  for (let tryNo = 0; tryNo < 3; tryNo++) {
    const r = attempt(strength);
    const nt = triangleCount(r.mesh);
    if (nt > settings.maxTriangles) {
      if (tryNo < 2) { strength = Math.max(0, strength - 0.5); continue; }
      return { mesh: input, partsRefined: 0, partsUnchanged: [], settings: r.s, comparison: compare(input, input, 2000), verdict: 'rejected', message: `The enhanced model would have ${nt.toLocaleString()} triangles, more than this tab can safely handle (${settings.maxTriangles.toLocaleString()}). The original is kept. Try a lower strength.` };
    }
    onProgress?.(1, 'Measuring the result against the original');
    if (r.refined === 0) {
      // Nothing was changed: the measurements are zero by construction.
      const z = { mean: 0, rms: 0, p95: 0, max: 0 };
      return { mesh: input, partsRefined: 0, partsUnchanged: r.unchanged, settings: r.s, comparison: { enhancedToOriginal: z, originalToEnhanced: z, originalVerticesToEnhanced: z, hausdorff: 0, volumeChangePct: 0, sizeChangeMm: 0 }, verdict: 'no-visible-change',
        message: r.alreadyFine > 0 && r.unchanged.length === 0
          ? `The model's curved surfaces are already within ${(r.s.toleranceMm * 500).toFixed(0)} µm of a smooth surface, far finer than the printer's ${'34'} µm pixel: there is nothing printable to gain, so the original is recommended.`
          : 'No part could be refined; the original is recommended.' };
    }
    const c = compare(input, r.mesh);
    const bad = degradation(c, medianEdgeMm, area, volume);
    if (bad && tryNo === 0 && strength > 0) { strength = 0; continue; }
    if (bad) {
      return { mesh: input, partsRefined: 0, partsUnchanged: r.unchanged, settings: r.s, comparison: c, verdict: 'rejected', message: `Enhancement was refused and the original kept: ${bad}.` };
    }
    // Below a few microns the change cannot be printed (one pixel is 34 µm, one layer 20–50 µm).
    if (c.enhancedToOriginal.max < 0.002 || r.refined === 0) {
      return { mesh: r.mesh, partsRefined: r.refined, partsUnchanged: r.unchanged, settings: r.s, comparison: c, verdict: 'no-visible-change',
        message: r.refined === 0 ? 'No part could be refined; the original is recommended.' : `The original is already finer than the printer can reproduce: the enhanced surface differs by at most ${(c.enhancedToOriginal.max * 1000).toFixed(1)} µm. The original is recommended.` };
    }
    return { mesh: r.mesh, partsRefined: r.refined, partsUnchanged: r.unchanged, settings: r.s, comparison: c, verdict: 'improved',
      message: `Curved surfaces were refined by up to ${(c.enhancedToOriginal.max * 1000).toFixed(0)} µm (average ${(c.enhancedToOriginal.mean * 1000).toFixed(1)} µm); every original vertex is unchanged.${strength !== settings.strength ? ' A gentler setting was used because the requested one changed the shape too much.' : ''}` };
  }
  throw new Error('unreachable');
}

// ---------- methods measured for comparison only ----------

/** Splits every triangle into four at its edge midpoints. More triangles, identical shape. */
export function midpointSubdivide(m: Mesh): Mesh {
  const e = buildEdges(m);
  const nv = m.pos.length / 3;
  const pos = new Float64Array((nv + e.count) * 3);
  pos.set(m.pos);
  for (let i = 0; i < e.count; i++) for (let k = 0; k < 3; k++) pos[(nv + i) * 3 + k] = (m.pos[e.a[i]! * 3 + k]! + m.pos[e.b[i]! * 3 + k]!) / 2;
  return { pos, tri: splitFour(m, e, nv) };
}

function splitFour(m: Mesh, e: ReturnType<typeof buildEdges>, nv: number): Uint32Array {
  const nt = m.tri.length / 3;
  const tri = new Uint32Array(nt * 12);
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = [m.tri[t * 3]!, m.tri[t * 3 + 1]!, m.tri[t * 3 + 2]!];
    const ab = nv + e.ofCorner[t * 3]!, bc = nv + e.ofCorner[t * 3 + 1]!, ca = nv + e.ofCorner[t * 3 + 2]!;
    tri.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], t * 12);
  }
  return tri;
}

/** One step of Loop subdivision (approximating: original vertices move). */
export function loopSubdivide(m: Mesh): Mesh {
  const e = buildEdges(m);
  const nv = m.pos.length / 3;
  const pos = new Float64Array((nv + e.count) * 3);
  const opp = (f: number, i: number) => { for (let k = 0; k < 3; k++) { const v = m.tri[f * 3 + k]!; if (v !== e.a[i] && v !== e.b[i]) return v; } return e.a[i]!; };
  const boundary = new Uint8Array(nv);
  for (let i = 0; i < e.count; i++) {
    const A = e.a[i]! * 3, B = e.b[i]! * 3;
    if (e.uses[i] === 2) {
      const C = opp(e.f0[i]!, i) * 3, D = opp(e.f1[i]!, i) * 3;
      for (let k = 0; k < 3; k++) pos[(nv + i) * 3 + k] = 0.375 * (m.pos[A + k]! + m.pos[B + k]!) + 0.125 * (m.pos[C + k]! + m.pos[D + k]!);
    } else {
      boundary[e.a[i]!] = 1; boundary[e.b[i]!] = 1;
      for (let k = 0; k < 3; k++) pos[(nv + i) * 3 + k] = 0.5 * (m.pos[A + k]! + m.pos[B + k]!);
    }
  }
  const sum = new Float64Array(nv * 3), deg = new Uint32Array(nv);
  const bsum = new Float64Array(nv * 3), bdeg = new Uint32Array(nv);
  for (let i = 0; i < e.count; i++) {
    const a = e.a[i]!, b = e.b[i]!;
    for (let k = 0; k < 3; k++) { sum[a * 3 + k] = sum[a * 3 + k]! + m.pos[b * 3 + k]!; sum[b * 3 + k] = sum[b * 3 + k]! + m.pos[a * 3 + k]!; }
    deg[a] = deg[a]! + 1; deg[b] = deg[b]! + 1;
    if (e.uses[i] !== 2) { for (let k = 0; k < 3; k++) { bsum[a * 3 + k] = bsum[a * 3 + k]! + m.pos[b * 3 + k]!; bsum[b * 3 + k] = bsum[b * 3 + k]! + m.pos[a * 3 + k]!; } bdeg[a] = bdeg[a]! + 1; bdeg[b] = bdeg[b]! + 1; }
  }
  for (let v = 0; v < nv; v++) {
    if (boundary[v] && bdeg[v] === 2) { for (let k = 0; k < 3; k++) pos[v * 3 + k] = 0.75 * m.pos[v * 3 + k]! + 0.125 * bsum[v * 3 + k]!; continue; }
    if (boundary[v]) { for (let k = 0; k < 3; k++) pos[v * 3 + k] = m.pos[v * 3 + k]!; continue; }
    const n = deg[v]!;
    const beta = n > 3 ? 3 / (8 * n) : 3 / 16;
    for (let k = 0; k < 3; k++) pos[v * 3 + k] = (1 - n * beta) * m.pos[v * 3 + k]! + beta * sum[v * 3 + k]!;
  }
  return { pos, tri: splitFour(m, e, nv) };
}

/** Taubin λ|μ smoothing (low-pass, volume-preserving-ish). Boundary vertices stay put. */
export function taubinSmooth(m: Mesh, iterations = 10, lambda = 0.5, mu = -0.53): Mesh {
  const e = buildEdges(m);
  const nv = m.pos.length / 3;
  const fixed = new Uint8Array(nv);
  for (let i = 0; i < e.count; i++) if (e.uses[i] !== 2) { fixed[e.a[i]!] = 1; fixed[e.b[i]!] = 1; }
  let pos = Float64Array.from(m.pos);
  const step = (f: number) => {
    const sum = new Float64Array(nv * 3), deg = new Uint32Array(nv);
    for (let i = 0; i < e.count; i++) {
      const a = e.a[i]!, b = e.b[i]!;
      for (let k = 0; k < 3; k++) { sum[a * 3 + k] = sum[a * 3 + k]! + pos[b * 3 + k]!; sum[b * 3 + k] = sum[b * 3 + k]! + pos[a * 3 + k]!; }
      deg[a] = deg[a]! + 1; deg[b] = deg[b]! + 1;
    }
    const next = Float64Array.from(pos);
    for (let v = 0; v < nv; v++) if (!fixed[v] && deg[v]) for (let k = 0; k < 3; k++) next[v * 3 + k] = pos[v * 3 + k]! + f * (sum[v * 3 + k]! / deg[v]! - pos[v * 3 + k]!);
    pos = next;
  };
  for (let i = 0; i < iterations; i++) { step(lambda); step(mu); }
  return { pos, tri: Uint32Array.from(m.tri) };
}

/** manifold-3d's uniform refinement (same smooth surface, but every edge split to a fixed length). */
export function manifoldUniform(M: ManifoldModule, m: Mesh, minSharpAngle: number, lengthMm: number): Mesh | null {
  const mesh = new M.Mesh({ numProp: 3, vertProperties: Float32Array.from(m.pos), triVerts: m.tri });
  try {
    const base = new M.Manifold(mesh);
    const s = base.smoothOut(minSharpAngle, 0);
    const f = s.refineToLength(lengthMm);
    const out = f.getMesh();
    const n = out.vertProperties.length / out.numProp;
    const pos = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = out.vertProperties[i * out.numProp + k]!;
    f.delete(); s.delete(); base.delete();
    return { pos, tri: Uint32Array.from(out.triVerts) };
  } catch {
    return null;
  }
}
