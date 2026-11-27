# STL Workshop (DM): research, design and measurements

**DM → STL workshop** (`/dm/stl`). Two actions only: **upload** and **download**. Everything between
(analysis, repair, choosing and running the enhancement, checking it, writing the file) is automatic and
runs entirely in the DM's browser. The model is never uploaded, stored or sent anywhere. There are no
settings and no presets.

## What "enhancement" can and cannot do

An STL is a set of flat triangles. Whatever detail the sculptor exported is in the positions of its
vertices; nothing can recover detail that is not in the file, and this tool does not try to. What *can*
be improved is **faceting**: on a curved surface, the flat triangles between vertices sit slightly inside
the true curve. If those facets are larger than the printer can resolve (one pixel on the Photon Mono 2 is
34 µm; one layer 20–50 µm), they print as visible flats. The workshop fits a smooth surface **through the
existing vertices** and adds vertices only where the facets are measurably off it. Every original vertex
stays exactly where it was.

**More triangles is not more detail.** Splitting every triangle at its edge midpoints quadruples the
count and changes the shape by exactly nothing (measured below).

## Why a real Hero Forge export used to be refused

A real Hero Forge export supplied by the DM (84,602 triangles, 27 × 29 × 44 mm; not committed, kept out
of the repository) was refused by the first version: "the surface moved up to 427 µm (limit 103 µm)",
and after the gentler retry 293 µm. Investigating it found three faults, none of which was "the limit is
too low":

1. **The movement limit was one number for the whole model** (half the median edge, 103 µm). The file
   has 192 parts: a finely tessellated body and coarse accessories whose facets really are hundreds of
   microns off their curves. Rounding those out *must* move their surface by about that much. The limit
   now comes from each part's own measured faceting, and each part is accepted or kept on its own.
2. **Only closed parts could be refined at all.** 168 of the 192 parts, including the main body, are open
   or non-manifold (6,120 open edges, 1,200 non-manifold edges), which the geometry library rejects. A
   second refiner that works on any triangle mesh was added (curved PN triangles, below).
3. **The faceting estimate used the wrong length.** It multiplied the edge's *own length* by the turn
   across it. The curve across an edge spans the faces' width *across* it: on a cylinder's side the long
   edges run along the straight axis. The estimate now uses the faces' height over the edge, and a
   per-face bound that adds the two most-curved edges (a face curved two ways, like a sphere, sags in both
   at once). With the old estimate this file appeared to have 373 µm facets; correctly measured, its
   worst facet is 129 µm.

The movement limit was not simply raised. A part's result is still refused if it moves further than its
own faceting explains (see **Checks**), and a fine part's limit stayed small.

### Result on that file (automatic pipeline, Node 22, one thread)

| | Original (repaired) | Optimised |
|---|---|---|
| Triangles | 84,540 | 531,970 |
| Faceting on curves, worst / 95 % of edges | 129 µm / 18.7 µm | 31 µm / 3.1 µm |
| Original vertices moved | — | 0 µm |
| Surface moved, max / mean | — | 122 µm / 7.8 µm |
| Volume | — | +0.81 % |
| Size (mm) | 27.276 × 29.394 × 44.158 | 27.279 × 29.394 × 44.210 |
| Parts refined / already smooth / kept | — | 34 / 158 / 0 |
| Methods chosen | — | curved PN on 33 parts, the gentler PN on 1; manifold-3d was tried on every closed part and refused or not chosen by the checks |
| Time (read to verified file) | | 5.4–7.7 s |

The surface moved most (122 µm) on the coarsest accessories, which is what rounding out their 129 µm
facets requires. Volume rises slightly because flat facets lie inside convex curves. After writing, the
file reads back as 191 parts rather than 192. Two overlapping accessories gained points within 0.06 µm of
each other, which the STL's 32-bit coordinates make identical. The shape is the same; only the count of
separate pieces changed.

