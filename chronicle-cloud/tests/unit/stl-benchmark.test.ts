// Method comparison and performance for the STL Workshop. Not part of the normal test run (slow):
//   STL_BENCH=1 npx vitest run --project unit tests/unit/stl-benchmark.test.ts
// Prints Markdown tables (or writes them to $STL_BENCH_OUT); the numbers in docs/chronicle/STL-WORKSHOP.md
// come from this file.
import { describe, it } from 'vitest';
import Module from 'manifold-3d';
import { CREASE_ANGLE_DEG, enhance, joinParts, loopSubdivide, midpointSubdivide, refinePart, splitParts, taubinSmooth, TOLERANCE_MM, type ManifoldModule } from '../../src/lib/stl/enhance.ts';
import { bilateral, hcLaplacian, selectiveSmooth, taubinFeature } from '../../src/lib/stl/alternatives.ts';
import { pnRefine } from '../../src/lib/stl/pn.ts';
import { weld } from '../../src/lib/stl/mesh.ts';
import { analyze, signedVolume, toSoup, type Mesh } from '../../src/lib/stl/mesh.ts';
import { compare, samplePoints } from '../../src/lib/stl/metrics.ts';
import { enhanceModel, readModel } from '../../src/lib/stl/pipeline.ts';
import { writeBinaryStl } from '../../src/lib/stl/stlIO.ts';
import { cylinder, icosphere, miniature, uvSphere, box } from './stlFixtures.ts';

const µm = (mm: number) => (mm * 1000).toFixed(mm * 1000 < 10 ? 2 : 1);
function sphereErr(m: Mesh, r: number) {
  const p = samplePoints(m, 40000, 3, false); let s = 0, mx = 0;
  for (let i = 0; i < p.length; i += 3) { const e = Math.abs(Math.hypot(p[i]!, p[i + 1]!, p[i + 2]!) - r); s += e; mx = Math.max(mx, e); }
  return { mean: s / (p.length / 3), max: mx };
}
function cylErr(m: Mesh, r: number, h: number) {
  const p = samplePoints(m, 40000, 3, false); let s = 0, n = 0, cap = 0;
  for (let i = 0; i < p.length; i += 3) {
    if (Math.abs(Math.abs(p[i + 2]!) - h / 2) < 1e-6) { cap = Math.max(cap, Math.max(0, Math.hypot(p[i]!, p[i + 1]!) - r)); continue; }
    s += Math.abs(Math.hypot(p[i]!, p[i + 1]!) - r); n++;
  }
  return { mean: s / n, capOverhang: cap, height: analyze(m).sizeMm[2] };
}

