// Fully automatic geometry enhancement for resin printing (see docs/chronicle/STL-WORKSHOP.md for the
// measurements behind every choice). No settings: each part of the model is measured and treated on
// its own.
//
//   1. Measure the part's faceting (how far its flat facets lie from a smooth surface through the same
//      vertices). Already finer than the tolerance: keep it exactly as it is.
//   2. Refine it, and check every result against the part itself (no vertex moved, movement explained
//      by the part's own faceting, no gap opened or closed, no new sharp edge, volume and size explained):
//        a. curved PN triangles (pn.ts): works on open and non-manifold surfaces, keeps creases sharp;
//        b. manifold-3d smoothOut + refineToTolerance (closed parts only; the most accurate on clean
//           solids, but it can fail or create creases on export meshes);
//      of the results that pass, the smoother one is kept. If neither passes:
//        c. curved PN triangles with a lower crease angle, keeping more edges sharp (gentler).
//   3. If nothing passes, keep the part exactly as it was and say why.
//
// Every method here INTERPOLATES: original vertices never move, so no detail is moved, invented or
// "recovered". Only the facets between vertices on curved surfaces become curved. Creases (sharper
// than CREASE_ANGLE_DEG), open edges and non-manifold edges stay straight.
//
// The other methods at the end of this file (midpoint, Loop, Taubin) and in alternatives.ts exist so
// the choice can be re-measured; the workshop does not use them.
import type { Mesh } from './mesh.ts';
import { buildEdges, components, signedVolume, surfaceArea, triangleCount } from './mesh.ts';
import { compare, type Comparison } from './metrics.ts';
import { pnRefine } from './pn.ts';

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
  /** Triangle limit for the result (memory safety in a browser tab). */
  maxTriangles: number;
  /** Largest part sent to manifold-3d (default MAX_REFINE_PART_TRIANGLES). */
  maxPartTriangles?: number;
}

/** Edges whose faces meet at more than this are intended creases (armour edges, folds) and stay sharp. */
export const CREASE_ANGLE_DEG = 40;
/** The gentler retry keeps edges above this sharp as well. */
export const GENTLE_CREASE_ANGLE_DEG = 28;
/** Maximum distance of the printed facets from the smooth surface (mm): under a quarter of a 34 µm pixel. */
export const TOLERANCE_MM = 0.0075;

/** Largest single part sent to the geometry library (memory: ~1.5 kB per triangle, measured). */
export const MAX_REFINE_PART_TRIANGLES = 750_000;

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
 * How far the flat facets lie from a smooth surface through the same vertices.
 *
 * Per edge: two faces meeting at angle θ are chords of an arc that turns by θ across the edge. The
 * chord's length is the faces' width ACROSS the edge (their height over it, h = 2·area / L), not the
 * edge's own length, so the facet sags about h/2 · tan(θ/4) from the arc. (On a cylinder's side the
 * edges run along the straight axis; their length says nothing about the curve around it.)
 *
 * Per face: a face curved in two directions (a sphere) sags in both at once, so its deepest point lies
 * about as far as its two most-curved edges' sagittas added together. `faceMax` is the largest such sum:
 * the furthest a smooth surface through the vertices can be from the original facets.
 *
 * Edges sharper than `minSharpAngle` are intended creases and are skipped. If `max` is below the
 * printer's resolution there is nothing printable to gain.
 */
export function facetDeviation(m: Mesh, minSharpAngleDeg: number): { max: number; p95: number; faceMax: number; smoothEdges: number } {
  const e = buildEdges(m);
  const sagOf = edgeSagitta(m, e, minSharpAngleDeg);
  const sag: number[] = [];
  let max = 0;
  for (let i = 0; i < e.count; i++) {
    const s = sagOf[i]!;
    if (s < 0) continue;
    if (s > max) max = s;
    if (sag.length < 400_000 || i % 7 === 0) sag.push(s);
  }
  let faceMax = 0;
  for (let t = 0; t < m.tri.length / 3; t++) {
    const v = [sagOf[e.ofCorner[t * 3]!]!, sagOf[e.ofCorner[t * 3 + 1]!]!, sagOf[e.ofCorner[t * 3 + 2]!]!].map((x) => Math.max(0, x)).sort((x, y) => y - x);
    if (v[0]! + v[1]! > faceMax) faceMax = v[0]! + v[1]!;
  }
  sag.sort((x, y) => x - y);
  return { max, p95: sag[Math.floor(sag.length * 0.95)] ?? 0, faceMax, smoothEdges: sag.length };
}

