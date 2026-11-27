// Curvature-adaptive curved PN triangles (Vlachos, Peters, Boyd, Mitchell, 2001), adapted for printing:
// works on ANY triangle mesh, including the open and non-manifold surfaces Hero Forge exports, which
// manifold-3d cannot accept.
//
// - Interpolating: every original vertex stays exactly where it is; only the facets between vertices
//   become curved patches. Nothing is invented.
// - Smoothing groups: normals are averaged only across smooth edges, so intentional creases (folds,
//   armour edges, blade edges) keep their sharp angle. A crease line that runs on smoothly (a rim) is
//   curved along itself; crease corners, open edges and non-manifold edges stay straight. Both sides of
//   every edge use the same points, so neighbouring patches always meet exactly (no cracks).
// - Adaptive: only triangles with a measurably faceted edge are refined; their flat neighbours are
//   re-triangulated (unchanged shape) to share the new edge vertices, so the result stays conforming.
import type { Mesh } from './mesh.ts';
import { buildEdges, weld } from './mesh.ts';
import { edgeSagitta } from './enhance.ts';

export interface PnOptions {
  /** Edges whose faces meet at more than this angle are creases and stay sharp. */
  creaseAngleDeg: number;
  /** Refine where a facet lies further than this from the smooth surface (mm). */
  toleranceMm: number;
  /** Highest subdivision per edge (the patch is split into level² triangles). */
  maxLevel: number;
  /** Stop before producing more triangles than this. */
  maxTriangles: number;
  /** Also return, per output triangle, the input triangle it came from (for measurements). */
  trackOrigin?: boolean;
}

export interface PnResult {
  mesh: Mesh; level: number; curvedTriangles: number;
  /** Largest distance a curved crease line moves from its straight chord (mm). */
  creaseMaxMm: number;
  /** For each output triangle, the input triangle it was made from. */
  origin?: Uint32Array;
}

const sub3 = (p: Float64Array, a: number, b: number): [number, number, number] => [p[a]! - p[b]!, p[a + 1]! - p[b + 1]!, p[a + 2]! - p[b + 2]!];

