// Indexed triangle meshes: welding an STL's triangle soup, edge topology, analysis and safe repair.
// Repair only fixes what cannot be intended: zero-area and exactly repeated triangles, and faces that
// point the wrong way. It never fills holes, deletes parts or changes the shape.

export interface Mesh {
  /** 3 numbers per vertex, millimetres. */
  pos: Float64Array;
  /** 3 vertex indices per triangle. */
  tri: Uint32Array;
}

export const vertexCount = (m: Mesh) => m.pos.length / 3;
export const triangleCount = (m: Mesh) => m.tri.length / 3;

// ---------- small open-addressing hash tables over unsigned integer tuples ----------
function tableSize(n: number) {
  let s = 1;
  while (s < n * 2) s <<= 1;
  return s;
}
const h3 = (a: number, b: number, c: number) => ((Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0);

/** Merge corners that share a position (to a tolerance), turning an STL soup into an indexed mesh. */
export function weld(positions: Float32Array | Float64Array, tolerance?: number): Mesh {
  const n = positions.length / 3;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3]!, y = positions[i * 3 + 1]!, z = positions[i * 3 + 2]!;
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  // Default: a millionth of the model's size (0.05 µm on a 50 mm figure), far below any printer.
  const tol = tolerance ?? diag * 1e-6;
  const size = tableSize(n);
  const mask = size - 1;
  const slotQ = new Int32Array(size * 3);
  const slotV = new Int32Array(size).fill(-1);
  const pos = new Float64Array(n * 3);
  const tri = new Uint32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3]!, y = positions[i * 3 + 1]!, z = positions[i * 3 + 2]!;
    const qx = Math.round((x - minX) / tol), qy = Math.round((y - minY) / tol), qz = Math.round((z - minZ) / tol);
    let s = h3(qx, qy, qz) & mask;
    for (;;) {
      const v = slotV[s]!;
      if (v === -1) {
        slotV[s] = count; slotQ[s * 3] = qx; slotQ[s * 3 + 1] = qy; slotQ[s * 3 + 2] = qz;
        pos[count * 3] = x; pos[count * 3 + 1] = y; pos[count * 3 + 2] = z;
        tri[i] = count++;
        break;
      }
      if (slotQ[s * 3] === qx && slotQ[s * 3 + 1] === qy && slotQ[s * 3 + 2] === qz) { tri[i] = v; break; }
      s = (s + 1) & mask;
    }
  }
  return { pos: pos.slice(0, count * 3), tri };
}

/** Back to a triangle soup (for writing STL or drawing). */
export function toSoup(m: Mesh): Float32Array {
  const out = new Float32Array(m.tri.length * 3);
  for (let i = 0; i < m.tri.length; i++) {
    const v = m.tri[i]!;
    out[i * 3] = m.pos[v * 3]!; out[i * 3 + 1] = m.pos[v * 3 + 1]!; out[i * 3 + 2] = m.pos[v * 3 + 2]!;
  }
  return out;
}

// ---------- edge topology ----------
export interface Edges {
  count: number;
  /** Per edge: lower and higher vertex index. */
  a: Uint32Array; b: Uint32Array;
  /** Per edge: how many triangles use it (saturates at 255). */
  uses: Uint8Array;
  /** Per edge: first two triangles using it (-1 if none), and whether each runs a->b. */
  f0: Int32Array; f1: Int32Array; d0: Uint8Array; d1: Uint8Array;
  /** Per triangle corner (3 per triangle): the edge from this corner to the next. */
  ofCorner: Uint32Array;
}

export function buildEdges(m: Mesh, onExtraFace?: (edge: number, face: number) => void): Edges {
  const nt = m.tri.length / 3;
  const cap = m.tri.length;
  const size = tableSize(cap);
  const mask = size - 1;
  const slot = new Int32Array(size).fill(-1);
  const a = new Uint32Array(cap), b = new Uint32Array(cap);
  const uses = new Uint8Array(cap);
  const f0 = new Int32Array(cap).fill(-1), f1 = new Int32Array(cap).fill(-1);
  const d0 = new Uint8Array(cap), d1 = new Uint8Array(cap);
  const ofCorner = new Uint32Array(cap);
  let count = 0;
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const u = m.tri[t * 3 + k]!, w = m.tri[t * 3 + ((k + 1) % 3)]!;
      const lo = u < w ? u : w, hi = u < w ? w : u;
      const fwd = u < w ? 1 : 0;
      let s = h3(lo, hi, 0x9e37) & mask;
      let e: number;
      for (;;) {
        e = slot[s]!;
        if (e === -1) {
          e = count++;
          slot[s] = e; a[e] = lo; b[e] = hi;
          break;
        }
        if (a[e] === lo && b[e] === hi) break;
        s = (s + 1) & mask;
      }
      ofCorner[t * 3 + k] = e;
      const c = uses[e]!;
      if (c === 0) { f0[e] = t; d0[e] = fwd; } else if (c === 1) { f1[e] = t; d1[e] = fwd; } else onExtraFace?.(e, t);
      if (c < 255) uses[e] = c + 1;
    }
  }
  return { count, a: a.slice(0, count), b: b.slice(0, count), uses: uses.slice(0, count), f0: f0.slice(0, count), f1: f1.slice(0, count), d0: d0.slice(0, count), d1: d1.slice(0, count), ofCorner };
}