/** Facet sagitta of every edge (mm), or -1 for open, non-manifold and crease edges. */
export function edgeSagitta(m: Mesh, e: ReturnType<typeof buildEdges>, minSharpAngleDeg: number): Float64Array {
  const nt = m.tri.length / 3;
  const n = new Float64Array(nt * 3), area2 = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = m.tri[t * 3]! * 3, b = m.tri[t * 3 + 1]! * 3, c = m.tri[t * 3 + 2]! * 3;
    const ux = m.pos[b]! - m.pos[a]!, uy = m.pos[b + 1]! - m.pos[a + 1]!, uz = m.pos[b + 2]! - m.pos[a + 2]!;
    const vx = m.pos[c]! - m.pos[a]!, vy = m.pos[c + 1]! - m.pos[a + 1]!, vz = m.pos[c + 2]! - m.pos[a + 2]!;
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z);
    area2[t] = l;
    if (l > 0) { n[t * 3] = x / l; n[t * 3 + 1] = y / l; n[t * 3 + 2] = z / l; }
  }
  const limit = (minSharpAngleDeg * Math.PI) / 180;
  const out = new Float64Array(e.count).fill(-1);
  for (let i = 0; i < e.count; i++) {
    if (e.uses[i] !== 2) continue;
    const f = e.f0[i]!, g = e.f1[i]!;
    const dot = Math.min(1, Math.max(-1, n[f * 3]! * n[g * 3]! + n[f * 3 + 1]! * n[g * 3 + 1]! + n[f * 3 + 2]! * n[g * 3 + 2]!));
    const th = Math.acos(dot);
    if (th >= limit) continue;
    const a = e.a[i]! * 3, b = e.b[i]! * 3;
    const L = Math.hypot(m.pos[a]! - m.pos[b]!, m.pos[a + 1]! - m.pos[b + 1]!, m.pos[a + 2]! - m.pos[b + 2]!);
    const h = L > 0 ? (area2[f]! + area2[g]!) / (2 * L) : 0; // mean height of the two faces over the edge
    out[i] = (h / 2) * Math.tan(th / 4);
  }
  return out;
}

function isClosedManifold(m: Mesh): boolean {
  const e = buildEdges(m);
  for (let i = 0; i < e.count; i++) if (e.uses[i] !== 2 || e.d0[i] === e.d1[i]) return false;
  return true;
}