export function pnRefine(m: Mesh, o: PnOptions): PnResult | null {
  const nt = m.tri.length / 3;
  const P = m.pos;
  const e = buildEdges(m);
  // Face normals and corner angles.
  const fn = new Float64Array(nt * 3);
  const ang = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const v = [m.tri[t * 3]! * 3, m.tri[t * 3 + 1]! * 3, m.tri[t * 3 + 2]! * 3];
    const u = sub3(P, v[1]!, v[0]!), w = sub3(P, v[2]!, v[0]!);
    const x = u[1] * w[2] - u[2] * w[1], y = u[2] * w[0] - u[0] * w[2], z = u[0] * w[1] - u[1] * w[0];
    const l = Math.hypot(x, y, z);
    if (l > 0) { fn[t * 3] = x / l; fn[t * 3 + 1] = y / l; fn[t * 3 + 2] = z / l; }
    for (let k = 0; k < 3; k++) {
      const a = sub3(P, v[(k + 1) % 3]!, v[k]!), b = sub3(P, v[(k + 2) % 3]!, v[k]!);
      const la = Math.hypot(...a), lb = Math.hypot(...b);
      ang[t * 3 + k] = la > 0 && lb > 0 ? Math.acos(Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)))) : 0;
    }
  }
  // Smooth edges: exactly two consistently oriented faces meeting below the crease angle.
  const limit = Math.cos((o.creaseAngleDeg * Math.PI) / 180);
  const smooth = new Uint8Array(e.count);
  const sag = edgeSagitta(m, e, o.creaseAngleDeg);
  for (let i = 0; i < e.count; i++) {
    if (e.uses[i] !== 2 || e.d0[i] === e.d1[i] || sag[i]! < 0) continue;
    const f = e.f0[i]!, g = e.f1[i]!;
    if (fn[f * 3]! * fn[g * 3]! + fn[f * 3 + 1]! * fn[g * 3 + 1]! + fn[f * 3 + 2]! * fn[g * 3 + 2]! < limit) continue;
    smooth[i] = 1;
  }
  // Smoothing groups: corners (face, vertex) joined across smooth edges share one normal.
  const parent = new Int32Array(nt * 3);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x: number) => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
  const cornerOf = (t: number, v: number) => (m.tri[t * 3] === v ? t * 3 : m.tri[t * 3 + 1] === v ? t * 3 + 1 : t * 3 + 2);
  for (let i = 0; i < e.count; i++) {
    if (!smooth[i]) continue;
    for (const v of [e.a[i]!, e.b[i]!]) {
      const r1 = find(cornerOf(e.f0[i]!, v)), r2 = find(cornerOf(e.f1[i]!, v));
      if (r1 !== r2) parent[r1] = r2;
    }
  }
  const gsum = new Float64Array(nt * 9);
  for (let c = 0; c < nt * 3; c++) {
    const r = find(c), t = Math.floor(c / 3);
    for (let k = 0; k < 3; k++) gsum[r * 3 + k] = gsum[r * 3 + k]! + ang[c]! * fn[t * 3 + k]!;
  }
  const cn = new Float64Array(nt * 9); // corner normals
  for (let c = 0; c < nt * 3; c++) {
    const r = find(c), t = Math.floor(c / 3);
    let x = gsum[r * 3]!, y = gsum[r * 3 + 1]!, z = gsum[r * 3 + 2]!;
    const l = Math.hypot(x, y, z);
    if (l > 0) { x /= l; y /= l; z /= l; } else { x = fn[t * 3]!; y = fn[t * 3 + 1]!; z = fn[t * 3 + 2]!; }
    cn[c * 3] = x; cn[c * 3 + 1] = y; cn[c * 3 + 2] = z;
  }
  // Crease lines. A crease that runs on smoothly through a vertex (exactly two crease edges there,
  // turning by less than the crease angle) is a curve in its own right, like a cylinder's rim or the edge
  // of a curved armour plate: it follows a cubic through its vertices with the line's tangent. Where a
  // crease turns sharply, ends, or meets others (a box corner), it stays a straight line. Open and
  // non-manifold edges always stay straight, so no gap between parts opens or closes.
  const isCrease = new Uint8Array(e.count);
  const nv = P.length / 3;
  const creaseCount = new Uint8Array(nv), nbA = new Int32Array(nv).fill(-1), nbB = new Int32Array(nv).fill(-1);
  for (let i = 0; i < e.count; i++) {
    if (e.uses[i] !== 2 || e.d0[i] === e.d1[i] || smooth[i]) continue;
    isCrease[i] = 1;
    for (const [v, w] of [[e.a[i]!, e.b[i]!], [e.b[i]!, e.a[i]!]] as const) {
      if (creaseCount[v]! === 0) nbA[v] = w; else if (creaseCount[v]! === 1) nbB[v] = w;
      creaseCount[v] = Math.min(255, creaseCount[v]! + 1);
    }
  }
  const tangent = new Float64Array(nv * 3); // zero: no tangent (a corner), the crease stays straight there
  const turnLimit = Math.cos((o.creaseAngleDeg * Math.PI) / 180);
  for (let v = 0; v < nv; v++) {
    if (creaseCount[v] !== 2) continue;
    const pa = sub3(P, v * 3, nbA[v]! * 3), pb = sub3(P, nbB[v]! * 3, v * 3); // A -> v, v -> B
    const la = Math.hypot(...pa), lb = Math.hypot(...pb);
    if (!(la > 0 && lb > 0)) continue;
    if ((pa[0] * pb[0] + pa[1] * pb[1] + pa[2] * pb[2]) / (la * lb) < turnLimit) continue;
    const tx = pa[0] / la + pb[0] / lb, ty = pa[1] / la + pb[1] / lb, tz = pa[2] / la + pb[2] / lb, tl = Math.hypot(tx, ty, tz);
    if (tl > 0) { tangent[v * 3] = tx / tl; tangent[v * 3 + 1] = ty / tl; tangent[v * 3 + 2] = tz / tl; }
  }
  /** Inner control point of crease edge (from -> to): one third along the crease tangent at `from`. */
  const creaseCtrl = (from: number, to: number): number[] => {
    const a = [P[from * 3]!, P[from * 3 + 1]!, P[from * 3 + 2]!], d = sub3(P, to * 3, from * 3), L = Math.hypot(...d);
    let tx = tangent[from * 3]!, ty = tangent[from * 3 + 1]!, tz = tangent[from * 3 + 2]!;
    if (tx === 0 && ty === 0 && tz === 0) { tx = d[0] / L; ty = d[1] / L; tz = d[2] / L; }
    else if (tx * d[0] + ty * d[1] + tz * d[2] < 0) { tx = -tx; ty = -ty; tz = -tz; }
    return [a[0]! + (tx * L) / 3, a[1]! + (ty * L) / 3, a[2]! + (tz * L) / 3];
  };
  const creaseCurved = new Uint8Array(e.count);
  let creaseMax = 0;
  for (let i = 0; i < e.count; i++) {
    if (!isCrease[i]) continue;
    const a = e.a[i]!, b = e.b[i]!;
    if (!tangent[a * 3] && !tangent[a * 3 + 1] && !tangent[a * 3 + 2] && !tangent[b * 3] && !tangent[b * 3 + 1] && !tangent[b * 3 + 2]) continue;
    // A cubic stays within 3/4 of its control polygon's distance from the chord.
    const d = sub3(P, b * 3, a * 3), L = Math.hypot(...d);
    if (!(L > 0)) continue;
    let dev = 0;
    for (const c of [creaseCtrl(a, b), creaseCtrl(b, a)]) {
      const r = [c[0]! - P[a * 3]!, c[1]! - P[a * 3 + 1]!, c[2]! - P[a * 3 + 2]!];
      const along = (r[0]! * d[0] + r[1]! * d[1] + r[2]! * d[2]) / L;
      dev = Math.max(dev, Math.sqrt(Math.max(0, r[0]! ** 2 + r[1]! ** 2 + r[2]! ** 2 - along * along)));
    }
    dev *= 0.75;
    if (dev >= o.toleranceMm) { creaseCurved[i] = 1; if (dev > creaseMax) creaseMax = dev; }
  }

  // Which triangles need refining, and how finely (cubic patches: error falls ~ 1/level²).
  const curved = new Uint8Array(nt);
  let maxSag = creaseMax, curvedCount = 0;
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const ei = e.ofCorner[t * 3 + k]!;
      if (smooth[ei] && sag[ei]! >= o.toleranceMm) { curved[t] = 1; if (sag[ei]! > maxSag) maxSag = sag[ei]!; }
      if (creaseCurved[ei]) curved[t] = 1;
    }
    if (curved[t]) curvedCount++;
  }
  if (curvedCount === 0) return { mesh: m, level: 1, curvedTriangles: 0, creaseMaxMm: 0 };
  let level = Math.min(o.maxLevel, Math.max(2, Math.ceil(Math.sqrt(maxSag / o.toleranceMm))));
  const estimate = (L: number) => curvedCount * L * L + (nt - curvedCount) * (3 * L);
  while (level > 2 && estimate(level) > o.maxTriangles) level--;
  if (estimate(level) > o.maxTriangles) return null;
  // An edge is drawn curved only between two refined triangles; elsewhere it stays straight, so both
  // sides of every edge agree exactly.
  const edgeCurved = (ei: number) => creaseCurved[ei] === 1 || (smooth[ei] === 1 && curved[e.f0[ei]!] === 1 && curved[e.f1[ei]!] === 1);
  // An edge is split when ANY triangle on it is refined (an edge shared by three or more faces included).
  const splitEdge = new Uint8Array(e.count);
  for (let t = 0; t < nt; t++) if (curved[t]) for (let k = 0; k < 3; k++) splitEdge[e.ofCorner[t * 3 + k]!] = 1;
  const edgeSplit = (ei: number) => splitEdge[ei] === 1;

  // Points along each split edge are computed once, from its first vertex, and reused by both sides:
  // neighbouring triangles then share bit-identical coordinates and weld back together exactly.
  const cornerNormal = (t: number, v: number) => { const c = cornerOf(t, v) * 3; return [cn[c]!, cn[c + 1]!, cn[c + 2]!]; };
  const pt = (v: number) => [P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!];
  const edgeCache = new Map<number, number[][]>();
  const edgePoints = (ei: number): number[][] => {
    let pts = edgeCache.get(ei);
    if (pts) return pts;
    const a = pt(e.a[ei]!), b = pt(e.b[ei]!);
    pts = [];
    if (creaseCurved[ei]) {
      const ca = creaseCtrl(e.a[ei]!, e.b[ei]!), cb = creaseCtrl(e.b[ei]!, e.a[ei]!);
      for (let s = 1; s < level; s++) {
        const t = s / level, r = 1 - t;
        pts.push([0, 1, 2].map((k) => r * r * r * a[k]! + 3 * r * r * t * ca[k]! + 3 * r * t * t * cb[k]! + t * t * t * b[k]!));
      }
    } else if (edgeCurved(ei)) {
      const na = cornerNormal(e.f0[ei]!, e.a[ei]!), nb = cornerNormal(e.f0[ei]!, e.b[ei]!);
      const wa = (b[0]! - a[0]!) * na[0]! + (b[1]! - a[1]!) * na[1]! + (b[2]! - a[2]!) * na[2]!;
      const wb = (a[0]! - b[0]!) * nb[0]! + (a[1]! - b[1]!) * nb[1]! + (a[2]! - b[2]!) * nb[2]!;
      const ca = [0, 1, 2].map((k) => (2 * a[k]! + b[k]! - wa * na[k]!) / 3);
      const cb = [0, 1, 2].map((k) => (2 * b[k]! + a[k]! - wb * nb[k]!) / 3);
      for (let s = 1; s < level; s++) {
        const t = s / level, r = 1 - t;
        pts.push([0, 1, 2].map((k) => r * r * r * a[k]! + 3 * r * r * t * ca[k]! + 3 * r * t * t * cb[k]! + t * t * t * b[k]!));
      }
    } else {
      for (let s = 1; s < level; s++) pts.push([0, 1, 2].map((k) => a[k]! + ((b[k]! - a[k]!) * s) / level));
    }
    edgeCache.set(ei, pts);
    return pts;
  };
  /** The s-th interior point (1 … level-1) of edge ei, counted from vertex `from`. */
  const along = (ei: number, from: number, s: number) => (e.a[ei] === from ? edgePoints(ei)[s - 1]! : edgePoints(ei)[level - 1 - s]!);

  const out: number[] = [];
  const originList: number[] = [];
  let current = 0;
  const tri = (a: number[], b: number[], c: number[]) => { if (o.trackOrigin) originList.push(current); out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!); };
  for (let t = 0; t < nt; t++) {
    current = t;
    const V = [m.tri[t * 3]!, m.tri[t * 3 + 1]!, m.tri[t * 3 + 2]!];
    const p = V.map(pt);
    const e01 = e.ofCorner[t * 3]!, e12 = e.ofCorner[t * 3 + 1]!, e20 = e.ofCorner[t * 3 + 2]!;
    if (curved[t]) {
      // Ten control points of the cubic patch.
      const N = [0, 1, 2].map((k) => [cn[(t * 3 + k) * 3]!, cn[(t * 3 + k) * 3 + 1]!, cn[(t * 3 + k) * 3 + 2]!]);
      const ctrl = (i: number, j: number, ei: number) => {
        const pi = p[i]!, pj = p[j]!;
        if (creaseCurved[ei]) return creaseCtrl(V[i]!, V[j]!);
        if (!edgeCurved(ei)) return [0, 1, 2].map((k) => (2 * pi[k]! + pj[k]!) / 3);
        const ni = N[i]!;
        const w = (pj[0]! - pi[0]!) * ni[0]! + (pj[1]! - pi[1]!) * ni[1]! + (pj[2]! - pi[2]!) * ni[2]!;
        return [0, 1, 2].map((k) => (2 * pi[k]! + pj[k]! - w * ni[k]!) / 3);
      };
      const b210 = ctrl(0, 1, e01), b120 = ctrl(1, 0, e01), b021 = ctrl(1, 2, e12), b012 = ctrl(2, 1, e12), b102 = ctrl(2, 0, e20), b201 = ctrl(0, 2, e20);
      const E = [0, 1, 2].map((k) => (b210[k]! + b120[k]! + b021[k]! + b012[k]! + b102[k]! + b201[k]!) / 6);
      const C = [0, 1, 2].map((k) => (p[0]![k]! + p[1]![k]! + p[2]![k]!) / 3);
      const b111 = [0, 1, 2].map((k) => E[k]! + (E[k]! - C[k]!) / 2);
      // Grid point (i, j): weight u = i/level on p1, v = j/level on p2. Corners and edges come from the
      // shared vertices and edge points; only the interior is evaluated here.
      const at = (i: number, j: number): number[] => {
        if (i === 0 && j === 0) return p[0]!;
        if (i === level && j === 0) return p[1]!;
        if (i === 0 && j === level) return p[2]!;
        if (j === 0) return along(e01, V[0]!, i);
        if (i === 0) return along(e20, V[0]!, j);
        if (i + j === level) return along(e12, V[1]!, j);
        const u = i / level, v = j / level, w = 1 - u - v;
        return [0, 1, 2].map((k) => p[0]![k]! * w * w * w + p[1]![k]! * u * u * u + p[2]![k]! * v * v * v
          + 3 * b210[k]! * w * w * u + 3 * b120[k]! * w * u * u + 3 * b201[k]! * w * w * v
          + 3 * b021[k]! * u * u * v + 3 * b102[k]! * w * v * v + 3 * b012[k]! * u * v * v + 6 * b111[k]! * w * u * v);
      };
      for (let i = 0; i < level; i++) for (let j = 0; i + j < level; j++) {
        tri(at(i, j), at(i + 1, j), at(i, j + 1));
        if (i + j < level - 1) tri(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
      }
      continue;
    }
    // A flat triangle: unchanged unless a neighbour split a shared edge; then fan from its centre so it
    // shares those points (same plane, same shape: shared edges next to a flat triangle are straight).
    const ring: number[][] = [];
    let split = false;
    for (let k = 0; k < 3; k++) {
      const ei = e.ofCorner[t * 3 + k]!;
      ring.push(p[k]!);
      if (edgeSplit(ei)) { split = true; for (let s = 1; s < level; s++) ring.push(along(ei, V[k]!, s)); }
    }
    if (!split) { tri(p[0]!, p[1]!, p[2]!); continue; }
    const c = [0, 1, 2].map((k) => (p[0]![k]! + p[1]![k]! + p[2]![k]!) / 3);
    for (let i = 0; i < ring.length; i++) tri(c, ring[i]!, ring[(i + 1) % ring.length]!);
  }
  // Merge the shared points (identical up to rounding) back into an indexed mesh.
  const res = weld(Float64Array.from(out));
  return { mesh: res, level, curvedTriangles: curvedCount, creaseMaxMm: creaseMax, origin: o.trackOrigin ? Uint32Array.from(originList) : undefined };
}
