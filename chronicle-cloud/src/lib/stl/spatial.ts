// A uniform grid over a mesh's triangles: nearest point on the surface (for measuring how far one
// surface is from another) and ray casting (for measuring wall thickness).
import { triangleArea, type Mesh } from './mesh.ts';

export interface TriangleGrid {
  mesh: Mesh;
  min: [number, number, number];
  cell: number;
  dims: [number, number, number];
  start: Uint32Array;
  items: Uint32Array;
}

export function buildGrid(mesh: Mesh, targetPerCell = 4): TriangleGrid {
  const nt = mesh.tri.length / 3;
  const p = mesh.pos;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, p[i + k]!); max[k] = Math.max(max[k]!, p[i + k]!); }
  const size = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!].map((s) => Math.max(s, 1e-9));
  // Triangles lie on a surface, not through the volume: size cells so a cell holds a few triangles of it.
  let area = 0;
  for (let t = 0; t < nt; t++) area += triangleArea(mesh, t);
  let cell = Math.sqrt(Math.max(area, 1e-12) / Math.max(1, nt / targetPerCell));
  // Keep the grid to a sane number of cells.
  while ((size[0]! / cell) * (size[1]! / cell) * (size[2]! / cell) > 8_000_000) cell *= 1.25;
  const dims: [number, number, number] = [0, 1, 2].map((k) => Math.max(1, Math.ceil(size[k]! / cell))) as [number, number, number];
  const idx = (x: number, k: number) => Math.min(dims[k]! - 1, Math.max(0, Math.floor((x - min[k]!) / cell)));
  const range = (t: number) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 3; c++) { const v = mesh.tri[t * 3 + c]! * 3; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[v + k]!); hi[k] = Math.max(hi[k]!, p[v + k]!); } }
    return [idx(lo[0]!, 0), idx(hi[0]!, 0), idx(lo[1]!, 1), idx(hi[1]!, 1), idx(lo[2]!, 2), idx(hi[2]!, 2)] as const;
  };
  const start = new Uint32Array(dims[0] * dims[1] * dims[2] + 1);
  const each = (t: number, f: (c: number) => void) => {
    const [x0, x1, y0, y1, z0, z1] = range(t);
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) f((z * dims[1] + y) * dims[0] + x);
  };
  for (let t = 0; t < nt; t++) each(t, (c) => { start[c + 1] = start[c + 1]! + 1; });
  for (let c = 1; c < start.length; c++) start[c] = start[c]! + start[c - 1]!;
  const items = new Uint32Array(start[start.length - 1]!);
  const fill = start.slice();
  for (let t = 0; t < nt; t++) each(t, (c) => { items[fill[c]!++] = t; });
  return { mesh, min, cell, dims, start, items };
}

