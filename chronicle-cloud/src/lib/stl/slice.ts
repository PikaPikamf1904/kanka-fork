// Slicing check: does the model cut into closed layers, the way a resin slicer cuts it?
//
// A slicer intersects the model with a horizontal plane per layer and fills the outlines it finds. A
// layer is well defined when every outline closes. Exports often contain open surfaces (a body that is
// open where clothing covers it); that is harmless when the open outline's loose ends are buried inside
// another solid part, or lie closer to other surface than one printer pixel (the printer cannot see the
// gap). It is a real problem when a loose end hangs in the open: the slicer must then guess what is
// inside, and different slicers guess differently.
//
// This module cuts the mesh at sampled heights and reports, per model:
// - how many layers have an outline that does not close, and
// - how many loose ends are exposed (not inside a solid, not within a pixel of other surface).
// Inside is decided by the winding number of the closed outlines (oriented from the faces), so parts
// that overlap, and holes inside parts, are handled correctly.
import type { Mesh } from './mesh.ts';
import { bounds, buildEdges } from './mesh.ts';

export interface SliceReport {
  /** Layers cut (sampled evenly over the model's height). */
  layers: number;
  layerStepMm: number;
  /** Layers in which at least one outline does not close. */
  layersWithOpenOutlines: number;
  /** Loose ends of open outlines, over all sampled layers. */
  looseEnds: number;
  /** Loose ends that are neither inside a solid nor within `sealMm` of other surface. */
  exposedEnds: number;
  /** Layers with at least one exposed loose end. */
  layersWithExposedEnds: number;
  /** Height (mm) of the layer with the most exposed ends, if any. */
  worstLayerZ: number | null;
  /** Widest gap at an exposed end (mm), 0 when none. */
  widestGapMm: number;
  /** Gap below which a loose end counts as sealed (one printer pixel). */
  sealMm: number;
  /** Each exposed end: where it is (mm), the gap to the nearest other surface in that layer (mm), and
   * the mesh face whose open edge it lies on. */
  exposed: { x: number; y: number; z: number; gapMm: number; face: number }[];
}

interface Seg { x0: number; y0: number; x1: number; y1: number; closed: boolean; len: number }

/**
 * Cut `m` at up to `maxLayers` evenly spaced heights, `layerMm` apart at most.
 * `sealMm`: gaps narrower than this are sealed (default one Photon Mono 2 pixel, 34 µm).
 */