describe.runIf(process.env.STL_BENCH)('STL Workshop benchmark', () => {
  it('compares methods and measures performance', { timeout: 900_000 }, async () => {
    const w = await Module(); w.setup(); const M = w as unknown as ManifoldModule;
    const C = CREASE_ANGLE_DEG;
    const methods: [string, (m: Mesh, edge: number) => Mesh | null][] = [
      ['Original', (m) => m],
      ['Midpoint subdivision ×1', (m) => midpointSubdivide(m)],
      ['Loop subdivision ×1', (m) => loopSubdivide(m)],
      ['Taubin smoothing (10 it.)', (m) => taubinSmooth(m)],
      ['Feature-preserving Taubin', (m) => taubinFeature(m, C)],
      ['HC Laplacian (Vollmer 1999)', (m) => hcLaplacian(m, C)],
      ['Bilateral filtering (Fleishman 2003)', (m) => bilateral(m, C)],
      ['Curvature-selective smoothing', (m) => selectiveSmooth(m, C)],
      ['Hybrid: midpoint + selective smoothing', (m) => selectiveSmooth(midpointSubdivide(m), C)],
      ['manifold-3d smooth + adaptive refine (closed parts)', (m) => joinParts(splitParts(m).map((p) => refinePart(M, p, C, TOLERANCE_MM) ?? p))],
      ['Curved PN, adaptive (unguarded)', (m) => joinParts(splitParts(m).map((p) => pnRefine(p, { creaseAngleDeg: C, toleranceMm: TOLERANCE_MM, maxLevel: 6, maxTriangles: 1e7 })?.mesh ?? p))],
      ['Automatic pipeline (chosen)', (m) => enhance(M, m, { maxTriangles: 10_000_000 }).mesh],
    ];
    const out: string[] = [];
    const run = (title: string, m: Mesh, cols: string[], row: (r: Mesh, ms: number) => string[]) => {
      out.push(`\n### ${title}\n\n| Method | Triangles | ${cols.join(' | ')} | Time |\n|---|---|${cols.map(() => '---').join('|')}|---|`);
      const edge = analyze(m).edgeLengthMm.median;
      for (const [name, f] of methods) {
        const t0 = performance.now(); const r = f(m, edge); const ms = performance.now() - t0;
        if (!r) { out.push(`| ${name} | refused | ${cols.map(() => '—').join(' | ')} | |`); continue; }
        out.push(`| ${name} | ${(r.tri.length / 3).toLocaleString('en')} | ${row(r, ms).join(' | ')} | ${ms.toFixed(0)} ms |`);
      }
    };
    const R = 10, trueVol = (4 / 3) * Math.PI * R ** 3;
    run('Coarse sphere, R = 10 mm, 16 × 8 (truth known)', uvSphere(R, 16, 8), ['Mean error vs true sphere (µm)', 'Max error (µm)', 'Volume vs true', 'Original vertices moved (max µm)'], (r) => {
      const e = sphereErr(r, R); const c = compare(uvSphere(R, 16, 8), r);
      return [µm(e.mean), µm(e.max), `${((signedVolume(r) / trueVol - 1) * 100).toFixed(2)} %`, µm(c.originalVerticesToEnhanced.max)];
    });
    run('Coarse cylinder, R = 5 mm, h = 20 mm, 12 sides (truth known)', cylinder(5, 20, 12), ['Side error vs true cylinder (µm)', 'Cap overhang (µm)', 'Height (mm)'], (r) => {
      const e = cylErr(r, 5, 20); return [µm(e.mean), µm(e.capOverhang), e.height.toFixed(4)];
    });
    // An open surface (as many Hero Forge parts are): only methods that accept open meshes can help.
    const hs = uvSphere(R, 16, 8), keep: number[] = [];
    for (let t = 0; t < hs.tri.length / 3; t++) if ([0, 1, 2].reduce((a, k) => a + hs.pos[hs.tri[t * 3 + k]! * 3 + 2]!, 0) > 0) keep.push(hs.tri[t * 3]!, hs.tri[t * 3 + 1]!, hs.tri[t * 3 + 2]!);
    const half = weld(toSoup({ pos: hs.pos, tri: Uint32Array.from(keep) }));
    run('Open hemisphere, R = 10 mm (truth known; not a closed solid)', half, ['Mean error vs true sphere (µm)', 'Max error (µm)', 'Original vertices moved (max µm)'], (r) => {
      const e = sphereErr(r, R); return [µm(e.mean), µm(e.max), µm(compare(half, r).originalVerticesToEnhanced.max)];
    });
    run('Cube, 20 mm (sharp edges)', box(20, 20, 20), ['Hausdorff vs original (µm)', 'Volume change'], (r) => {
      const c = compare(box(20, 20, 20), r); return [µm(c.hausdorff), `${c.volumeChangePct.toFixed(3)} %`];
    });
    const mini = miniature();
    run('Miniature-like assembly (engraved 0.12 mm band, 0.4 mm blade, 0.25 mm fingers)', mini, ['Original vertices moved (max µm)', 'Surface moved (max µm)', 'Volume change', 'Parts'], (r) => {
      const c = compare(mini, r); return [µm(c.originalVerticesToEnhanced.max), µm(c.enhancedToOriginal.max), `${c.volumeChangePct.toFixed(2)} %`, String(analyze(r).parts)];
    });
    const fine = icosphere(4, 6);
    run('Finely tessellated sphere, R = 4 mm, 81,920 triangles (~0.07 mm edges, sculpt-export density)', fine, ['Mean error vs true sphere (µm)', 'Max error (µm)'], (r) => {
      const e = sphereErr(r, 4); return [µm(e.mean), µm(e.max)];
    });

    if (process.env.STL_BENCH_OUT) (await import('node:fs')).writeFileSync(process.env.STL_BENCH_OUT, out.join('\n'));
    else console.log(out.join('\n'));
  });

  // Writes the large synthetic STL files used for the pipeline measurements:
  //   STL_BENCH=1 STL_BENCH_WRITE=/tmp/stl-bench npx vitest run --project unit tests/unit/stl-benchmark.test.ts -t write
  it.runIf(process.env.STL_BENCH_WRITE)('write', { timeout: 300_000 }, async () => {
    const fs = await import('node:fs');
    const dir = process.env.STL_BENCH_WRITE!;
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, m] of [['ico7-327k', icosphere(15, 7)], ['ico8-1310k', icosphere(15, 8)], ['uv-coarse-160k', uvSphere(15, 400, 200)], ['mini-5k', miniature()]] as [string, Mesh][]) {
      fs.writeFileSync(`${dir}/${name}.stl`, new Uint8Array(writeBinaryStl(toSoup(m), m.tri.length / 3)));
    }
  });

  // Whole pipeline on one large STL file, in its own process so the memory figure is the pipeline's:
  //   STL_BENCH=1 STL_BENCH_FILE=/path/model.stl npx vitest run --project unit tests/unit/stl-benchmark.test.ts -t pipeline
  it.runIf(process.env.STL_BENCH_FILE)('pipeline', { timeout: 900_000 }, async () => {
    const w = await Module(); w.setup(); const M = w as unknown as ManifoldModule;
    const fs = await import('node:fs');
    const file = fs.readFileSync(process.env.STL_BENCH_FILE!);
    const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    const rssBefore = process.resourceUsage().maxRSS * 1024;
    const t0 = performance.now();
    const { mesh, out } = readModel('bench.stl', data, 0.034);
    const tRead = performance.now() - t0;
    const r = enhanceModel(M, mesh, { maxTriangles: 12_000_000, minWallMm: 0.5, pixelMm: 0.034 }, () => undefined);
    const peak = process.resourceUsage().maxRSS * 1024;
    const line = `PIPELINE | ${(file.byteLength / 1e6).toFixed(1)} MB | ${out.report.triangles.toLocaleString('en')} | ${r.enhanced.triangles.toLocaleString('en')} | ${r.result.verdict} | ${tRead.toFixed(0)} ms | ${r.timingsMs.repair} ms | ${r.timingsMs.enhance} ms | ${r.timingsMs.fragile} ms | ${r.timingsMs['write+verify']} ms | ${((peak - rssBefore) / 1e6).toFixed(0)} MB |`;
    if (process.env.STL_BENCH_OUT) fs.appendFileSync(process.env.STL_BENCH_OUT, line + '\n'); else console.log(line);
  });
});
