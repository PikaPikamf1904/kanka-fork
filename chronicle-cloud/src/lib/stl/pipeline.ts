// The workshop's whole process for one file, as used by the browser worker (and by the tests):
// read -> weld -> analyse -> repair -> enhance (measured, guarded) -> fragile check -> write -> re-read ->
// slice the original and the written file at the same layers (print check).
import { analyze, bounds, repair, toSoup, weld, type Mesh, type MeshReport, type RepairLog } from './mesh.ts';
import { enhance, type EnhanceResult, type ManifoldModule } from './enhance.ts';
import { fragileGeometry, type FragileReport } from './printer.ts';
import { sliceCheck, type SliceReport } from './slice.ts';
import { parseStl, writeBinaryStl } from './stlIO.ts';

export interface AnalyzeResult {
  name: string;
  format: 'binary' | 'ascii';
  warnings: string[];
  report: MeshReport;
  /** Soup for drawing the original exactly as uploaded. */
  soup: Float32Array;
}

export interface EnhanceOutput {
  repaired: MeshReport;
  repairLog: RepairLog;
  enhanced: MeshReport;
  result: Omit<EnhanceResult, 'mesh'>;
  fragile: { original: Omit<FragileReport, 'flags'>; enhanced: Omit<FragileReport, 'flags'> };
  enhancedFlags: Uint8Array;
  originalFlags: Uint8Array;
  enhancedSoup: Float32Array;
  /** The repaired original (its triangle order matches originalFlags). */
  repairedSoup: Float32Array;
  stl: ArrayBuffer;
  /** The written file, re-read and analysed: what the slicer will see. */
  verified: MeshReport;
  /** The repaired original and the written file, cut at the same layers (see slice.ts). */
  slices: { original: SliceSummary; optimised: SliceSummary };
  timingsMs: Record<string, number>;
}

export type SliceSummary = Omit<SliceReport, 'exposed'>;

export type Progress = (fraction: number, label: string) => void;

export function readModel(name: string, data: ArrayBuffer, pixelMm: number): { mesh: Mesh; out: AnalyzeResult } {
  const soup = parseStl(data);
  const mesh = weld(soup.positions);
  return { mesh, out: { name, format: soup.format, warnings: soup.warnings, report: analyze(mesh, pixelMm), soup: soup.positions } };
}

export function enhanceModel(M: ManifoldModule | null, original: Mesh, opts: { maxTriangles: number; minWallMm: number; pixelMm: number }, progress: Progress): EnhanceOutput {
  const t: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (k: string) => { const n = performance.now(); t[k] = Math.round(n - t0); t0 = n; };
  progress(0.02, 'Repairing');
  const { mesh: fixed, log } = repair({ pos: original.pos, tri: Uint32Array.from(original.tri) });
  const repaired = analyze(fixed, opts.pixelMm);
  lap('repair');
  const r = enhance(M, fixed, { maxTriangles: opts.maxTriangles }, (f, l) => progress(0.1 + f * 0.5, l));
  lap('enhance');
  progress(0.65, 'Checking thin and fragile areas');
  const fo = fragileGeometry(fixed, opts.minWallMm, opts.pixelMm);
  const fe = fragileGeometry(r.mesh, opts.minWallMm, opts.pixelMm);
  lap('fragile');
  progress(0.85, 'Writing and re-reading the STL');
  const enhancedSoup = toSoup(r.mesh);
  const stl = writeBinaryStl(enhancedSoup, r.mesh.tri.length / 3);
  const written = weld(parseStl(stl).positions);
  const verified = analyze(written, opts.pixelMm);
  lap('write+verify');
  progress(0.92, 'Slicing both versions into layers');
  const b = bounds(fixed);
  const zRange: [number, number] = [b.min[2]!, b.max[2]!];
  const summary = ({ exposed: _e, ...rest }: SliceReport): SliceSummary => { void _e; return rest; };
  const slices = { original: summary(sliceCheck(fixed, { zRange })), optimised: summary(sliceCheck(written, { zRange })) };
  lap('slice');
  const { mesh: _m, ...result } = r;
  void _m;
  const strip = ({ flags: _f, ...rest }: FragileReport) => { void _f; return rest; };
  progress(1, 'Done');
  return {
    repaired, repairLog: log, enhanced: analyze(r.mesh, opts.pixelMm), result,
    fragile: { original: strip(fo), enhanced: strip(fe) }, enhancedFlags: fe.flags, originalFlags: fo.flags,
    enhancedSoup, repairedSoup: toSoup(fixed), stl, verified, slices, timingsMs: t,
  };
}
