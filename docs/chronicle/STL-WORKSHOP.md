# STL Workshop (DM): research, design and measurements

**DM → STL workshop** (`/dm/stl`). Upload → Analyse → Enhance → Compare → Download, entirely in the DM's
browser. The model is never uploaded, stored or sent anywhere.

## What "enhancement" can and cannot do

An STL is a set of flat triangles. Whatever detail the sculptor exported is in the positions of its
vertices; nothing can recover detail that is not in the file, and this tool does not try to. What *can*
be improved is **faceting**: on a curved surface, the flat triangles between vertices sit slightly inside
the true curve. If those facets are larger than the printer can resolve (one pixel on the Photon Mono 2 is
34 µm; one layer 20–50 µm), they print as visible flats. The workshop fits a smooth surface **through the
existing vertices** and adds vertices only where the facets are measurably off it.

**More triangles is not more detail.** Splitting every triangle at its edge midpoints quadruples the
count and changes the shape by exactly nothing (measured below).

## Methods compared (measured, not assumed)

All numbers from `tests/unit/stl-benchmark.test.ts` (Node 22, 4 cores, one thread), on synthetic meshes
whose true surfaces are known. Run it with
`STL_BENCH=1 npx vitest run --project unit tests/unit/stl-benchmark.test.ts`.

Candidates:
- **Midpoint subdivision**: splits triangles, never moves anything. Baseline for "more polygons".
- **Loop subdivision** (Loop 1987): approximating; moves original vertices toward the average of their
  neighbours.
- **Taubin λ|μ smoothing** (Taubin 1995): a low-pass filter that resists shrinking; moves vertices.
- **manifold-3d `smoothOut` + `refineToLength`**: fits a G1-continuous curved surface through the original
  vertices (edges sharper than an angle stay sharp; flat faces stay flat), then splits every edge to a fixed length.
- **manifold-3d `smoothOut` + `refineToTolerance` (chosen)**: the same surface, but edges are split only
  where the facets are further than a tolerance from it (curvature-adaptive).

Not implemented, on design grounds (no measurement made):
- **Surface reconstruction** (e.g. screened Poisson). It replaces the original vertices with an implicit
  surface sampled at its own resolution, so it cannot guarantee that the original detail survives. It is
  intended for scans and point clouds, not for meshes exported from a sculpting tool.
- **Learned "upscaling".** It adds detail that is not in the file, which is exactly what must not happen to
  a character's design.


### Coarse sphere, R = 10 mm, 16 × 8 (truth known)
| Method | Triangles | Mean error vs true sphere (µm) | Max error (µm) | Volume vs true | Original vertices moved (max µm) | Time |
|---|---|---|---|---|---|---|
| Original | 224 | 212.1 | 373.6 | -6.26 % | 0.00 | 0 ms |
| Midpoint subdivision ×1 | 896 | 212.6 | 373.6 | -6.26 % | 0.00 | 1 ms |
| Loop subdivision ×1 | 896 | 366.6 | 467.2 | -10.60 % | 373.4 | 1 ms |
| Taubin smoothing (10 it.) | 224 | 234.7 | 463.8 | -6.28 % | 138.6 | 3 ms |
| manifold-3d smooth + uniform refine | 2,368 | 21.2 | 42.8 | -0.63 % | 0.00 | 13 ms |
| manifold-3d smooth + adaptive refine (chosen) | 5,568 | 10.00 | 20.4 | -0.28 % | 0.00 | 323 ms |

### Coarse cylinder, R = 5 mm, h = 20 mm, 12 sides (truth known)
| Method | Triangles | Side error vs true cylinder (µm) | Cap overhang (µm) | Height (mm) | Time |
|---|---|---|---|---|---|
| Original | 48 | 113.0 | 0.00 | 20.0000 | 0 ms |
| Midpoint subdivision ×1 | 192 | 113.3 | 0.00 | 20.0000 | 0 ms |
| Loop subdivision ×1 | 192 | 654.0 | 0.00 | 20.0000 | 0 ms |
| Taubin smoothing (10 it.) | 48 | 1303.9 | 0.00 | 16.6227 | 1 ms |
| manifold-3d smooth + uniform refine | 864 | 28.4 | 0.00 | 20.0000 | 2 ms |
| manifold-3d smooth + adaptive refine (chosen) | 864 | 4.56 | 0.00 | 20.0000 | 155 ms |

### Cube, 20 mm (sharp edges)
| Method | Triangles | Hausdorff vs original (µm) | Volume change | Time |
|---|---|---|---|---|
| Original | 12 | 0.00 | 0.000 % | 0 ms |
| Midpoint subdivision ×1 | 48 | 0.00 | 0.000 % | 0 ms |
| Loop subdivision ×1 | 48 | 6495.2 | -50.977 % | 0 ms |
| Taubin smoothing (10 it.) | 12 | 15381.9 | -99.753 % | 0 ms |
| manifold-3d smooth + uniform refine | 192 | 0.00 | 0.000 % | 1 ms |
| manifold-3d smooth + adaptive refine (chosen) | 12 | 0.00 | 0.000 % | 0 ms |

