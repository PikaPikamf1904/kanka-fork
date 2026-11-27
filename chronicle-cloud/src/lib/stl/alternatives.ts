// Smoothing methods measured against the workshop's approach (tests and benchmark only; the app does
// not import this file). All operate on an indexed mesh and keep its triangles; they MOVE vertices.
// Vertices on open edges, non-manifold edges and creases are held fixed ("feature-preserving").
import type { Mesh } from './mesh.ts';
import { buildEdges } from './mesh.ts';
import { edgeSagitta } from './enhance.ts';

function faceNormals(m: Mesh): Float64Array {
  const nt = m.tri.length / 3, p = m.pos, n = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = m.tri[t * 3]! * 3, b = m.tri[t * 3 + 1]! * 3, c = m.tri[t * 3 + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1;
    n[t * 3] = x / l; n[t * 3 + 1] = y / l; n[t * 3 + 2] = z / l;
  }
  return n;
}

/** Vertex neighbours (CSR) and which vertices must stay fixed (open, non-manifold or crease edges). */
function topology(m: Mesh, creaseDeg: number) {
  const nv = m.pos.length / 3, e = buildEdges(m), fn = faceNormals(m);
  const fixed = new Uint8Array(nv);
  const lim = Math.cos((creaseDeg * Math.PI) / 180);
  const deg = new Uint32Array(nv + 1);
  for (let i = 0; i < e.count; i++) {
    const a = e.a[i]!, b = e.b[i]!;
    deg[a + 1] = deg[a + 1]! + 1; deg[b + 1] = deg[b + 1]! + 1;
    let feature = e.uses[i] !== 2;
    if (!feature) { const f = e.f0[i]!, g = e.f1[i]!; feature = fn[f * 3]! * fn[g * 3]! + fn[f * 3 + 1]! * fn[g * 3 + 1]! + fn[f * 3 + 2]! * fn[g * 3 + 2]! < lim; }
    if (feature) { fixed[a] = 1; fixed[b] = 1; }
  }
  for (let v = 0; v < nv; v++) deg[v + 1] = deg[v + 1]! + deg[v]!;
  const nb = new Uint32Array(deg[nv]!), fill = deg.slice(0, nv);
  for (let i = 0; i < e.count; i++) { const a = e.a[i]!, b = e.b[i]!; nb[fill[a]!] = b; fill[a] = fill[a]! + 1; nb[fill[b]!] = a; fill[b] = fill[b]! + 1; }
  return { nv, start: deg, nb, fixed };
}

function laplacianStep(pos: Float64Array, t: ReturnType<typeof topology>, f: number, onlyIf?: Uint8Array): Float64Array {
  const next = Float64Array.from(pos);
  for (let v = 0; v < t.nv; v++) {
    if (t.fixed[v] || (onlyIf && !onlyIf[v])) continue;
    const s = t.start[v]!, n = t.start[v + 1]! - s;
    if (!n) continue;
    for (let k = 0; k < 3; k++) {
      let sum = 0;
      for (let i = s; i < s + n; i++) sum += pos[t.nb[i]! * 3 + k]!;
      next[v * 3 + k] = pos[v * 3 + k]! + f * (sum / n - pos[v * 3 + k]!);
    }
  }
  return next;
}

/** Taubin λ|μ with feature vertices fixed. */
export function taubinFeature(m: Mesh, creaseDeg = 40, iterations = 10, onlyIf?: Uint8Array): Mesh {
  const t = topology(m, creaseDeg);
  let pos: Float64Array = Float64Array.from(m.pos);
  for (let i = 0; i < iterations; i++) { pos = laplacianStep(pos, t, 0.5, onlyIf); pos = laplacianStep(pos, t, -0.53, onlyIf); }
  return { pos, tri: Uint32Array.from(m.tri) };
}