// ---------- geometry helpers ----------
export function triangleArea(m: Mesh, t: number): number {
  const i = m.tri[t * 3]! * 3, j = m.tri[t * 3 + 1]! * 3, k = m.tri[t * 3 + 2]! * 3;
  const ax = m.pos[j]! - m.pos[i]!, ay = m.pos[j + 1]! - m.pos[i + 1]!, az = m.pos[j + 2]! - m.pos[i + 2]!;
  const bx = m.pos[k]! - m.pos[i]!, by = m.pos[k + 1]! - m.pos[i + 1]!, bz = m.pos[k + 2]! - m.pos[i + 2]!;
  return 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
}
/** Six times the signed volume of the tetrahedron (origin, triangle). */
function signedVol6(m: Mesh, t: number): number {
  const i = m.tri[t * 3]! * 3, j = m.tri[t * 3 + 1]! * 3, k = m.tri[t * 3 + 2]! * 3;
  const p = m.pos;
  return p[i]! * (p[j + 1]! * p[k + 2]! - p[j + 2]! * p[k + 1]!) - p[i + 1]! * (p[j]! * p[k + 2]! - p[j + 2]! * p[k]!) + p[i + 2]! * (p[j]! * p[k + 1]! - p[j + 1]! * p[k]!);
}
export function signedVolume(m: Mesh): number {
  let v = 0;
  for (let t = 0; t < m.tri.length / 3; t++) v += signedVol6(m, t);
  return v / 6;
}
export function surfaceArea(m: Mesh): number {
  let s = 0;
  for (let t = 0; t < m.tri.length / 3; t++) s += triangleArea(m, t);
  return s;
}
export function bounds(m: Mesh) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = m.pos[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max, size: [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!] };
}

// ---------- connected parts (triangles joined by a shared edge) ----------
export function components(m: Mesh, edges: Edges): { of: Int32Array; count: number } {
  const nt = m.tri.length / 3;
  const parent = new Int32Array(nt);
  for (let i = 0; i < nt; i++) parent[i] = i;
  const find = (x: number) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; }
    return x;
  };
  const join = (x: number, y: number) => { const rx = find(x), ry = find(y); if (rx !== ry) parent[rx] = ry; };
  for (let e = 0; e < edges.count; e++) if (edges.f1[e]! >= 0) join(edges.f0[e]!, edges.f1[e]!);
  // Triangles beyond the second on a non-manifold edge belong with it too.
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const e = edges.ofCorner[t * 3 + k]!; if (edges.f0[e]! !== t) join(edges.f0[e]!, t); }
  const of = new Int32Array(nt);
  const ids = new Map<number, number>();
  for (let t = 0; t < nt; t++) {
    const r = find(t);
    let id = ids.get(r);
    if (id === undefined) { id = ids.size; ids.set(r, id); }
    of[t] = id;
  }
  return { of, count: ids.size };
}

// ---------- analysis ----------
export interface MeshReport {
  triangles: number;
  vertices: number;
  sizeMm: [number, number, number];
  minMm: [number, number, number];
  surfaceAreaMm2: number;
  /** Signed volume of the whole file (mm³); meaningful when every part is closed. */
  volumeMm3: number;
  parts: number;
  closedParts: number;
  openEdges: number;
  nonManifoldEdges: number;
  degenerateTriangles: number;
  duplicateTriangles: number;
  inconsistentEdges: number;
  invertedParts: number;
  edgeLengthMm: { min: number; median: number; max: number };
  /** Triangles whose longest edge is under the printer's XY pixel (tessellation finer than it can print). */
  subPixelTriangles: number;
  watertight: boolean;
}