### Miniature-like assembly (engraved 0.12 mm band, 0.4 mm blade, 0.25 mm fingers)
| Method | Triangles | Original vertices moved (max µm) | Surface moved (max µm) | Volume change | Parts | Time |
|---|---|---|---|---|---|---|
| Original | 5,388 | 0.00 | 0.00 | 0.00 % | 6 | 0 ms |
| Midpoint subdivision ×1 | 21,552 | 0.00 | 0.00 | -0.00 % | 6 | 5 ms |
| Loop subdivision ×1 | 21,552 | 1304.5 | 789.7 | -12.28 % | 6 | 9 ms |
| Taubin smoothing (10 it.) | 5,388 | 4569.2 | 2141.3 | -33.22 % | 6 | 7 ms |
| manifold-3d smooth + uniform refine | 147,488 | 0.00 | 19.0 | 0.33 % | 6 | 256 ms |
| manifold-3d smooth + adaptive refine (chosen) | 11,188 | 0.00 | 19.0 | 0.21 % | 6 | 156 ms |

### Finely tessellated sphere, R = 4 mm, 81,920 triangles (~0.07 mm edges, sculpt-export density)
| Method | Triangles | Mean error vs true sphere (µm) | Max error (µm) | Time |
|---|---|---|---|---|
| Original | 81,920 | 0.18 | 0.28 | 0 ms |
| Midpoint subdivision ×1 | 327,680 | 0.18 | 0.28 | 25 ms |
| Loop subdivision ×1 | 327,680 | 0.32 | 0.39 | 31 ms |
| Taubin smoothing (10 it.) | 81,920 | 0.05 | 0.26 | 87 ms |
| manifold-3d smooth + uniform refine | 937,952 | 0.02 | 0.04 | 1644 ms |
| manifold-3d smooth + adaptive refine (chosen) | 81,920 | 0.18 | 0.28 | 117 ms |

What the numbers say:
- Loop subdivision and Taubin smoothing make every test shape *worse*. They shrink volume, move original
  vertices by up to 4.6 mm, and destroy a cube's edges (−51 % and −99.8 % volume). They are unsuitable
  for detailed miniatures.
- The manifold-3d surface is the only method that improves the true-shape error. The coarse sphere goes
  from 212 µm to 10 µm mean and the cylinder side from 113 µm to 4.6 µm. Original vertices move 0.00 µm,
  and flat faces and sharp edges are unchanged.
- **Adaptive refinement beats uniform refinement:** on the miniature-like assembly it gives the same surface
  change (19 µm) with 11,188 triangles instead of 147,488. Adaptive is also more accurate on the coarse shapes.
- **A finely tessellated model gains nothing.** At sculpt-export density (~0.07 mm edges), the original is
  already 0.18 µm from the true sphere, roughly 190 times finer than a printer pixel. The workshop says so and
  recommends the original instead of producing a bigger file. Hero Forge exports were not available to
  measure (they are licensed per customer). The **Analysis** panel shows the actual facet deviation of
  whatever file is uploaded, so the DM sees whether enhancement can matter for that file before running it.

## Whole pipeline: speed and memory (one large file per process)

Read, repair, enhance with measurement, fragile check, write, then re-read and verify. These are synthetic
files, measured on Node 22, one thread. The memory column is the growth of the process's peak resident memory.

| File | Size | Triangles in | Triangles out | Verdict | Read | Repair | Enhance + measure | Fragile | Write + verify | Peak memory added |
|---|---|---|---|---|---|---|---|---|---|---|
| mini-5k | 0.3 MB | 5,388 | 11,188 | improved | 36 ms | 34 ms | 211 ms | 53 ms | 26 ms | 38 MB |
| uv-coarse-160k | 8.0 MB | 159,200 | 159,200 | no-visible-change | 228 ms | 297 ms | 266 ms | 368 ms | 219 ms | 130 MB |
| ico7-327k | 16.4 MB | 327,680 | 327,680 | no-visible-change | 389 ms | 488 ms | 554 ms | 667 ms | 399 ms | 184 MB |
| ico8-1310k | 65.5 MB | 1,310,720 | 1,310,720 | no-visible-change | 1383 ms | 2090 ms | 1569 ms | 1560 ms | 1448 ms | 547 MB |

Before the facet pre-check below, the 1.31-million-triangle file needed 9.1 s and 2.6 GB. Almost all of
that memory was the geometry library refining a part that had nothing printable to gain. The pre-check
estimates each part's largest facet deviation in JavaScript, as the chord sagitta L/2 · tan(θ/4) per
smooth edge. If the whole part is under half the tolerance, it is not sent to the library. Parts that do
need refinement are limited to 750,000 triangles each (about 1.5 kB of library memory per triangle,
measured); larger parts are left unchanged, with that reason shown. Finally, the processing worker is
discarded after each job or cancel, which returns all of its memory to the system.