/** Squared distance from point to triangle t (Ericson, Real-Time Collision Detection 5.1.5). */
export function pointTriangleDist2(g: TriangleGrid, t: number, px: number, py: number, pz: number): number {
  const p = g.mesh.pos, tri = g.mesh.tri;
  const a = tri[t * 3]! * 3, b = tri[t * 3 + 1]! * 3, c = tri[t * 3 + 2]! * 3;
  const ax = p[a]!, ay = p[a + 1]!, az = p[a + 2]!;
  const abx = p[b]! - ax, aby = p[b + 1]! - ay, abz = p[b + 2]! - az;
  const acx = p[c]! - ax, acy = p[c + 1]! - ay, acz = p[c + 2]! - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const sq = (x: number, y: number, z: number) => x * x + y * y + z * z;
  if (d1 <= 0 && d2 <= 0) return sq(apx, apy, apz);
  const bpx = px - p[b]!, bpy = py - p[b + 1]!, bpz = pz - p[b + 2]!;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return sq(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return sq(apx - v * abx, apy - v * aby, apz - v * abz); }
  const cpx = px - p[c]!, cpy = py - p[c + 1]!, cpz = pz - p[c + 2]!;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return sq(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return sq(apx - w * acx, apy - w * acy, apz - w * acz); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return sq(bpx - w * (p[c]! - p[b]!), bpy - w * (p[c + 1]! - p[b + 1]!), bpz - w * (p[c + 2]! - p[b + 2]!));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return sq(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w);
}

/** Distance from a point to the nearest point of the mesh surface. */
export function nearestDistance(g: TriangleGrid, px: number, py: number, pz: number): number {
  const { dims, cell, min, start, items } = g;
  const cx = Math.min(dims[0] - 1, Math.max(0, Math.floor((px - min[0]) / cell)));
  const cy = Math.min(dims[1] - 1, Math.max(0, Math.floor((py - min[1]) / cell)));
  const cz = Math.min(dims[2] - 1, Math.max(0, Math.floor((pz - min[2]) / cell)));
  let best = Infinity;
  const maxR = Math.max(dims[0], dims[1], dims[2]);
  // Distance from the point to the nearest face of its own cell: after searching shell r, everything
  // within r * cell + edge is covered.
  const edge = Math.max(0, Math.min(px - (min[0] + cx * cell), min[0] + (cx + 1) * cell - px, py - (min[1] + cy * cell), min[1] + (cy + 1) * cell - py, pz - (min[2] + cz * cell), min[2] + (cz + 1) * cell - pz));
  for (let r = 0; r <= maxR; r++) {
    if (r > 0 && Math.sqrt(best) <= (r - 1) * cell + edge) break;
    for (let z = cz - r; z <= cz + r; z++) {
      if (z < 0 || z >= dims[2]) continue;
      for (let y = cy - r; y <= cy + r; y++) {
        if (y < 0 || y >= dims[1]) continue;
        for (let x = cx - r; x <= cx + r; x++) {
          if (x < 0 || x >= dims[0]) continue;
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !== r) continue; // shell only
          const c = (z * dims[1] + y) * dims[0] + x;
          for (let i = start[c]!; i < start[c + 1]!; i++) {
            const d = pointTriangleDist2(g, items[i]!, px, py, pz);
            if (d < best) best = d;
          }
        }
      }
    }
  }
  return Math.sqrt(best);
}

/** Distance along a ray to the nearest triangle other than `skip` (Möller–Trumbore), or Infinity. */
export function rayHit(g: TriangleGrid, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, skip: number, maxDist: number): number {
  const { dims, cell, min, start, items, mesh } = g;
  const p = mesh.pos, tri = mesh.tri;
  let x = Math.floor((ox - min[0]) / cell), y = Math.floor((oy - min[1]) / cell), z = Math.floor((oz - min[2]) / cell);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const next = (o: number, d: number, i: number, k: number) => (d === 0 ? Infinity : ((min[k]! + (i + (d > 0 ? 1 : 0)) * cell) - o) / d);
  let tMaxX = next(ox, dx, x, 0), tMaxY = next(oy, dy, y, 1), tMaxZ = next(oz, dz, z, 2);
  const tdx = dx === 0 ? Infinity : cell / Math.abs(dx), tdy = dy === 0 ? Infinity : cell / Math.abs(dy), tdz = dz === 0 ? Infinity : cell / Math.abs(dz);
  let best = Infinity;
  let traveled = 0;
  while (traveled <= Math.min(best, maxDist)) {
    if (x >= 0 && y >= 0 && z >= 0 && x < dims[0] && y < dims[1] && z < dims[2]) {
      const c = (z * dims[1] + y) * dims[0] + x;
      for (let i = start[c]!; i < start[c + 1]!; i++) {
        const t = items[i]!;
        if (t === skip) continue;
        const a = tri[t * 3]! * 3, b = tri[t * 3 + 1]! * 3, cc = tri[t * 3 + 2]! * 3;
        const e1x = p[b]! - p[a]!, e1y = p[b + 1]! - p[a + 1]!, e1z = p[b + 2]! - p[a + 2]!;
        const e2x = p[cc]! - p[a]!, e2y = p[cc + 1]! - p[a + 1]!, e2z = p[cc + 2]! - p[a + 2]!;
        const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-18) continue;
        const inv = 1 / det;
        const sx = ox - p[a]!, sy = oy - p[a + 1]!, sz = oz - p[a + 2]!;
        const u = (sx * hx + sy * hy + sz * hz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist > 1e-9 && dist < best) best = dist;
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { traveled = tMaxX; tMaxX += tdx; x += stepX; }
    else if (tMaxY < tMaxZ) { traveled = tMaxY; tMaxY += tdy; y += stepY; }
    else { traveled = tMaxZ; tMaxZ += tdz; z += stepZ; }
    if (x < -1 || y < -1 || z < -1 || x > dims[0] || y > dims[1] || z > dims[2]) break;
  }
  return best <= maxDist ? best : Infinity;
}