export function analyze(m: Mesh, pixelMm = 0.034): MeshReport {
  const nt = m.tri.length / 3;
  const edges = buildEdges(m);
  let openEdges = 0, nonManifoldEdges = 0, inconsistentEdges = 0;
  for (let e = 0; e < edges.count; e++) {
    const u = edges.uses[e]!;
    if (u === 1) openEdges++;
    else if (u > 2) nonManifoldEdges++;
    else if (edges.d0[e] === edges.d1[e]) inconsistentEdges++;
  }
  const comp = components(m, edges);
  const closed = new Uint8Array(comp.count).fill(1);
  for (let e = 0; e < edges.count; e++) if (edges.uses[e] !== 2 || edges.d0[e] === edges.d1[e]) closed[comp.of[edges.f0[e]!]!] = 0;
  const vol = new Float64Array(comp.count);
  for (let t = 0; t < nt; t++) { const c = comp.of[t]!; vol[c] = vol[c]! + signedVol6(m, t) / 6; }
  let closedParts = 0, invertedParts = 0;
  for (let c = 0; c < comp.count; c++) if (closed[c]) { closedParts++; if (vol[c]! < 0) invertedParts++; }

  const degenerate = degenerateTriangles(m);
  const duplicates = duplicateTriangles(m);
  // Edge lengths (sampled for the median on very large meshes).
  const lens = new Float64Array(edges.count);
  let minL = Infinity, maxL = 0;
  for (let e = 0; e < edges.count; e++) {
    const i = edges.a[e]! * 3, j = edges.b[e]! * 3;
    const l = Math.hypot(m.pos[i]! - m.pos[j]!, m.pos[i + 1]! - m.pos[j + 1]!, m.pos[i + 2]! - m.pos[j + 2]!);
    lens[e] = l;
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
  }
  const sample = edges.count > 400_000 ? lens.filter((_, i) => i % Math.ceil(edges.count / 400_000) === 0) : lens.slice();
  sample.sort();
  let subPixel = 0;
  for (let t = 0; t < nt; t++) {
    const e0 = lens[edges.ofCorner[t * 3]!]!, e1 = lens[edges.ofCorner[t * 3 + 1]!]!, e2 = lens[edges.ofCorner[t * 3 + 2]!]!;
    if (Math.max(e0, e1, e2) < pixelMm) subPixel++;
  }
  const b = bounds(m);
  return {
    triangles: nt, vertices: m.pos.length / 3,
    sizeMm: b.size as [number, number, number], minMm: b.min as [number, number, number],
    surfaceAreaMm2: surfaceArea(m), volumeMm3: signedVolume(m),
    parts: comp.count, closedParts,
    openEdges, nonManifoldEdges, degenerateTriangles: degenerate.length, duplicateTriangles: duplicates.length,
    inconsistentEdges, invertedParts,
    edgeLengthMm: { min: Number.isFinite(minL) ? minL : 0, median: sample[Math.floor(sample.length / 2)] ?? 0, max: maxL },
    subPixelTriangles: subPixel,
    watertight: openEdges === 0 && nonManifoldEdges === 0 && inconsistentEdges === 0,
  };
}

/** Triangles with a repeated corner or (numerically) zero area. */
export function degenerateTriangles(m: Mesh): number[] {
  const out: number[] = [];
  const b = bounds(m);
  const scale = Math.max(...b.size, 1e-9);
  const minArea = scale * scale * 1e-14;
  for (let t = 0; t < m.tri.length / 3; t++) {
    const i = m.tri[t * 3]!, j = m.tri[t * 3 + 1]!, k = m.tri[t * 3 + 2]!;
    if (i === j || j === k || i === k || triangleArea(m, t) <= minArea) out.push(t);
  }
  return out;
}

/** Second and later copies of a triangle using the same three vertices (either winding). */
export function duplicateTriangles(m: Mesh): number[] {
  const nt = m.tri.length / 3;
  const size = tableSize(nt);
  const mask = size - 1;
  const slot = new Int32Array(size).fill(-1);
  // Each triangle's vertices sorted, stored once.
  const key = new Uint32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    let x = m.tri[t * 3]!, y = m.tri[t * 3 + 1]!, z = m.tri[t * 3 + 2]!, w: number;
    if (x > y) { w = x; x = y; y = w; }
    if (y > z) { w = y; y = z; z = w; }
    if (x > y) { w = x; x = y; y = w; }
    key[t * 3] = x; key[t * 3 + 1] = y; key[t * 3 + 2] = z;
  }
  const out: number[] = [];
  for (let t = 0; t < nt; t++) {
    const x = key[t * 3]!, y = key[t * 3 + 1]!, z = key[t * 3 + 2]!;
    let s = h3(x, y, z) & mask;
    for (;;) {
      const o = slot[s]!;
      if (o === -1) { slot[s] = t; break; }
      if (key[o * 3] === x && key[o * 3 + 1] === y && key[o * 3 + 2] === z) { out.push(t); break; }
      s = (s + 1) & mask;
    }
  }
  return out;
}

