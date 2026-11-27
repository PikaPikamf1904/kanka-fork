// Measuring a change: how far the enhanced surface lies from the original (both directions), and how
// size and volume moved. Sampling is deterministic so the same file always gives the same numbers.
import type { Mesh } from './mesh.ts';
import { bounds, signedVolume, triangleArea } from './mesh.ts';
import { buildGrid, nearestDistance, type TriangleGrid } from './spatial.ts';

/** Small deterministic random generator (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Area-weighted random points on the surface, plus every vertex (so sharp corners are always tested). */
export function samplePoints(m: Mesh, count: number, seed = 1, includeVertices = true): Float64Array {
  const nt = m.tri.length / 3;
  const cdf = new Float64Array(nt);
  let total = 0;
  for (let t = 0; t < nt; t++) { total += triangleArea(m, t); cdf[t] = total; }
  const nv = includeVertices ? Math.min(m.pos.length / 3, count) : 0;
  const out = new Float64Array((count + nv) * 3);
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * total;
    let lo = 0, hi = nt - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid]! < x) lo = mid + 1; else hi = mid; }
    let u = r(), v = r();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const a = m.tri[lo * 3]! * 3, b = m.tri[lo * 3 + 1]! * 3, c = m.tri[lo * 3 + 2]! * 3;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = m.pos[a + k]! + u * (m.pos[b + k]! - m.pos[a + k]!) + v * (m.pos[c + k]! - m.pos[a + k]!);
  }
  // Evenly spread vertex sample when there are more vertices than points wanted.
  const vstep = (m.pos.length / 3) / Math.max(nv, 1);
  for (let j = 0; j < nv; j++) {
    const v = Math.floor(j * vstep) * 3;
    for (let k = 0; k < 3; k++) out[(count + j) * 3 + k] = m.pos[v + k]!;
  }
  return out;
}

/** Up to `count` of the mesh's vertices, evenly spread. */
export function vertexSample(m: Mesh, count: number): Float64Array {
  const nv = m.pos.length / 3;
  const n = Math.min(nv, count);
  const step = nv / n;
  const out = new Float64Array(n * 3);
  for (let j = 0; j < n; j++) { const v = Math.floor(j * step) * 3; out[j * 3] = m.pos[v]!; out[j * 3 + 1] = m.pos[v + 1]!; out[j * 3 + 2] = m.pos[v + 2]!; }
  return out;
}

export interface DistanceStats { mean: number; rms: number; p95: number; max: number }

export function distances(points: Float64Array, grid: TriangleGrid): DistanceStats {
  const n = points.length / 3;
  const d = new Float64Array(n);
  let sum = 0, sum2 = 0, max = 0;
  for (let i = 0; i < n; i++) {
    const v = nearestDistance(grid, points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!);
    d[i] = v; sum += v; sum2 += v * v; if (v > max) max = v;
  }
  d.sort();
  return { mean: sum / n, rms: Math.sqrt(sum2 / n), p95: d[Math.floor(n * 0.95)] ?? 0, max };
}

export interface Comparison {
  /** From points on the enhanced surface to the original surface: how far the new surface moved. */
  enhancedToOriginal: DistanceStats;
  /** From points on the original to the enhanced surface: whether any original detail was lost. */
  originalToEnhanced: DistanceStats;
  /** From the original's vertices to the enhanced surface: whether any original vertex (detail) moved. */
  originalVerticesToEnhanced: DistanceStats;
  /** Symmetric Hausdorff distance (sampled), mm. */
  hausdorff: number;
  volumeChangePct: number;
  /** Largest change in bounding-box size along any axis, mm. */
  sizeChangeMm: number;
}

export function compare(original: Mesh, enhanced: Mesh, samples = 30_000, grids?: { original?: TriangleGrid; enhanced?: TriangleGrid }): Comparison {
  const go = grids?.original ?? buildGrid(original);
  const ge = grids?.enhanced ?? buildGrid(enhanced);
  const e2o = distances(samplePoints(enhanced, samples, 7), go);
  const o2e = distances(samplePoints(original, samples, 11), ge);
  const verts = distances(vertexSample(original, samples), ge);
  const vo = signedVolume(original), ve = signedVolume(enhanced);
  const bo = bounds(original).size, be = bounds(enhanced).size;
  return {
    enhancedToOriginal: e2o, originalToEnhanced: o2e, originalVerticesToEnhanced: verts, hausdorff: Math.max(e2o.max, o2e.max),
    volumeChangePct: vo !== 0 ? ((ve - vo) / Math.abs(vo)) * 100 : 0,
    sizeChangeMm: Math.max(...[0, 1, 2].map((k) => Math.abs(be[k]! - bo[k]!))),
  };
}
