// Synthetic STL fixtures with known true surfaces (no third-party models). All sizes in millimetres.
import type { Mesh } from '../../src/lib/stl/mesh.ts';
import { joinParts } from '../../src/lib/stl/enhance.ts';

/** UV sphere: `seg` around, `rings` from pole to pole. A coarse one is visibly faceted. */
export function uvSphere(r: number, seg: number, rings: number, center: [number, number, number] = [0, 0, 0]): Mesh {
  const pos: number[] = [center[0], center[1], center[2] + r];
  for (let i = 1; i < rings; i++) {
    const th = (Math.PI * i) / rings;
    for (let j = 0; j < seg; j++) {
      const ph = (2 * Math.PI * j) / seg;
      pos.push(center[0] + r * Math.sin(th) * Math.cos(ph), center[1] + r * Math.sin(th) * Math.sin(ph), center[2] + r * Math.cos(th));
    }
  }
  pos.push(center[0], center[1], center[2] - r);
  const south = pos.length / 3 - 1;
  const tri: number[] = [];
  const at = (i: number, j: number) => 1 + (i - 1) * seg + (j % seg);
  for (let j = 0; j < seg; j++) tri.push(0, at(1, j), at(1, j + 1));
  for (let i = 1; i < rings - 1; i++) for (let j = 0; j < seg; j++) tri.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  for (let j = 0; j < seg; j++) tri.push(south, at(rings - 1, j + 1), at(rings - 1, j));
  return { pos: Float64Array.from(pos), tri: Uint32Array.from(tri) };
}

/** Icosphere: subdivided icosahedron projected to the sphere (fine, even triangles like a scan or sculpt). */
export function icosphere(r: number, level: number, center: [number, number, number] = [0, 0, 0]): Mesh {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const norm = (v: number[]) => { const l = Math.hypot(v[0]!, v[1]!, v[2]!); return v.map((x) => x / l); };
  verts = verts.map(norm);
  for (let l = 0; l < level; l++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      let i = cache.get(k);
      if (i === undefined) { i = verts.length; verts.push(norm([0, 1, 2].map((c) => (verts[a]![c]! + verts[b]![c]!) / 2))); cache.set(k, i); }
      return i;
    };
    faces = faces.flatMap(([a, b, c]) => { const ab = mid(a!, b!), bc = mid(b!, c!), ca = mid(c!, a!); return [[a!, ab, ca], [b!, bc, ab], [c!, ca, bc], [ab, bc, ca]]; });
  }
  return { pos: Float64Array.from(verts.flatMap((v) => [center[0] + v[0]! * r, center[1] + v[1]! * r, center[2] + v[2]! * r])), tri: Uint32Array.from(faces.flat()) };
}

/** Closed cylinder along Z with flat caps (sharp rims). */
export function cylinder(r: number, h: number, seg: number, center: [number, number, number] = [0, 0, 0]): Mesh {
  const pos: number[] = [];
  for (const z of [-h / 2, h / 2]) for (let j = 0; j < seg; j++) { const a = (2 * Math.PI * j) / seg; pos.push(center[0] + r * Math.cos(a), center[1] + r * Math.sin(a), center[2] + z); }
  pos.push(center[0], center[1], center[2] - h / 2, center[0], center[1], center[2] + h / 2);
  const bot = 2 * seg, top = 2 * seg + 1;
  const tri: number[] = [];
  for (let j = 0; j < seg; j++) {
    const a = j, b = (j + 1) % seg, c = seg + j, d = seg + ((j + 1) % seg);
    tri.push(a, b, d, a, d, c, bot, b, a, top, c, d);
  }
  return { pos: Float64Array.from(pos), tri: Uint32Array.from(tri) };
}

/** Axis-aligned box (two triangles per side). */
export function box(sx: number, sy: number, sz: number, center: [number, number, number] = [0, 0, 0]): Mesh {
  const [cx, cy, cz] = center;
  const p: number[] = [];
  for (let i = 0; i < 8; i++) p.push(cx + (i & 1 ? sx : -sx) / 2, cy + (i & 2 ? sy : -sy) / 2, cz + (i & 4 ? sz : -sz) / 2);
  const tri = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];
  return { pos: Float64Array.from(p), tri: Uint32Array.from(tri) };
}

/**
 * A figure-like assembly, as separate closed parts the way miniature exports often are: a finely
 * tessellated head with an engraved band 0.12 mm deep (fine detail), a torso, a 0.4 mm thick blade and
 * 0.25 mm "fingers" (fragile), all at miniature scale (~30 mm tall).
 */
export function miniature(): Mesh {
  const head = icosphere(4, 4, [0, 0, 26]);
  for (let i = 0; i < head.pos.length; i += 3) {
    const dz = head.pos[i + 2]! - 26;
    if (Math.abs(dz) < 0.3) { // engraved band around the "brow"
      const x = head.pos[i]!, y = head.pos[i + 1]!;
      const rr = Math.hypot(x, y);
      const s = (rr - 0.12) / rr;
      head.pos[i] = x * s; head.pos[i + 1] = y * s;
    }
  }
  const torso = cylinder(3, 14, 40, [0, 0, 14]);
  const blade = box(0.4, 3, 15, [6, 0, 16]);
  const fingers = [0, 1, 2].map((i) => cylinder(0.25, 3, 8, [-4 + i * 0.7, 0, 9]));
  return joinParts([head, torso, blade, ...fingers]);
}

/** A mesh with every kind of defect the repair step handles (and some it must leave alone). */
export function defective(): { mesh: Mesh; expect: { duplicate: number; degenerate: number; flipped: number } } {
  const cube = box(10, 10, 10);
  const tri = Array.from(cube.tri);
  tri.push(tri[0]!, tri[1]!, tri[2]!); // exact duplicate
  tri.push(0, 0, 1); // degenerate (repeated vertex)
  [tri[3], tri[4]] = [tri[4]!, tri[3]!]; // one face wound backwards
  const fixedCube = { pos: cube.pos, tri: Uint32Array.from(tri) };
  // An open part: a sphere with one triangle missing (must stay open: holes are not filled).
  const s = uvSphere(3, 12, 6, [20, 0, 0]);
  const open = { pos: s.pos, tri: s.tri.slice(3) };
  // A non-manifold part: a box with an extra fin triangle on one edge.
  const b = box(4, 4, 4, [-20, 0, 0]);
  const fin = { pos: Float64Array.from([...b.pos, -20, 0, 6]), tri: Uint32Array.from([...b.tri, b.tri[0]!, b.tri[1]!, 8]) };
  return { mesh: joinParts([fixedCube, open, fin]), expect: { duplicate: 1, degenerate: 1, flipped: 1 } };
}