// ---------- repair ----------
export interface RepairLog {
  removedDegenerate: number;
  removedDuplicate: number;
  flippedTriangles: number;
  flippedParts: number;
}

/** Removes zero-area and repeated triangles and makes every part's faces point outwards. Nothing else. */
export function repair(input: Mesh): { mesh: Mesh; log: RepairLog } {
  const nIn = input.tri.length / 3;
  const drop = new Uint8Array(nIn);
  const degenerate = degenerateTriangles(input);
  for (const t of degenerate) drop[t] = 1;
  let removedDuplicate = 0;
  for (const t of duplicateTriangles(input)) if (!drop[t]) { drop[t] = 1; removedDuplicate++; }
  const removedDegenerate = degenerate.length;
  let nt = 0;
  for (let t = 0; t < nIn; t++) if (!drop[t]) nt++;
  const tri = new Uint32Array(nt * 3);
  for (let t = 0, i = 0; t < nIn; t++) if (!drop[t]) { tri[i * 3] = input.tri[t * 3]!; tri[i * 3 + 1] = input.tri[t * 3 + 1]!; tri[i * 3 + 2] = input.tri[t * 3 + 2]!; i++; }
  const mesh: Mesh = { pos: input.pos, tri };
  // Consistent winding inside each part: walk across manifold edges, flipping a neighbour that runs the
  // shared edge the same way. Non-manifold edges are not walked across (no consistent answer exists).
  const edges = buildEdges(mesh);
  const flip = new Uint8Array(nt);
  const seen = new Uint8Array(nt);
  const adjStart = new Uint32Array(nt + 1);
  for (let e = 0; e < edges.count; e++) if (edges.uses[e] === 2) { const i = edges.f0[e]! + 1, j = edges.f1[e]! + 1; adjStart[i] = adjStart[i]! + 1; adjStart[j] = adjStart[j]! + 1; }
  for (let t = 0; t < nt; t++) adjStart[t + 1] = adjStart[t + 1]! + adjStart[t]!;
  const adj = new Uint32Array(adjStart[nt]!);
  const fill = adjStart.slice(0, nt);
  for (let e = 0; e < edges.count; e++) if (edges.uses[e] === 2) { adj[fill[edges.f0[e]!]!++] = e; adj[fill[edges.f1[e]!]!++] = e; }
  const queue = new Uint32Array(nt);
  for (let s = 0; s < nt; s++) {
    if (seen[s]) continue;
    let head = 0, tail = 0;
    queue[tail++] = s; seen[s] = 1;
    while (head < tail) {
      const f = queue[head++]!;
      for (let i = adjStart[f]!; i < adjStart[f + 1]!; i++) {
        const e = adj[i]!;
        const g = edges.f0[e] === f ? edges.f1[e]! : edges.f0[e]!;
        if (seen[g]) continue;
        const df = (edges.f0[e] === f ? edges.d0[e]! : edges.d1[e]!) ^ flip[f]!;
        const dg = edges.f0[e] === f ? edges.d1[e]! : edges.d0[e]!;
        flip[g] = df === dg ? 1 : 0; // same direction -> inconsistent -> flip g
        seen[g] = 1;
        queue[tail++] = g;
      }
    }
  }
  let flippedTriangles = 0;
  const swap = (t: number) => { const x = mesh.tri[t * 3 + 1]!; mesh.tri[t * 3 + 1] = mesh.tri[t * 3 + 2]!; mesh.tri[t * 3 + 2] = x; };
  for (let t = 0; t < nt; t++) if (flip[t]) { swap(t); flippedTriangles++; }
  // Closed parts that enclose negative volume are inside out: turn the whole part.
  const e2 = buildEdges(mesh);
  const comp = components(mesh, e2);
  const closed = new Uint8Array(comp.count).fill(1);
  for (let e = 0; e < e2.count; e++) if (e2.uses[e] !== 2 || e2.d0[e] === e2.d1[e]) closed[comp.of[e2.f0[e]!]!] = 0;
  const vol = new Float64Array(comp.count);
  for (let t = 0; t < nt; t++) { const c = comp.of[t]!; vol[c] = vol[c]! + signedVol6(mesh, t); }
  let flippedParts = 0;
  const turn = new Uint8Array(comp.count);
  for (let c = 0; c < comp.count; c++) if (closed[c] && vol[c]! < 0) { turn[c] = 1; flippedParts++; }
  for (let t = 0; t < nt; t++) if (turn[comp.of[t]!]) { swap(t); flippedTriangles++; }
  return { mesh, log: { removedDegenerate, removedDuplicate, flippedTriangles, flippedParts } };
}