The same file, every method (bending energy Σ L·θ² over smooth edges is a smoothness measure that flat
subdivision cannot fake; much of it is the figure's fine sculpted detail, which must stay):

| Method | Triangles | Faceting worst / p95 (µm) | Bending energy (mm·rad²) | Original vertices moved max (µm) | Surface moved max (µm) | Volume |
|---|---|---|---|---|---|---|
| Original (repaired) | 84,540 | 129 / 18.7 | 1833 | 0 | 0 | 0.00 % |
| Midpoint subdivision | 338,160 | 65 / 6.2 † | 1833 | 0 | 0 | 0.00 % |
| Loop subdivision | 338,160 | 74 / 5.4 | 1895 | 327 | 280 | −0.26 % |
| Feature-preserving Taubin | 84,540 | 103 / 15.1 | 1382 | 324 | 289 | −0.69 % |
| HC Laplacian | 84,540 | 103 / 14.8 | 1340 | 324 | 276 | −1.28 % |
| Bilateral filtering | 84,540 | 120 / 15.0 | 1327 | 348 | 326 | −3.14 % |
| Curvature-selective smoothing | 84,540 | 103 / 15.1 | 1495 | 324 | 315 | −0.91 % |
| Hybrid: midpoint + selective smoothing | 338,160 | 50 / 5.4 | 1623 | 175 | 133 | −0.51 % |
| manifold-3d (closed parts only) | 290,568 | 77 / 5.4 | 1827 | 0 | 474 ‡ | +0.75 % |
| Curved PN, unguarded | 648,649 | 25 / 2.4 | 1479 | 0 | 121 | +0.84 % |
| **Automatic pipeline (chosen)** | 531,970 | 31 / 3.1 | 1533 | **0** | 116 | +0.81 % |

† Midpoint subdivision changes nothing (0 µm moved, same energy); its lower faceting figure is an artefact
of measuring on smaller triangles. ‡ manifold-3d's result has 68,469 sharp edges where splitting alone gives
about 21,500 (midpoint row): it creates new creases on these export meshes, which the checks refuse.

What it says: the smoothing filters (Taubin, HC, bilateral, selective) lower the energy only by moving
original vertices by a third of a millimetre, which blurs exactly the detail that matters (faces, fingers,
folds). The refiners keep every vertex and remove most of the faceting. No visual render of this file was
made for this report; the comparison is by measurement only.

## Methods compared on shapes with known true surfaces

From `tests/unit/stl-benchmark.test.ts`
(`STL_BENCH=1 npx vitest run --project unit tests/unit/stl-benchmark.test.ts`, Node 22, one thread).

Candidates:
- **Midpoint subdivision**: splits triangles, never moves anything. Baseline for "more polygons".
- **Loop subdivision** (Loop 1987): approximating; moves original vertices.
- **Taubin λ|μ smoothing** (Taubin 1995), and a **feature-preserving** variant that holds vertices on
  creases, open and non-manifold edges.
- **HC Laplacian** (Vollmer, Mencl, Müller 1999): Laplacian smoothing pulled back towards the original.
- **Bilateral mesh filtering** (Fleishman, Drori, Cohen-Or 2003), one-ring.
- **Curvature-selective smoothing**: feature-preserving Taubin only on vertices of visibly faceted edges.
- **Hybrid**: midpoint subdivision, then selective smoothing.
- **manifold-3d `smoothOut` + `refineToTolerance`**: a G1 surface through the original vertices with
  curvature-adaptive refinement. Closed manifold parts only.
- **Curved PN triangles** (Vlachos, Peters, Boyd, Mitchell 2001), adapted here (`src/lib/stl/pn.ts`):
  - a cubic patch per triangle through its three original vertices
  - normals averaged only across smooth edges, so creases stay sharp
  - a crease that runs on smoothly through a vertex (a rim) is curved along its own tangent; crease
    corners, open edges and non-manifold edges stay straight
  - only faceted triangles are refined; neighbouring triangles share bit-identical edge points, so nothing
    cracks
  - works on open and non-manifold meshes
- **Automatic pipeline**: the workshop's choice per part (below).

### Coarse sphere, R = 10 mm, 16 × 8 (truth known)

| Method | Triangles | Mean error vs true sphere (µm) | Max error (µm) | Volume vs true | Original vertices moved (max µm) | Time |
|---|---|---|---|---|---|---|
| Original | 224 | 212.1 | 373.6 | -6.26 % | 0.00 | 0 ms |
| Midpoint subdivision ×1 | 896 | 212.6 | 373.6 | -6.26 % | 0.00 | 0 ms |
| Loop subdivision ×1 | 896 | 366.6 | 467.2 | -10.60 % | 373.4 | 1 ms |
| Taubin smoothing (10 it.) | 224 | 234.7 | 463.8 | -6.28 % | 138.6 | 3 ms |
| Feature-preserving Taubin | 224 | 234.7 | 463.8 | -6.28 % | 138.6 | 2 ms |
| HC Laplacian (Vollmer 1999) | 224 | 438.9 | 737.5 | -12.69 % | 397.0 | 3 ms |
| Bilateral filtering (Fleishman 2003) | 224 | 1585.0 | 2240.1 | -41.16 % | 2003.2 | 3 ms |
| Curvature-selective smoothing | 224 | 234.7 | 463.8 | -6.28 % | 138.6 | 3 ms |
| Hybrid: midpoint + selective smoothing | 896 | 332.4 | 437.6 | -9.65 % | 316.9 | 2 ms |
| manifold-3d smooth + adaptive refine (closed parts) | 5,568 | 10.00 | 20.4 | -0.28 % | 0.00 | 18 ms |
| Curved PN, adaptive (unguarded) | 8,064 | 15.0 | 33.7 | -0.44 % | 0.00 | 19 ms |
| Automatic pipeline (chosen) | 5,568 | 10.00 | 20.4 | -0.28 % | 0.00 | 362 ms |

### Coarse cylinder, R = 5 mm, h = 20 mm, 12 sides (truth known)

| Method | Triangles | Side error vs true cylinder (µm) | Cap overhang (µm) | Height (mm) | Time |
|---|---|---|---|---|---|
| Original | 48 | 113.0 | 0.00 | 20.0000 | 0 ms |
| Midpoint subdivision ×1 | 192 | 113.3 | 0.00 | 20.0000 | 0 ms |
| Loop subdivision ×1 | 192 | 654.0 | 0.00 | 20.0000 | 0 ms |
| Taubin smoothing (10 it.) | 48 | 1303.9 | 0.00 | 16.6227 | 1 ms |
| Feature-preserving Taubin | 48 | 113.0 | 0.00 | 20.0000 | 0 ms |
| HC Laplacian (Vollmer 1999) | 48 | 113.0 | 0.00 | 20.0000 | 0 ms |
| Bilateral filtering (Fleishman 2003) | 48 | 113.0 | 0.00 | 20.0000 | 0 ms |
| Curvature-selective smoothing | 48 | 113.0 | 0.00 | 20.0000 | 0 ms |
| Hybrid: midpoint + selective smoothing | 192 | 164.8 | 0.00 | 20.0000 | 0 ms |
| manifold-3d smooth + adaptive refine (closed parts) | 864 | 4.56 | 0.00 | 20.0000 | 2 ms |
| Curved PN, adaptive (unguarded) | 1,200 | 7.91 | 0.00 | 20.0000 | 4 ms |
| Automatic pipeline (chosen) | 864 | 4.56 | 0.00 | 20.0000 | 169 ms |

### Open hemisphere, R = 10 mm (truth known; not a closed solid)

| Method | Triangles | Mean error vs true sphere (µm) | Max error (µm) | Original vertices moved (max µm) | Time |
|---|---|---|---|---|---|
| Original | 112 | 211.7 | 373.6 | 0.00 | 0 ms |
| Midpoint subdivision ×1 | 448 | 212.4 | 373.6 | 0.00 | 0 ms |
| Loop subdivision ×1 | 448 | 347.9 | 450.8 | 356.3 | 0 ms |
| Taubin smoothing (10 it.) | 112 | 427.1 | 786.2 | 620.0 | 0 ms |
| Feature-preserving Taubin | 112 | 427.1 | 786.2 | 620.0 | 0 ms |
| HC Laplacian (Vollmer 1999) | 112 | 534.7 | 887.9 | 737.4 | 1 ms |
| Bilateral filtering (Fleishman 2003) | 112 | 1010.1 | 1501.9 | 1219.1 | 1 ms |
| Curvature-selective smoothing | 112 | 427.1 | 786.2 | 620.0 | 0 ms |
| Hybrid: midpoint + selective smoothing | 448 | 321.8 | 445.8 | 336.9 | 1 ms |
| manifold-3d smooth + adaptive refine (closed parts) | 112 | 211.7 | 373.6 | 0.00 | 4 ms |
| Curved PN, adaptive (unguarded) | 4,032 | 49.8 | 210.9 | 0.00 | 11 ms |
| Automatic pipeline (chosen) | 4,032 | 49.8 | 210.9 | 0.00 | 250 ms |

### Cube, 20 mm (sharp edges)

| Method | Triangles | Hausdorff vs original (µm) | Volume change | Time |
|---|---|---|---|---|
| Original | 12 | 0.00 | 0.000 % | 0 ms |
| Midpoint subdivision ×1 | 48 | 0.00 | 0.000 % | 0 ms |
| Loop subdivision ×1 | 48 | 6495.2 | -50.977 % | 0 ms |
| Taubin smoothing (10 it.) | 12 | 15381.9 | -99.753 % | 0 ms |
| Feature-preserving Taubin | 12 | 0.00 | 0.000 % | 0 ms |
| HC Laplacian (Vollmer 1999) | 12 | 0.00 | 0.000 % | 0 ms |
| Bilateral filtering (Fleishman 2003) | 12 | 0.00 | 0.000 % | 0 ms |
| Curvature-selective smoothing | 12 | 0.00 | 0.000 % | 0 ms |
| Hybrid: midpoint + selective smoothing | 48 | 0.00 | 0.000 % | 0 ms |
| manifold-3d smooth + adaptive refine (closed parts) | 12 | 0.00 | 0.000 % | 0 ms |
| Curved PN, adaptive (unguarded) | 12 | 0.00 | 0.000 % | 0 ms |
| Automatic pipeline (chosen) | 12 | 0.00 | 0.000 % | 0 ms |

### Miniature-like assembly (engraved 0.12 mm band, 0.4 mm blade, 0.25 mm fingers)

| Method | Triangles | Original vertices moved (max µm) | Surface moved (max µm) | Volume change | Parts | Time |
|---|---|---|---|---|---|---|
| Original | 5,388 | 0.00 | 0.00 | 0.00 % | 6 | 0 ms |
| Midpoint subdivision ×1 | 21,552 | 0.00 | 0.00 | -0.00 % | 6 | 5 ms |
| Loop subdivision ×1 | 21,552 | 1304.5 | 789.7 | -12.28 % | 6 | 7 ms |
| Taubin smoothing (10 it.) | 5,388 | 4569.2 | 2141.3 | -33.22 % | 6 | 7 ms |
| Feature-preserving Taubin | 5,388 | 49.0 | 49.3 | 0.10 % | 6 | 4 ms |
| HC Laplacian (Vollmer 1999) | 5,388 | 48.1 | 46.0 | -0.00 % | 6 | 4 ms |
| Bilateral filtering (Fleishman 2003) | 5,388 | 74.2 | 71.2 | -0.76 % | 6 | 24 ms |
| Curvature-selective smoothing | 5,388 | 57.8 | 52.9 | -0.03 % | 6 | 3 ms |
| Hybrid: midpoint + selective smoothing | 21,552 | 34.8 | 32.0 | -0.03 % | 6 | 10 ms |
| manifold-3d smooth + adaptive refine (closed parts) | 10,804 | 0.00 | 17.4 | 0.19 % | 6 | 32 ms |
| Curved PN, adaptive (unguarded) | 8,844 | 0.00 | 16.8 | 0.18 % | 6 | 38 ms |
| Automatic pipeline (chosen) | 10,644 | 0.00 | 17.4 | 0.19 % | 6 | 221 ms |

### Finely tessellated sphere, R = 4 mm, 81,920 triangles (~0.07 mm edges, sculpt-export density)

| Method | Triangles | Mean error vs true sphere (µm) | Max error (µm) | Time |
|---|---|---|---|---|
| Original | 81,920 | 0.18 | 0.28 | 0 ms |
| Midpoint subdivision ×1 | 327,680 | 0.18 | 0.28 | 15 ms |
| Loop subdivision ×1 | 327,680 | 0.32 | 0.39 | 25 ms |
| Taubin smoothing (10 it.) | 81,920 | 0.05 | 0.26 | 65 ms |
| Feature-preserving Taubin | 81,920 | 0.05 | 0.26 | 48 ms |
| HC Laplacian (Vollmer 1999) | 81,920 | 0.18 | 0.34 | 46 ms |
| Bilateral filtering (Fleishman 2003) | 81,920 | 1.96 | 2.64 | 121 ms |
| Curvature-selective smoothing | 81,920 | 0.18 | 0.28 | 63 ms |
| Hybrid: midpoint + selective smoothing | 327,680 | 0.18 | 0.28 | 232 ms |
| manifold-3d smooth + adaptive refine (closed parts) | 81,920 | 0.18 | 0.28 | 302 ms |
| Curved PN, adaptive (unguarded) | 81,920 | 0.18 | 0.28 | 153 ms |
| Automatic pipeline (chosen) | 81,920 | 0.18 | 0.28 | 206 ms |

What the numbers say:
- Every vertex-moving filter (Loop, Taubin, HC, bilateral, selective, hybrid) makes the coarse shapes
  *less* accurate and moves original vertices by 0.1–2 mm. HC and bilateral are designed to remove noise,
  and faceting is not noise. On already-fine meshes they do almost nothing.
- Only the two interpolating refiners improve the true-shape error, and neither moves an original vertex.
  On clean closed solids manifold-3d is the more accurate (sphere 10 µm vs 15 µm mean; cylinder 4.6 µm vs
  7.9 µm). Only curved PN can refine an open surface (hemisphere 212 → 50 µm mean). Its open rim stays a
  polygon by design, so no gap opens between parts, and that is where the 211 µm maximum is.
- The automatic pipeline matches the better of the two on every shape.
- A finely tessellated model gains nothing and is kept exactly ("already optimal", with the reason).

Not implemented, on design grounds: surface reconstruction (screened Poisson) replaces the original
vertices; learned "upscaling" invents detail that is not in the design.

## The pipeline

1. **Read** binary or ASCII STL. A damaged file is refused with the reason. Then **weld** identical corners.
2. **Analyse**: size, volume, parts (closed or open), open, non-manifold and wrongly-wound edges, inside-out
   parts, zero-area and repeated triangles, edge lengths, and faceting.
3. **Repair** only what cannot be intended: remove zero-area and exactly repeated triangles, make windings
   consistent, and turn inside-out closed parts. Holes are never filled and no part is removed.
4. **Enhance each part separately** (`src/lib/stl/enhance.ts`):
   - Worst facet already under 7.5 µm (under a quarter of a pixel): kept exactly as it is.
   - Otherwise: curved PN triangles, and on closed parts also manifold-3d. Both use crease angle 40° and
     tolerance 7.5 µm.
   - Every result goes through the checks below. Of those that pass, the smoother is kept, or the one with
     fewer triangles when both are within twice the tolerance (equally smooth in print).
   - If neither passes, the fallback is curved PN with a lower crease angle (28°, more edges kept sharp).
   - If that fails too, the part is kept exactly as it was and the reason is shown.
   - The coarsest parts are treated first, so the triangle budget (6 million) goes where it shows most.
   - If the WebAssembly library cannot load, the pipeline still runs with curved PN alone.
5. **Checks** (per part, against that part):
   - no original vertex moved by more than 5 µm
   - surface movement, both ways, at most 1.25 × the part's largest face sagitta + 10 µm (cubic patches
     may bulge slightly past a circular arc; more is an artefact)
   - closed parts stay closed; on open parts the total length of open edges is unchanged (no gap opened
     or closed)
   - no new sharp edges (total crease length may not grow by more than 5 %)
   - a closed part's volume changes only as much as its measured surface movement explains
   - size grows only by the curvature gained
   - finite coordinates, triangle budget