/** One closed part through manifold-3d (smoothOut + refineToTolerance). Returns null when the library refuses it. */
export function refinePart(M: ManifoldModule, part: Mesh, minSharpAngle: number, toleranceMm: number): Mesh | null {
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

export type PartMethod = 'curved-pn' | 'manifold' | 'curved-pn-gentle';
export const METHOD_LABEL: Record<PartMethod, string> = {
  'curved-pn': 'curved PN triangles',
  manifold: 'manifold-3d smoothing',
  'curved-pn-gentle': 'curved PN triangles, more edges kept sharp',
};

export interface EnhanceResult {
  mesh: Mesh;
  /** Parts refined, by the method that passed their checks. */
  partsRefined: number;
  methods: Partial<Record<PartMethod, number>>;
  /** Parts already finer than the tolerance (kept exactly). */
  partsAlreadyFine: number;
  /** Parts left exactly as they were for any other reason (with the reason). */
  partsUnchanged: { reason: string; triangles: number }[];
  /** Times a method was tried and refused before another one passed or the part was kept. */
  fallbacks: number;
  /** Faceting of the whole model before and after (mm). */
  faceting: { before: { max: number; p95: number }; after: { max: number; p95: number } };
  settings: { creaseAngleDeg: number; toleranceMm: number };
  comparison: Comparison;
  verdict: 'improved' | 'no-visible-change' | 'rejected';
  message: string;
}

/**
 * Reasons to refuse one part's result. The limits come from the part's own measured faceting, not from
 * a figure for the whole model: a smooth curve through the vertices lies no further from a facet than
 * that facet's sagitta, so a coarse accessory may legitimately move more than a fine face.
 * - no original vertex may move (these methods only add vertices between them);
 * - the surface may not move further than the part's largest face sagitta (facetDeviation's faceMax)
 *   × 1.25 + 10 µm: cubic patches can bulge slightly beyond a circular arc; anything more is an artefact;
 * - a closed part's volume may only change as much as the measured surface movement explains;
 * - the part's size may only grow by the curvature it gained.
 */
export function partDegradation(c: Comparison, faceSagMm: number, areaMm2: number, volumeMm3: number, closed: boolean): string | null {
  const maxMove = 1.25 * faceSagMm + 0.01;
  if (!Number.isFinite(c.hausdorff)) return 'the result could not be measured';
  if (c.originalVerticesToEnhanced.max > 0.005) return `original vertices moved by up to ${(c.originalVerticesToEnhanced.max * 1000).toFixed(0)} µm: original detail would change`;
  if (c.enhancedToOriginal.max > maxMove) return `the surface moved up to ${(c.enhancedToOriginal.max * 1000).toFixed(0)} µm, more than this part's facets explain (${(maxMove * 1000).toFixed(0)} µm)`;
  if (c.originalToEnhanced.max > maxMove) return `original surface points ended up ${(c.originalToEnhanced.max * 1000).toFixed(0)} µm from the result: detail could be lost`;
  if (closed && Math.abs(volumeMm3) > 1e-9) {
    const explained = (1.5 * areaMm2 * c.enhancedToOriginal.mean + 0.002 * Math.abs(volumeMm3)) / Math.abs(volumeMm3) * 100;
    if (Math.abs(c.volumeChangePct) > explained) return `the volume changed by ${c.volumeChangePct.toFixed(1)} %, more than the surface movement explains (${explained.toFixed(1)} %)`;
  }
  if (c.sizeChangeMm > maxMove) return `the part's size changed by ${(c.sizeChangeMm * 1000).toFixed(0)} µm`;
  return null;
}

/** Total length of open (single-face) edges: refinement must not open or close any gap. */
function openEdgeLength(m: Mesh): number {
  const e = buildEdges(m);
  let L = 0;
  for (let i = 0; i < e.count; i++) if (e.uses[i] === 1) { const a = e.a[i]! * 3, b = e.b[i]! * 3; L += Math.hypot(m.pos[a]! - m.pos[b]!, m.pos[a + 1]! - m.pos[b + 1]!, m.pos[a + 2]! - m.pos[b + 2]!); }
  return L;
}

/** Total length of sharp edges (faces meeting at more than the crease angle). */
export function creaseLength(m: Mesh, creaseDeg = CREASE_ANGLE_DEG): number {
  const e = buildEdges(m);
  const nt = m.tri.length / 3, n = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = m.tri[t * 3]! * 3, b = m.tri[t * 3 + 1]! * 3, c = m.tri[t * 3 + 2]! * 3;
    const ux = m.pos[b]! - m.pos[a]!, uy = m.pos[b + 1]! - m.pos[a + 1]!, uz = m.pos[b + 2]! - m.pos[a + 2]!;
    const vx = m.pos[c]! - m.pos[a]!, vy = m.pos[c + 1]! - m.pos[a + 1]!, vz = m.pos[c + 2]! - m.pos[a + 2]!;
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1;
    n[t * 3] = x / l; n[t * 3 + 1] = y / l; n[t * 3 + 2] = z / l;
  }
  const lim = Math.cos((creaseDeg * Math.PI) / 180);
  let L = 0;
  for (let i = 0; i < e.count; i++) {
    if (e.uses[i] !== 2) continue;
    const f = e.f0[i]!, g = e.f1[i]!;
    if (n[f * 3]! * n[g * 3]! + n[f * 3 + 1]! * n[g * 3 + 1]! + n[f * 3 + 2]! * n[g * 3 + 2]! >= lim) continue;
    const a = e.a[i]! * 3, b = e.b[i]! * 3;
    L += Math.hypot(m.pos[a]! - m.pos[b]!, m.pos[a + 1]! - m.pos[b + 1]!, m.pos[a + 2]! - m.pos[b + 2]!);
  }
  return L;
}

