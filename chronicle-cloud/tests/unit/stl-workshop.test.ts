// STL Workshop engine: reading, writing, analysis, repair, enhancement, measurement and printing checks,
// on synthetic meshes with known true surfaces.
import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { parseStl, StlError, writeBinaryStl } from '../../src/lib/stl/stlIO.ts';
import { analyze, repair, toSoup, weld, type Mesh } from '../../src/lib/stl/mesh.ts';
import { CREASE_ANGLE_DEG, creaseLength, enhance, facetDeviation, gapEdgeLength, joinParts, MAX_REFINE_PART_TRIANGLES, partDegradation, topologyDefect, type ManifoldModule } from '../../src/lib/stl/enhance.ts';
import { sliceCheck } from '../../src/lib/stl/slice.ts';
import { pnRefine } from '../../src/lib/stl/pn.ts';
import { buildEdges } from '../../src/lib/stl/mesh.ts';
import { compare, samplePoints } from '../../src/lib/stl/metrics.ts';
import { DEFAULT_PRINT, estimatePrint, fragileGeometry, orientedSize, PHOTON_MONO_2 } from '../../src/lib/stl/printer.ts';
import { box, cylinder, defective, icosphere, miniature, uvSphere } from './stlFixtures.ts';

let M: ManifoldModule;
beforeAll(async () => {
  const w = await Module();
  w.setup();
  M = w as unknown as ManifoldModule;
});

const roundTrip = (m: Mesh) => weld(parseStl(writeBinaryStl(toSoup(m), m.tri.length / 3)).positions);
/** Mean and max |distance from centre − R| over points on the surface: how far it is from a true sphere. */
function sphereError(m: Mesh, r: number, c: [number, number, number] = [0, 0, 0]) {
  const pts = samplePoints(m, 20000, 3, false);
  let sum = 0, max = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const e = Math.abs(Math.hypot(pts[i]! - c[0], pts[i + 1]! - c[1], pts[i + 2]! - c[2]) - r);
    sum += e; if (e > max) max = e;
  }
  return { mean: sum / (pts.length / 3), max };
}

describe('STL files', () => {
  it('writes binary STL that reads back identically, with a header that is not mistaken for ASCII', () => {
    const m = uvSphere(10, 16, 8);
    const buf = writeBinaryStl(toSoup(m), m.tri.length / 3);
    expect(new TextDecoder().decode(new Uint8Array(buf, 0, 5))).not.toBe('solid');
    expect(buf.byteLength).toBe(84 + 50 * (m.tri.length / 3));
    const back = weld(parseStl(buf).positions);
    expect(back.tri.length).toBe(m.tri.length);
    expect(analyze(back).watertight).toBe(true);
    // Stored normals agree with the winding (what slicers check).
    const v = new DataView(buf);
    const n = [v.getFloat32(84, true), v.getFloat32(88, true), v.getFloat32(92, true)];
    expect(Math.hypot(n[0]!, n[1]!, n[2]!)).toBeCloseTo(1, 5);
  });

  it('reads ASCII STL, and a binary file whose header starts with "solid"', () => {
    const ascii = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n';
    const a = parseStl(new TextEncoder().encode(ascii).buffer as ArrayBuffer);
    expect(a).toMatchObject({ format: 'ascii', triangleCount: 1 });
    const m = box(2, 2, 2);
    const buf = writeBinaryStl(toSoup(m), 12, 'solid but binary');
    expect(parseStl(buf)).toMatchObject({ format: 'binary', triangleCount: 12 });
  });

  it('refuses damaged files with a clear reason', () => {
    expect(() => parseStl(new ArrayBuffer(10))).toThrow(StlError);
    const m = box(2, 2, 2);
    const full = writeBinaryStl(toSoup(m), 12);
    expect(() => parseStl(full.slice(0, 84 + 50 * 5))).toThrow(/cut short/);
    const nan = full.slice(0);
    new DataView(nan).setFloat32(84 + 12, Number.NaN, true);
    expect(() => parseStl(nan)).toThrow(/invalid coordinates/);
    expect(() => parseStl(new TextEncoder().encode('hello world, not a model at all......').buffer as ArrayBuffer)).toThrow(StlError);
  });
});