6. **Fragile check**: walls thinner than 0.5 mm are shown amber; thinner than one pixel (34 µm) red.
7. **Write** a binary STL in millimetres, re-read and re-analyse it, and only then offer the download.
   If nothing improved, the download is the original geometry with only the safe repairs.

## Printer: Anycubic Photon Mono 2

- Nominal 34 µm XY pixel and nominal build volume. The tolerance (7.5 µm) is under a quarter of a pixel.
- The optional, collapsed **Print estimate** panel gives layers and time from the oriented height plus
  supports, with editable print settings. These settings do not affect the model. It is an estimate:
  supports, hollowing and orientation are decided in Lychee, and nothing here claims a model is printable.

## Integration and security

- **Access:** a DM-only route (`DmOnly`), with a DM navigation link and a command-palette entry. Players
  get neither.
- **No server:** no upload, no storage, no new service, nothing paid.
- **Libraries:** three.js (MIT) is loaded only on the workshop page. manifold-3d (Apache-2.0) and its
  WebAssembly file load inside the worker when processing starts. Curved PN is plain TypeScript.
- **Content Security Policy:** `script-src` includes `'wasm-unsafe-eval'` (unchanged from the first
  version) so the browser may compile the site's own WebAssembly file.

## Tests

- **Unit** (`tests/unit/stl-workshop.test.ts`):
  - files, analysis and repair (unchanged)
  - automatic enhancement:
    - sphere and cylinder against their true shapes
    - box and fine sphere kept exactly, with the "already optimal" reason
    - miniature parts and detail preserved
    - open hemisphere and non-manifold model enhanced with no gap opened
    - runs without the WebAssembly library
    - per-part checks, triangle limit
    - written file re-read
  - curved PN: watertight results with no cracks, crease rims kept, flat models unchanged, triangle budget
  - facet-deviation estimate; manifold-3d never sent an over-size part
- **Browser** (`tests/e2e/stl-workshop.spec.ts`):
  - damaged file refused
  - upload alone produces the optimised result, with no button or slider; 3D comparison; optional print
    estimate; downloaded file re-read
  - cancel, then re-upload, of a fine model: kept exactly, with the reason; its download is re-read
  - tablet width with no sideways scrolling
  - players cannot open the workshop

## Limits

- Open boundaries and non-manifold edges are never curved (that keeps every gap between parts exactly as
  exported), so a coarse open rim stays polygonal.
- Interpolating refinement cannot remove a facet whose own vertices are wrong. It rounds the faces between
  vertices; it does not move the vertices.
- Wall thickness is measured straight through each surface, sampled on large meshes.
- Overlapping parts are processed separately and not merged.
- Memory: refining multiplies triangles (6× on the Hero Forge file). The output is capped at 6 million
  triangles for a browser tab, and the coarsest parts are served first.
