// The workshop's whole process for one file, as used by the browser worker (and by the tests):
// read -> weld -> analyse -> repair -> enhance (measured, guarded) -> fragile check -> write -> re-read.
import { analyze, repair, toSoup, weld, type Mesh, type MeshReport, type RepairLog } from './mesh.ts';
import { enhance, type EnhanceResult, type ManifoldModule } from './enhance.ts';
import { fragileGeometry, type FragileReport } from './printer.ts';
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
  timingsMs: Record<string, number>;
}

export type Progress = (fraction: number, label: string) => void;

export function readModel(name: string, data: ArrayBuffer, pixelMm: number): { mesh: Mesh; out: AnalyzeResult } {
  const soup = parseStl(data);
  const mesh = weld(soup.positions);
  return { mesh, out: { name, format: soup.format, warnings: soup.warnings, report: analyze(mesh, pixelMm), soup: soup.positions } };
}

export function enhanceModel(M: ManifoldModule, original: Mesh, opts: { strength: number; maxTriangles: number; minWallMm: number; pixelMm: number }, progress: Progress): EnhanceOutput {
  const t: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (k: string) => { const n = performance.now(); t[k] = Math.round(n - t0); t0 = n; };
  progress(0.02, 'Repairing');
  const { mesh: fixed, log } = repair({ pos: original.pos, tri: Uint32Array.from(original.tri) });
  const repaired = analyze(fixed, opts.pixelMm);
  lap('repair');
  const r = enhance(M, fixed, { strength: opts.strength, maxTriangles: opts.maxTriangles }, repaired.edgeLengthMm.median, (f, l) => progress(0.1 + f * 0.5, l));
  lap('enhance');
  progress(0.65, 'Checking thin and fragile areas');
  const fo = fragileGeometry(fixed, opts.minWallMm, opts.pixelMm);
  const fe = fragileGeometry(r.mesh, opts.minWallMm, opts.pixelMm);
  lap('fragile');
  progress(0.85, 'Writing and re-reading the STL');
  const enhancedSoup = toSoup(r.mesh);
  const stl = writeBinaryStl(enhancedSoup, r.mesh.tri.length / 3);
  const verified = analyze(weld(parseStl(stl).positions), opts.pixelMm);
  lap('write+verify');
  const { mesh: _m, ...result } = r;
  void _m;
  const strip = ({ flags: _f, ...rest }: FragileReport) => { void _f; return rest; };
  progress(1, 'Done');
  return {
    repaired, repairLog: log, enhanced: analyze(r.mesh, opts.pixelMm), result,
    fragile: { original: strip(fo), enhanced: strip(fe) }, enhancedFlags: fe.flags, originalFlags: fo.flags,
    enhancedSoup, repairedSoup: toSoup(fixed), stl, verified, timingsMs: t,
  };
}