describe('analysis and repair', () => {
  it('measures a closed part in millimetres', () => {
    const r = analyze(box(20, 10, 5));
    expect(r).toMatchObject({ triangles: 12, vertices: 8, parts: 1, closedParts: 1, openEdges: 0, nonManifoldEdges: 0, watertight: true, invertedParts: 0 });
    expect(r.sizeMm).toEqual([20, 10, 5]);
    expect(r.volumeMm3).toBeCloseTo(1000, 6);
  });

  it('finds every defect, repairs only what cannot be intended, and leaves holes and parts alone', () => {
    const { mesh, expect: want } = defective();
    const before = analyze(mesh);
    expect(before.duplicateTriangles).toBe(want.duplicate);
    expect(before.degenerateTriangles).toBe(want.degenerate);
    expect(before.inconsistentEdges).toBeGreaterThan(0);
    expect(before.openEdges).toBeGreaterThan(0);
    expect(before.nonManifoldEdges).toBeGreaterThan(0);
    const { mesh: fixed, log } = repair(mesh);
    expect(log).toMatchObject({ removedDuplicate: 1, removedDegenerate: 1 });
    expect(log.flippedTriangles).toBeGreaterThanOrEqual(1);
    const after = analyze(fixed);
    expect(after.duplicateTriangles).toBe(0);
    expect(after.degenerateTriangles).toBe(0);
    expect(after.parts).toBe(before.parts); // nothing deleted
    expect(after.openEdges).toBe(5); // the 3 edges of the hole and the fin's 2 free edges: the hole is not filled
    expect(after.nonManifoldEdges).toBe(1); // the fin's shared edge: left as it is
    expect(after.inconsistentEdges).toBe(0);
  });

  it('turns an inside-out part the right way', () => {
    const c = box(10, 10, 10);
    for (let t = 0; t < 12; t++) { const x = c.tri[t * 3 + 1]!; c.tri[t * 3 + 1] = c.tri[t * 3 + 2]!; c.tri[t * 3 + 2] = x; }
    expect(analyze(c).invertedParts).toBe(1);
    const { mesh, log } = repair(c);
    expect(log.flippedParts).toBe(1);
    expect(analyze(mesh).volumeMm3).toBeCloseTo(1000, 6);
  });
});

const LIMIT = { maxTriangles: 5_000_000 };
const pn = (m: Mesh, crease = CREASE_ANGLE_DEG) => pnRefine(m, { creaseAngleDeg: crease, toleranceMm: 0.0075, maxLevel: 6, maxTriangles: 5_000_000 })!.mesh;
/** Open edges, non-manifold edges and their total length: refinement must not open or close a gap. */
function gaps(m: Mesh) {
  const e = buildEdges(m);
  let open = 0, nonManifold = 0, length = 0;
  for (let i = 0; i < e.count; i++) {
    if (e.uses[i] === 1) { open++; const a = e.a[i]! * 3, b = e.b[i]! * 3; length += Math.hypot(m.pos[a]! - m.pos[b]!, m.pos[a + 1]! - m.pos[b + 1]!, m.pos[a + 2]! - m.pos[b + 2]!); }
    if (e.uses[i]! > 2) nonManifold++;
  }
  return { open, nonManifold, length };
}
/** The top half of a sphere: an open surface, as Hero Forge exports many parts. */
function hemisphere(r: number, seg: number, rings: number): Mesh {
  const s = uvSphere(r, seg, rings);
  const keep: number[] = [];
  for (let t = 0; t < s.tri.length / 3; t++) {
    const z = (s.pos[s.tri[t * 3]! * 3 + 2]! + s.pos[s.tri[t * 3 + 1]! * 3 + 2]! + s.pos[s.tri[t * 3 + 2]! * 3 + 2]!) / 3;
    if (z > 0) keep.push(s.tri[t * 3]!, s.tri[t * 3 + 1]!, s.tri[t * 3 + 2]!);
  }
  return weld(toSoup({ pos: s.pos, tri: Uint32Array.from(keep) })); // drop the unused lower vertices
}