## The pipeline

1. **Read** binary or ASCII STL. A damaged file is refused with the reason: cut short, invalid numbers, or
   not an STL. A binary header that starts with "solid" is still read correctly.
2. **Weld** identical corners (tolerance: a millionth of the model size) into an indexed mesh.
3. **Analyse**:
   - size (mm), volume, parts (closed or open)
   - open, non-manifold and wrongly-wound edges; inside-out parts
   - zero-area and repeated triangles
   - edge lengths, triangles below one pixel, and facet deviation on curves
4. **Repair** only what cannot be intended: remove zero-area and exactly repeated triangles, make windings
   consistent, and turn inside-out closed parts. **Holes are never filled and no part is removed.**
5. **Enhance** each closed part as described above.
   - Parts that are open or non-manifold, or that the library refuses, are left exactly as they were, with
     the reason shown.
   - Strength (automatic = 0.5) sets the angle above which edges stay sharp (40°–65°) and the tolerance
     (12 µm down to 3 µm).
6. **Guard**: the result is measured against the original (sampled both ways, plus every original vertex).
   It is refused, and the original kept, if any of these hold:
   - an original vertex moved by more than 5 µm
   - the surface moved further than half a typical edge (at least 50 µm)
   - the volume changed more than the measured surface movement explains
   - the overall size changed
   - the output would exceed the triangle limit

   One gentler retry is made first. If the change is below 2 µm, the verdict is "no printable change" and the
   original is recommended.
7. **Fragile check**: a ray is cast inward from every triangle (a sample on very large meshes) to measure
   wall thickness. Thinner than the chosen minimum (default 0.5 mm) is shown amber; thinner than one pixel
   (34 µm, will not print) is shown red.
8. **Write** a binary STL in millimetres with correct facet normals. Its header does not start with
   "solid", so no slicer mistakes it for ASCII. The written file is re-read and re-analysed before it is offered.

## Printer: Anycubic Photon Mono 2

- **Profile:** nominal 34 µm XY pixel and nominal build volume. Every print setting is editable: layer
  height, exposure, bottom exposure and layers, lift distance and speed, retract speed, light-off delay,
  support height.
- **Print time** = bottom layers × (bottom exposure + movement) + other layers × (exposure + movement),
  where the layer count comes from the model's height **as oriented** (tilt about X and Y) plus the
  support height. On an MSLA printer the width doesn't matter.
- **Fit check:** against the nominal build volume.
- **What it does not do:** it is an estimate. Supports, hollowing and orientation are decided in Lychee,
  and nothing here claims a model is printable.

## Integration and security

- **Access:** a DM-only route (`DmOnly`), with a DM navigation link and a command-palette entry. Players
  get neither.
- **No server:** no upload, no storage, no new service, nothing paid.
- **Libraries:** three.js (MIT, 0.187.0) is a separate chunk loaded only on the workshop page.
  manifold-3d (Apache-2.0, 3.5.4) and its 541 KB WebAssembly file load inside the worker, only when
  **Enhance** is pressed. The main bundle grew by 410 bytes (the route and the links).
- **Content Security Policy:** `script-src` gains `'wasm-unsafe-eval'` so the browser may compile the
  WebAssembly file served by this site. JavaScript `eval`/`new Function` remain blocked. This is the
  narrowest directive that allows WebAssembly. It applies site-wide because the CSP is one header for all
  paths.
- **Vite:** `worker.format: 'es'` (module workers may load code on demand). Both workers in the app are
  module workers; the knowledge graph's worker is covered by the existing browser tests.

## Tests

- **Unit:** `tests/unit/stl-workshop.test.ts`
  - files: round-trip, ASCII, "solid" binary headers, damaged files
  - analysis and defect detection
  - repair that leaves holes and parts alone
  - enhancement of a sphere and a cylinder against their true shapes
  - cube unchanged; fine mesh recognised as fine
  - miniature: vertices and parts preserved
  - degradation guard, triangle limit, per-part limit
  - written file re-read
  - facet-deviation estimate
  - print time, orientation, fragile detection
- **Browser:** `tests/e2e/stl-workshop.spec.ts`
  - a damaged file is refused
  - upload, analyse, enhance, 3D comparison, print estimate and a download that is re-read
  - cancel, then reload
  - tablet width with no sideways scrolling
  - players cannot open it

## Limits

- No real Hero Forge file was measured. Results on real exports depend on their tessellation, which the
  analysis panel reports.
- Wall thickness is measured straight through each surface. It does not see thin parts that are thin
  sideways, and it samples very large meshes.
- Overlapping parts (common in exports) are processed separately and are not merged.
- Print-time movement is modelled as lift and retract at constant speed. Real printers accelerate, and some
  use two-stage lifts.
- Large files need memory: about 550 MB for 1.3 million triangles with no refinement, more when refining.
  Low-memory tablets may struggle above roughly a million triangles.