/** HC Laplacian (Vollmer, Mencl, Müller 1999): Laplacian with a pull back towards the original. */
export function hcLaplacian(m: Mesh, creaseDeg = 40, iterations = 10, alpha = 0.1, beta = 0.6): Mesh {
  const t = topology(m, creaseDeg);
  const o = m.pos;
  let p = Float64Array.from(o);
  for (let it = 0; it < iterations; it++) {
    const q = p;
    const lap = laplacianStep(q, t, 1);
    const b = new Float64Array(o.length);
    for (let i = 0; i < o.length; i++) b[i] = lap[i]! - (alpha * o[i]! + (1 - alpha) * q[i]!);
    p = Float64Array.from(lap);
    for (let v = 0; v < t.nv; v++) {
      if (t.fixed[v]) { for (let k = 0; k < 3; k++) p[v * 3 + k] = q[v * 3 + k]!; continue; }
      const s = t.start[v]!, n = t.start[v + 1]! - s;
      for (let k = 0; k < 3; k++) {
        let nbSum = 0;
        for (let i = s; i < s + n; i++) nbSum += b[t.nb[i]! * 3 + k]!;
        p[v * 3 + k] = lap[v * 3 + k]! - (beta * b[v * 3 + k]! + (n ? (1 - beta) * nbSum / n : 0));
      }
    }
  }
  return { pos: p, tri: Uint32Array.from(m.tri) };
}

/** Bilateral mesh denoising (Fleishman, Drori, Cohen-Or 2003), one-ring neighbourhood. */
export function bilateral(m: Mesh, creaseDeg = 40, iterations = 3): Mesh {
  const t = topology(m, creaseDeg);
  let pos = Float64Array.from(m.pos);
  for (let it = 0; it < iterations; it++) {
    // Vertex normals (area-weighted).
    const fn = faceNormals({ pos, tri: m.tri });
    const vn = new Float64Array(pos.length);
    for (let f = 0; f < m.tri.length / 3; f++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) { const i = m.tri[f * 3 + c]! * 3 + k; vn[i] = vn[i]! + fn[f * 3 + k]!; }
    const next = Float64Array.from(pos);
    for (let v = 0; v < t.nv; v++) {
      if (t.fixed[v]) continue;
      const s = t.start[v]!, n = t.start[v + 1]! - s;
      if (!n) continue;
      const nl = Math.hypot(vn[v * 3]!, vn[v * 3 + 1]!, vn[v * 3 + 2]!) || 1;
      const nx = vn[v * 3]! / nl, ny = vn[v * 3 + 1]! / nl, nz = vn[v * 3 + 2]! / nl;
      let sc = 0;
      for (let i = s; i < s + n; i++) { const q = t.nb[i]! * 3; sc += Math.hypot(pos[q]! - pos[v * 3]!, pos[q + 1]! - pos[v * 3 + 1]!, pos[q + 2]! - pos[v * 3 + 2]!); }
      const sigC = sc / n || 1;
      const hs: number[] = [];
      for (let i = s; i < s + n; i++) { const q = t.nb[i]! * 3; hs.push((pos[q]! - pos[v * 3]!) * nx + (pos[q + 1]! - pos[v * 3 + 1]!) * ny + (pos[q + 2]! - pos[v * 3 + 2]!) * nz); }
      const mean = hs.reduce((a, b) => a + b, 0) / n;
      const sigS = Math.sqrt(hs.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1e-9;
      let sum = 0, norm = 0;
      for (let i = s; i < s + n; i++) {
        const q = t.nb[i]! * 3;
        const d = Math.hypot(pos[q]! - pos[v * 3]!, pos[q + 1]! - pos[v * 3 + 1]!, pos[q + 2]! - pos[v * 3 + 2]!);
        const h = hs[i - s]!;
        const w = Math.exp(-(d * d) / (2 * sigC * sigC)) * Math.exp(-(h * h) / (2 * sigS * sigS));
        sum += w * h; norm += w;
      }
      const off = norm > 0 ? sum / norm : 0;
      next[v * 3] = pos[v * 3]! + nx * off; next[v * 3 + 1] = pos[v * 3 + 1]! + ny * off; next[v * 3 + 2] = pos[v * 3 + 2]! + nz * off;
    }
    pos = next;
  }
  return { pos, tri: Uint32Array.from(m.tri) };
}

/** Curvature-aware selective smoothing: Taubin only on vertices whose edges are visibly faceted. */
export function selectiveSmooth(m: Mesh, creaseDeg = 40, toleranceMm = 0.0075, iterations = 10): Mesh {
  const e = buildEdges(m), sag = edgeSagitta(m, e, creaseDeg);
  const faceted = new Uint8Array(m.pos.length / 3);
  for (let i = 0; i < e.count; i++) if (sag[i]! >= toleranceMm) { faceted[e.a[i]!] = 1; faceted[e.b[i]!] = 1; }
  return taubinFeature(m, creaseDeg, iterations, faceted);
}