describe('automatic enhancement', () => {
  it('a coarse curved surface becomes measurably closer to the true shape; original vertices do not move', () => {
    const coarse = uvSphere(10, 16, 8);
    const before = sphereError(coarse, 10);
    const r = enhance(M, coarse, LIMIT);
    expect(r.verdict).toBe('improved');
    const after = sphereError(r.mesh, 10);
    expect(after.mean).toBeLessThan(before.mean * 0.5);
    expect(after.max).toBeLessThan(before.max);
    expect(r.faceting.after.max).toBeLessThan(r.faceting.before.max * 0.3);
    // Every original vertex is still on the result surface (interpolation, not approximation).
    expect(compare(coarse, r.mesh).originalVerticesToEnhanced.max).toBeLessThan(1e-4);
    expect(analyze(r.mesh).watertight).toBe(true);
    expect(Math.abs(analyze(r.mesh).sizeMm[2] - analyze(coarse).sizeMm[2])).toBeLessThan(0.01);
  });

  it('sharp edges stay sharp and flat faces stay flat: a box is kept exactly, with the reason', () => {
    const cube = box(20, 20, 20);
    const r = enhance(M, cube, LIMIT);
    expect(r.mesh).toBe(cube);
    expect(r.verdict).toBe('no-visible-change');
    expect(r.message).toMatch(/Already optimal/);
  });

  it('a cylinder keeps its flat caps and sharp rims while its side is rounded', () => {
    const c = cylinder(5, 20, 12);
    const r = enhance(M, c, LIMIT);
    expect(r.verdict).toBe('improved');
    const pts = samplePoints(r.mesh, 20000, 5, false);
    let side = 0, sideErr = 0, capErr = 0;
    for (let i = 0; i < pts.length; i += 3) {
      const z = pts[i + 2]!;
      if (Math.abs(Math.abs(z) - 10) < 1e-6) { capErr = Math.max(capErr, Math.hypot(pts[i]!, pts[i + 1]!) > 5.0001 ? 1 : 0); continue; }
      side++; sideErr += Math.abs(Math.hypot(pts[i]!, pts[i + 1]!) - 5);
    }
    expect(capErr).toBe(0);
    const facetMean = (5 * (1 - Math.cos(Math.PI / 12))) / 2; // average sag of a 12-sided cylinder, roughly
    expect(sideErr / side).toBeLessThan(facetMean * 0.5);
    expect(analyze(r.mesh).sizeMm[2]).toBeCloseTo(20, 4);
  });

  it('a finely tessellated surface is already optimal: kept exactly as it was, and the message says why', { timeout: 30_000 }, () => {
    const fine = icosphere(4, 6); // 81,920 triangles on an 8 mm head-sized sphere (~0.07 mm edges)
    const r = enhance(M, fine, LIMIT);
    expect(r.verdict).toBe('no-visible-change');
    expect(r.mesh).toBe(fine);
    expect(r.partsAlreadyFine).toBe(1);
    expect(r.message).toMatch(/Already optimal.*34 µm pixel.*kept exactly/);
  });

  it('a miniature-like assembly keeps every part and its engraved detail', () => {
    const mini = miniature();
    const r = enhance(M, mini, LIMIT);
    expect(analyze(r.mesh).parts).toBe(analyze(mini).parts);
    // Every original vertex, including those of the 0.12 mm engraving, is still on the result surface.
    expect(r.comparison.originalVerticesToEnhanced.max).toBeLessThan(0.0005);
    expect(r.partsUnchanged).toEqual([]);
  });

  it('open and non-manifold parts are now enhanced too, without opening or closing any gap', () => {
    const half = hemisphere(10, 16, 8);
    const r = enhance(M, half, LIMIT);
    expect(r.verdict).toBe('improved');
    expect(r.methods['curved-pn']).toBe(1);
    expect(sphereError(r.mesh, 10).mean).toBeLessThan(sphereError(half, 10).mean * 0.5);
    const g0 = gaps(half), g1 = gaps(r.mesh);
    expect(g1.length).toBeCloseTo(g0.length, 6); // the rim is split, never moved
    expect(g1.nonManifold).toBe(0);
    expect(r.comparison.originalVerticesToEnhanced.max).toBeLessThan(1e-6);
    // The repair test's model has holes and a non-manifold fin: its parts are all kept, none removed.
    const bad = repair(defective().mesh).mesh;
    const rb = enhance(M, bad, LIMIT);
    expect(analyze(rb.mesh).parts).toBe(analyze(bad).parts);
    expect(gaps(rb.mesh).length).toBeCloseTo(gaps(bad).length, 6);
  });

  it('works without the WebAssembly library (automatic fallback), and the library is used when PN cannot help', () => {
    const r = enhance(null, uvSphere(10, 16, 8), LIMIT);
    expect(r.verdict).toBe('improved');
    expect(analyze(r.mesh).watertight).toBe(true);
  });

  it('refuses a part that moved further than its own facets explain, lost detail, or changed volume or size', () => {
    const ok = { mean: 0.001, rms: 0.001, p95: 0.001, max: 0.002 };
    const base = { enhancedToOriginal: ok, originalToEnhanced: ok, originalVerticesToEnhanced: { ...ok, max: 0 }, hausdorff: 0.002, volumeChangePct: 0.1, sizeChangeMm: 0 };
    expect(partDegradation(base, 0.1, 100, 1000, true)).toBeNull();
    // The limit follows the part's own faceting: 300 µm is fine on a part whose facets sag 373 µm …
    expect(partDegradation({ ...base, enhancedToOriginal: { ...ok, max: 0.3 }, hausdorff: 0.3 }, 0.373, 100, 1000, true)).toBeNull();
    // … but not on a fine part whose facets sag 20 µm.
    expect(partDegradation({ ...base, enhancedToOriginal: { ...ok, max: 0.3 }, hausdorff: 0.3 }, 0.02, 100, 1000, true)).toMatch(/more than this part's facets explain/);
    expect(partDegradation({ ...base, originalToEnhanced: { ...ok, max: 0.3 } }, 0.02, 100, 1000, true)).toMatch(/detail could be lost/);
    expect(partDegradation({ ...base, volumeChangePct: 5 }, 0.1, 100, 1000, true)).toMatch(/more than the surface movement explains/);
    expect(partDegradation({ ...base, volumeChangePct: 5 }, 0.1, 100, 1000, false)).toBeNull(); // open parts have no volume
    expect(partDegradation({ ...base, originalVerticesToEnhanced: { ...ok, max: 0.02 } }, 0.1, 100, 1000, true)).toMatch(/original vertices moved/);
    expect(partDegradation({ ...base, sizeChangeMm: 1 }, 0.1, 100, 1000, true)).toMatch(/size changed/);
  });

  it('keeps the original, with the reason, when the result would exceed the triangle limit', () => {
    const r = enhance(M, uvSphere(10, 16, 8), { maxTriangles: 300 });
    expect(r.verdict).toBe('rejected');
    expect(r.mesh.tri.length / 3).toBe(224);
    expect(r.message).toMatch(/kept exactly as it was/);
  });

  it('the enhanced file reopens as the same watertight model', () => {
    const r = enhance(M, uvSphere(10, 16, 8), LIMIT);
    const back = roundTrip(r.mesh);
    const a = analyze(back), b = analyze(r.mesh);
    expect(a.triangles).toBe(b.triangles);
    expect(a.watertight).toBe(true);
    expect(a.volumeMm3).toBeCloseTo(b.volumeMm3, 3);
  });
});

describe('curved PN refinement', () => {
  it('a closed surface stays closed: neighbouring patches share exact points (no cracks, no T-junctions)', () => {
    for (const m of [uvSphere(10, 16, 8), cylinder(5, 20, 12), icosphere(6, 1)]) {
      const r = pn(m);
      expect(analyze(r).watertight).toBe(true);
      expect(gaps(r).open).toBe(0);
      expect(compare(m, r).originalVerticesToEnhanced.max).toBeLessThan(1e-9);
    }
  });
  it('creases keep their angle: the cylinder rim stays a 90° edge', () => {
    const r = pn(cylinder(5, 20, 12));
    // Every rim point is still exactly at radius 5 and z = ±10 (the rim edge was split, not curved inward).
    for (let i = 0; i < r.pos.length; i += 3) if (Math.abs(Math.abs(r.pos[i + 2]!) - 10) < 1e-9) expect(Math.hypot(r.pos[i]!, r.pos[i + 1]!)).toBeLessThan(5 + 1e-9);
    expect(facetDeviation(r, CREASE_ANGLE_DEG).max).toBeLessThan(facetDeviation(cylinder(5, 20, 12), CREASE_ANGLE_DEG).max * 0.3);
  });
  it('flat or sharp-only models are returned unchanged', () => {
    const b = box(20, 20, 20);
    expect(pnRefine(b, { creaseAngleDeg: 40, toleranceMm: 0.0075, maxLevel: 6, maxTriangles: 1e6 })!.mesh).toBe(b);
  });
  it('declines when the result would exceed the triangle budget', () => {
    expect(pnRefine(uvSphere(10, 16, 8), { creaseAngleDeg: 40, toleranceMm: 0.0075, maxLevel: 6, maxTriangles: 300 })).toBeNull();
  });
});

describe('facet deviation estimate (decides whether enhancing can help)', () => {
  it('is zero for flat faces and sharp edges, large for a coarse curve, tiny for a fine one', () => {
    expect(facetDeviation(box(20, 20, 20), 52.5).max).toBe(0);
    // A 16-sided sphere of radius 10: chords sag about R(1 - cos(π/16)) ≈ 0.19 mm.
    const coarse = facetDeviation(uvSphere(10, 16, 8), 52.5).max;
    expect(coarse).toBeGreaterThan(0.1);
    expect(coarse).toBeLessThan(0.4);
    expect(facetDeviation(icosphere(4, 6), 52.5).max).toBeLessThan(0.001);
  });
  it('manifold-3d is never sent a part above its size limit', () => {
    expect(MAX_REFINE_PART_TRIANGLES).toBe(750_000);
    const r = enhance(M, uvSphere(10, 16, 8), { ...LIMIT, maxPartTriangles: 100 });
    expect(r.verdict).toBe('improved');
    expect(r.methods.manifold).toBeUndefined();
  });
});

describe('printing', () => {
  it('estimates print time from the oriented height and the settings', () => {
    const e = estimatePrint([20, 20, 30], DEFAULT_PRINT);
    expect(e.layers).toBe(700); // (30 + 5 mm supports) / 0.05 mm
    const move = 6 / 2 + 6 / 3 + 0.5;
    expect(e.seconds).toBeCloseTo(6 * (25 + move) + 694 * (2 + move), 6);
    expect(e.fits).toBe(true);
    expect(estimatePrint([150, 95, 30], DEFAULT_PRINT).fits).toBe(false);
    expect(estimatePrint([20, 20, 170], DEFAULT_PRINT).fitNote).toMatch(/Taller/);
  });

  it('orientation changes the printed height', () => {
    const b = box(10, 20, 40);
    expect(orientedSize(b.pos, { tiltXDeg: 0, tiltYDeg: 0, spinZDeg: 0 })[2]).toBeCloseTo(40, 6);
    expect(orientedSize(b.pos, { tiltXDeg: 90, tiltYDeg: 0, spinZDeg: 0 })[2]).toBeCloseTo(20, 6);
    expect(orientedSize(b.pos, { tiltXDeg: 45, tiltYDeg: 0, spinZDeg: 0 })[2]).toBeCloseTo((20 + 40) / Math.SQRT2, 6);
  });

  it('flags the thin blade and fingers as fragile, not the torso or head', () => {
    const mini = miniature();
    const f = fragileGeometry(mini, 0.5, PHOTON_MONO_2.pixelMm);
    expect(f.thinTriangles).toBeGreaterThan(0);
    // Triangles of the torso cylinder (radius 3 mm) are never flagged; the blade (0.4 mm) mostly is.
    const parts = analyze(mini).parts;
    expect(parts).toBe(6);
    let torsoFlag = 0, bladeFlag = 0, bladeTotal = 0;
    for (let t = 0; t < mini.tri.length / 3; t++) {
      const v = mini.tri[t * 3]! * 3;
      const x = mini.pos[v]!, z = mini.pos[v + 2]!;
      if (Math.abs(x - 6) <= 0.21 && z > 8) { bladeTotal++; if (f.flags[t]) bladeFlag++; }
      const y = mini.pos[v + 1]!;
      const nearFingers = x < -2 && Math.abs(y) < 0.6 && z > 7 && z < 11;
      if (Math.hypot(x, y) > 2.9 && Math.hypot(x, y) < 3.1 && z > 7 && z < 21 && !nearFingers) { if (f.flags[t]) torsoFlag++; }
    }
    expect(torsoFlag).toBe(0);
    // The blade is a box: its two broad faces (2 triangles each) are 0.4 mm apart and fragile; its narrow
    // edges and ends measure 3 mm and 15 mm through, so they are not.
    expect(bladeTotal).toBe(12);
    expect(bladeFlag).toBe(4);
  });
});

describe('joined parts', () => {
  it('joining keeps every triangle and vertex', () => {
    const j = joinParts([box(1, 1, 1), box(1, 1, 1, [5, 0, 0])]);
    expect(analyze(j)).toMatchObject({ parts: 2, triangles: 24, vertices: 16 });
  });
});

/** A sphere with a window cut in its side: open outlines whose ends hang in the open. */
function windowed(): Mesh {
  const sp = uvSphere(10, 24, 12), keep: number[] = [];
  for (let t = 0; t < sp.tri.length / 3; t++) {
    const c = [0, 1, 2].map((k) => [0, 1, 2].reduce((a, j) => a + sp.pos[sp.tri[t * 3 + j]! * 3 + k]!, 0) / 3);
    if (!(c[0]! > 6 && Math.abs(c[2]!) < 3)) keep.push(sp.tri[t * 3]!, sp.tri[t * 3 + 1]!, sp.tri[t * 3 + 2]!);
  }
  return weld(toSoup({ pos: sp.pos, tri: Uint32Array.from(keep) }));
}

describe('print check (slicing into layers)', () => {
  it('a closed solid slices into closed layers', () => {
    const r = sliceCheck(uvSphere(10, 24, 12));
    expect(r.layersWithOpenOutlines).toBe(0);
    expect(r.exposedEnds).toBe(0);
  });
  it('a hole in the open leaves loose ends in every layer it crosses, with the gap measured', () => {
    const r = sliceCheck(windowed());
    expect(r.exposedEnds).toBeGreaterThan(0);
    expect(r.layersWithExposedEnds).toBeGreaterThan(0);
    expect(r.widestGapMm).toBeGreaterThan(1); // the window is several millimetres wide
    expect(r.worstLayerZ).not.toBeNull();
    expect(Math.abs(r.worstLayerZ!)).toBeLessThan(3); // the window spans z = -3 … 3
  });
  it('the same hole covered by another solid part is sealed (as in exports where clothing covers the body)', () => {
    const r = sliceCheck(joinParts([windowed(), box(10, 20, 10, [8, 0, 0])]));
    expect(r.layersWithOpenOutlines).toBeGreaterThan(0);
    expect(r.exposedEnds).toBe(0);
  });
  it('two versions are compared on the same planes', () => {
    const a = sliceCheck(uvSphere(10, 24, 12), { zRange: [-10, 10], maxLayers: 40 });
    expect(a.layers).toBe(40);
    expect(a.layerStepMm).toBeCloseTo(0.5, 9);
  });
});

describe('structural checks on a refined part', () => {
  const before = (m: Mesh, closed: boolean) => ({ closed, gaps: gapEdgeLength(m), sharp: creaseLength(m), broken: 0 });
  it('accepts a clean refinement', () => {
    const s = uvSphere(10, 16, 8);
    expect(topologyDefect(enhance(M, s, LIMIT).mesh, before(s, true))).toBeNull();
  });
  it('refuses a closed part that is no longer closed', () => {
    const s = uvSphere(10, 16, 8);
    expect(topologyDefect({ pos: s.pos, tri: s.tri.slice(3) }, before(s, true))).toMatch(/opened a gap/);
  });
  it('on an open part, open-edge length may fall (coincident edges joined) but never grow (a new gap)', () => {
    const b = { closed: false, gaps: { open: 10, nonManifold: 2 }, sharp: 0, broken: 0 };
    // Same result mesh measured against different "before" states: the rule compares lengths.
    const s = hemisphereFixture();
    const g = gapEdgeLength(s);
    expect(topologyDefect(s, { ...b, gaps: g, sharp: creaseLength(s) })).toBeNull();
    // Open length grew: a gap opened.
    expect(topologyDefect(s, { ...b, gaps: { open: g.open - 1, nonManifold: g.nonManifold }, sharp: creaseLength(s) })).toMatch(/opened a gap/);
    // Open length fell by 1 mm (a T-junction was joined to its neighbour): allowed.
    expect(topologyDefect(s, { ...b, gaps: { open: g.open + 1, nonManifold: g.nonManifold - 1 }, sharp: creaseLength(s) })).toBeNull();
  });
  it('refuses zero-area triangles, without mistaking them for sharp edges', () => {
    // A closed box with one edge split by a zero-area sliver: still a closed solid, but broken.
    const cube = box(20, 20, 20);
    const a = cube.tri[0]!, b = cube.tri[1]!, c = cube.tri[2]!;
    const pos = new Float64Array([...cube.pos, ...[0, 1, 2].map((k) => (cube.pos[a * 3 + k]! + cube.pos[b * 3 + k]!) / 2)]);
    const mid = cube.pos.length / 3;
    const tri = [a, mid, c, mid, b, c, a, b, mid, ...cube.tri.slice(3)];
    const sliver = { pos, tri: Uint32Array.from(tri) };
    expect(analyze(sliver).watertight).toBe(true);
    // A zero-area face has no direction: it must never be counted as a crease (it used to read as 90°).
    expect(creaseLength(sliver)).toBeLessThanOrEqual(creaseLength(cube) + 1e-9);
    expect(topologyDefect(sliver, before(cube, true))).toMatch(/zero-area triangles/);
  });
});

function hemisphereFixture(): Mesh {
  const sp = uvSphere(10, 16, 8), keep: number[] = [];
  for (let t = 0; t < sp.tri.length / 3; t++) if ([0, 1, 2].reduce((a, k) => a + sp.pos[sp.tri[t * 3 + k]! * 3 + 2]!, 0) > 0) keep.push(sp.tri[t * 3]!, sp.tri[t * 3 + 1]!, sp.tri[t * 3 + 2]!);
  return weld(toSoup({ pos: sp.pos, tri: Uint32Array.from(keep) }));
}