const finite = (m: Mesh) => { for (let i = 0; i < m.pos.length; i++) if (!Number.isFinite(m.pos[i]!)) return false; return true; };

/** Enhance a (repaired) mesh, part by part, with no settings. Never returns a damaged part. */
export function enhance(M: ManifoldModule | null, input: Mesh, settings: EnhanceSettings, onProgress?: (fraction: number, label: string) => void): EnhanceResult {
  const parts = splitParts(input);
  const before = facetDeviation(input, CREASE_ANGLE_DEG);
  const unchanged: { reason: string; triangles: number }[] = [];
  const methods: Partial<Record<PartMethod, number>> = {};
  let refined = 0, alreadyFine = 0, fallbacks = 0, budget = settings.maxTriangles - triangleCount(input);
  const partLimit = settings.maxPartTriangles ?? MAX_REFINE_PART_TRIANGLES;
  // Work on the coarsest parts first, so the triangle budget goes where it shows most.
  const order = parts.map((p, i) => ({ i, f: facetDeviation(p, CREASE_ANGLE_DEG) })).sort((x, y) => y.f.max - x.f.max);
  const result: Mesh[] = new Array(parts.length);
  order.forEach(({ i, f }, n) => {
    const p = parts[i]!;
    const nt = p.tri.length / 3;
    onProgress?.(n / parts.length, `Enhancing part ${n + 1} of ${parts.length}`);
    if (f.max < TOLERANCE_MM) { result[i] = p; alreadyFine++; return; }
    const closed = isClosedManifold(p);
    const area = surfaceArea(p), volume = closed ? signedVolume(p) : 0;
    const open = closed ? 0 : openEdgeLength(p);
    const sharp = creaseLength(p);
    // Candidates, best measured first. Closed parts get both refiners and keep whichever result is
    // smoother; the gentler setting is the fallback when neither passes.
    type Run = () => { mesh: Mesh; creaseMax: number } | null;
    const viaPn = (crease: number, maxLevel: number): Run => () => {
      const r = pnRefine(p, { creaseAngleDeg: crease, toleranceMm: TOLERANCE_MM, maxLevel, maxTriangles: budget + nt });
      return r ? { mesh: r.mesh, creaseMax: r.creaseMaxMm } : null;
    };
    const tiers: [PartMethod, Run][][] = [
      [['curved-pn', viaPn(CREASE_ANGLE_DEG, 6)], ...(M && closed && nt <= partLimit ? [['manifold', () => { const r = refinePart(M, p, CREASE_ANGLE_DEG, TOLERANCE_MM); return r ? { mesh: r, creaseMax: 0 } : null; }] as [PartMethod, Run]] : [])],
      [['curved-pn-gentle', viaPn(GENTLE_CREASE_ANGLE_DEG, 4)]],
    ];
    let reason = 'no method could refine this part';
    for (const tier of tiers) {
      let best: { name: PartMethod; mesh: Mesh; faceting: number } | null = null;
      for (const [name, run] of tier) {
        let out: ReturnType<Run>;
        try { out = run(); } catch { out = null; }
        if (!out) continue;
        const r = out.mesh, rt = r.tri.length / 3;
        if (rt === nt) continue; // nothing to refine with this method
        if (!finite(r)) { reason = `${METHOD_LABEL[name]} produced invalid coordinates`; fallbacks++; continue; }
        if (rt - nt > budget) { reason = `refining it would exceed the ${settings.maxTriangles.toLocaleString()}-triangle limit for a browser tab`; fallbacks++; continue; }
        // Gaps may neither open nor close.
        if (closed ? !isClosedManifold(r) : Math.abs(openEdgeLength(r) - open) > Math.max(1e-6, open * 1e-6)) { reason = `${METHOD_LABEL[name]} would have opened or closed a gap`; fallbacks++; continue; }
        // No new sharp edges: smoothing that creates creases is an artefact, not detail.
        if (creaseLength(r) > sharp * 1.05 + 0.05) { reason = `${METHOD_LABEL[name]} was refused: it would have created new sharp edges`; fallbacks++; continue; }
        const bad = partDegradation(compare(p, r, 4000), Math.max(f.faceMax, out.creaseMax), area, volume, closed);
        if (bad) { reason = `${METHOD_LABEL[name]} was refused: ${bad}`; fallbacks++; continue; }
        const faceting = facetDeviation(r, CREASE_ANGLE_DEG).faceMax;
        // Both within twice the target: equally smooth in print, so the lighter file wins. Otherwise the
        // smoother one does.
        const meets = (x: number) => x <= 2 * TOLERANCE_MM;
        if (!best || (meets(faceting) && meets(best.faceting) ? rt < best.mesh.tri.length / 3 : faceting < best.faceting)) best = { name, mesh: r, faceting };
      }
      if (best) {
        result[i] = best.mesh; refined++; budget -= best.mesh.tri.length / 3 - nt; methods[best.name] = (methods[best.name] ?? 0) + 1;
        return;
      }
    }
    result[i] = p; unchanged.push({ reason, triangles: nt });
  });
  onProgress?.(1, 'Measuring the result against the original');
  const settingsUsed = { creaseAngleDeg: CREASE_ANGLE_DEG, toleranceMm: TOLERANCE_MM };
  const fb = { max: before.max, p95: before.p95 };
  const base = { partsAlreadyFine: alreadyFine, partsUnchanged: unchanged, fallbacks, methods, settings: settingsUsed };
  if (refined === 0) {
    const z = { mean: 0, rms: 0, p95: 0, max: 0 };
    return { ...base, mesh: input, partsRefined: 0, faceting: { before: fb, after: fb }, comparison: { enhancedToOriginal: z, originalToEnhanced: z, originalVerticesToEnhanced: z, hausdorff: 0, volumeChangePct: 0, sizeChangeMm: 0 }, verdict: unchanged.length ? 'rejected' : 'no-visible-change',
      message: unchanged.length === 0
        ? `Already optimal: every curved surface is within ${(TOLERANCE_MM * 1000).toFixed(1)} µm of a smooth surface (largest facet deviation ${(before.max * 1000).toFixed(1)} µm), far finer than the printer's 34 µm pixel. Changing it could not improve the print, so the original is kept exactly as it was.`
        : `No part could be enhanced without changing the design, so the original is kept exactly as it was: ${[...new Set(unchanged.map((u) => u.reason))].join('; ')}.` };
  }
  const mesh = joinParts(result);
  const after = facetDeviation(mesh, CREASE_ANGLE_DEG);
  const c = compare(input, mesh);
  const used = (Object.keys(methods) as PartMethod[]).map((k) => `${METHOD_LABEL[k]} (${methods[k]} part${methods[k] === 1 ? '' : 's'})`).join(', ');
  return { ...base, mesh, partsRefined: refined, faceting: { before: fb, after: { max: after.max, p95: after.p95 } }, comparison: c,
    verdict: c.enhancedToOriginal.max < 0.002 ? 'no-visible-change' : 'improved',
    message: c.enhancedToOriginal.max < 0.002
      ? `The original is already finer than the printer can reproduce: the enhanced surface differs by at most ${(c.enhancedToOriginal.max * 1000).toFixed(1)} µm. The original is recommended.`
      : `Faceting reduced from ${(before.max * 1000).toFixed(0)} µm to ${(after.max * 1000).toFixed(0)} µm at worst (typical ${(before.p95 * 1000).toFixed(1)} → ${(after.p95 * 1000).toFixed(1)} µm) on ${refined} part${refined === 1 ? '' : 's'} using ${used}. Every original vertex is unchanged and sharp edges were kept.${alreadyFine ? ` ${alreadyFine} part${alreadyFine === 1 ? ' was' : 's were'} already smooth and kept as they were.` : ''}` };
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