export function sliceCheck(m: Mesh, opts: { layerMm?: number; maxLayers?: number; sealMm?: number; zRange?: [number, number] } = {}): SliceReport {
  const layerMm = opts.layerMm ?? 0.05, maxLayers = opts.maxLayers ?? 240, sealMm = opts.sealMm ?? 0.034;
  const b = bounds(m);
  // Compare two versions of a model on the same planes by passing the original's height range.
  const z0 = opts.zRange?.[0] ?? b.min[2]!;
  const height = (opts.zRange?.[1] ?? b.max[2]!) - z0;
  const count = Math.max(1, Math.min(maxLayers, Math.ceil(height / layerMm)));
  const step = height / count;
  const e = buildEdges(m);
  const nt = m.tri.length / 3, P = m.pos;
  // Triangles sorted by lowest z, for a sweep.
  const zmin = new Float64Array(nt), zmax = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = P[m.tri[t * 3]! * 3 + 2]!, bb = P[m.tri[t * 3 + 1]! * 3 + 2]!, c = P[m.tri[t * 3 + 2]! * 3 + 2]!;
    zmin[t] = Math.min(a, bb, c); zmax[t] = Math.max(a, bb, c);
  }
  const order = Array.from({ length: nt }, (_, i) => i).sort((x, y) => zmin[x]! - zmin[y]!);
  let next = 0;
  let active: number[] = [];
  const report: SliceReport = { layers: count, layerStepMm: step, layersWithOpenOutlines: 0, looseEnds: 0, exposedEnds: 0, layersWithExposedEnds: 0, worstLayerZ: null, widestGapMm: 0, sealMm, exposed: [] };
  let worst = 0;
  for (let li = 0; li < count; li++) {
    // Mid-layer, nudged so no vertex lies exactly on the plane.
    const z = z0 + (li + 0.5) * step + 1.234e-7;
    while (next < nt && zmin[order[next]!]! <= z) active.push(order[next++]!);
    active = active.filter((t) => zmax[t]! > z);
    // Crossing point per mesh edge, and segments per face.
    const point = new Map<number, [number, number]>();
    const degree = new Map<number, number>();
    const faceSegs: { e0: number; e1: number; t: number }[] = [];
    const cross = (ei: number): [number, number] => {
      let p = point.get(ei);
      if (!p) {
        const a = e.a[ei]! * 3, c = e.b[ei]! * 3;
        const s = (z - P[a + 2]!) / (P[c + 2]! - P[a + 2]!);
        p = [P[a]! + s * (P[c]! - P[a]!), P[a + 1]! + s * (P[c + 1]! - P[a + 1]!)];
        point.set(ei, p);
      }
      return p;
    };
    for (const t of active) {
      const hit: number[] = [];
      for (let k = 0; k < 3; k++) {
        const za = P[m.tri[t * 3 + k]! * 3 + 2]!, zb = P[m.tri[t * 3 + ((k + 1) % 3)]! * 3 + 2]!;
        if ((za < z) !== (zb < z)) hit.push(e.ofCorner[t * 3 + k]!);
      }
      if (hit.length !== 2) continue;
      faceSegs.push({ e0: hit[0]!, e1: hit[1]!, t });
      for (const h of hit) { cross(h); degree.set(h, (degree.get(h) ?? 0) + 1); }
    }
    if (faceSegs.length === 0) continue;
    // Outlines are connected components of the segment graph; one closes when every point on it has
    // exactly two segments.
    const parent = new Map<number, number>();
    const find = (x: number): number => { let r = x; while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!; let c = x; while (c !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; } return r; };
    for (const s of faceSegs) { if (!parent.has(s.e0)) parent.set(s.e0, s.e0); if (!parent.has(s.e1)) parent.set(s.e1, s.e1); const r0 = find(s.e0), r1 = find(s.e1); if (r0 !== r1) parent.set(r0, r1); }
    const openComp = new Set<number>();
    const ends: number[] = []; // mesh edge whose crossing is a loose end
    for (const [ei, d] of degree) {
      if (d === 2) continue;
      openComp.add(find(ei));
      if (d === 1) ends.push(ei);
    }
    if (openComp.size === 0) continue;
    report.layersWithOpenOutlines++;
    report.looseEnds += ends.length;
    // Oriented segments: material on the left. The face's outward normal, projected, points right.
    const segs: Seg[] = faceSegs.map((s) => {
      const p0 = point.get(s.e0)!, p1 = point.get(s.e1)!;
      const a = m.tri[s.t * 3]! * 3, bb = m.tri[s.t * 3 + 1]! * 3, c = m.tri[s.t * 3 + 2]! * 3;
      const ux = P[bb]! - P[a]!, uy = P[bb + 1]! - P[a + 1]!, uz = P[bb + 2]! - P[a + 2]!;
      const vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz;
      // Direction should be (−ny, nx).
      const flip = (p1[0] - p0[0]) * -ny + (p1[1] - p0[1]) * nx < 0;
      const [q0, q1] = flip ? [p1, p0] : [p0, p1];
      return { x0: q0[0], y0: q0[1], x1: q1[0], y1: q1[1], closed: !openComp.has(find(s.e0)), len: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) };
    });
    // Point -> segments touching it, to walk along an outline from a loose end.
    const touching = new Map<number, number[]>();
    faceSegs.forEach((s, i) => { for (const n of [s.e0, s.e1]) { let l = touching.get(n); if (!l) touching.set(n, (l = [])); l.push(i); } });
    // Bucket segments by y for fast ray and distance queries.
    const cell = Math.max(sealMm * 4, 0.05);
    const buckets = new Map<number, Seg[]>();
    for (const s of segs) {
      const lo = Math.floor((Math.min(s.y0, s.y1) - sealMm) / cell), hi = Math.floor((Math.max(s.y0, s.y1) + sealMm) / cell);
      for (let k = lo; k <= hi; k++) { let l = buckets.get(k); if (!l) buckets.set(k, (l = [])); l.push(s); }
    }
    let exposedHere = 0;
    for (const end of ends) {
      const [x, y] = point.get(end)!;
      const list = buckets.get(Math.floor(y / cell)) ?? [];
      // Inside a solid: winding number of the closed outlines around the point.
      let wind = 0;
      for (const sg of list) {
        if (!sg.closed) continue;
        if ((sg.y0 <= y) === (sg.y1 <= y)) continue;
        const xi = sg.x0 + ((y - sg.y0) / (sg.y1 - sg.y0)) * (sg.x1 - sg.x0);
        if (xi > x) wind += sg.y1 > sg.y0 ? 1 : -1;
      }
      if (wind > 0) continue;
      // Within a pixel of other surface. The end's own outline near it does not count: walk back along it
      // for a few pixels and leave those segments out.
      const own = new Set<Seg>();
      let node = end, walked = 0, prev = -1;
      while (walked < sealMm * 3) {
        const nextSeg = (touching.get(node) ?? []).find((i) => i !== prev);
        if (nextSeg === undefined) break;
        own.add(segs[nextSeg]!);
        walked += segs[nextSeg]!.len;
        const fs = faceSegs[nextSeg]!;
        node = fs.e0 === node ? fs.e1 : fs.e0;
        prev = nextSeg;
        if ((degree.get(node) ?? 0) !== 2) break;
      }
      let gap = Infinity;
      for (const sg of list) if (!own.has(sg)) gap = Math.min(gap, distToSeg(x, y, sg));
      if (gap <= sealMm) continue;
      // The bucket is only sure to hold segments within sealMm: measure the real gap against the layer.
      for (const sg of segs) if (!own.has(sg)) gap = Math.min(gap, distToSeg(x, y, sg));
      if (gap <= sealMm) continue;
      exposedHere++;
      report.exposed.push({ x, y, z, gapMm: gap, face: faceSegs[touching.get(end)![0]!]!.t });
      if (gap > report.widestGapMm) report.widestGapMm = gap;
    }
    if (exposedHere > 0) {
      report.exposedEnds += exposedHere;
      report.layersWithExposedEnds++;
      if (exposedHere > worst) { worst = exposedHere; report.worstLayerZ = z; }
    }
  }
  return report;
}

function distToSeg(x: number, y: number, s: Seg): number {
  const dx = s.x1 - s.x0, dy = s.y1 - s.y0, L = dx * dx + dy * dy;
  const t = L > 0 ? Math.min(1, Math.max(0, ((x - s.x0) * dx + (y - s.y0) * dy) / L)) : 0;
  return Math.hypot(x - (s.x0 + t * dx), y - (s.y0 + t * dy));
}
