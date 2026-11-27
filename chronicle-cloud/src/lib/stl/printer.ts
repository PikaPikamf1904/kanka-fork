// Printer profile, orientation, print-time estimate and fragile-geometry detection for MSLA resin printing.
// On an MSLA printer every layer is exposed at once, so print time depends on the number of layers (the
// model's height as oriented), not on how wide the model is.
import type { Mesh } from './mesh.ts';
import { buildGrid, rayHit } from './spatial.ts';

export interface PrinterProfile {
  name: string;
  /** Nominal XY pixel size, mm. */
  pixelMm: number;
  /** Nominal build volume, mm (X, Y, Z). */
  buildMm: [number, number, number];
}

export interface PrintSettings {
  layerMm: number;
  exposureS: number;
  bottomExposureS: number;
  bottomLayers: number;
  liftMm: number;
  liftSpeedMmS: number;
  retractSpeedMmS: number;
  lightOffDelayS: number;
  /** How far supports raise the model off the plate, mm. */
  supportHeightMm: number;
}

/**
 * Anycubic Photon Mono 2: 6.6" monochrome LCD, nominal 34 µm XY. Build volume as published by Anycubic
 * (nominal; check your own printer). The settings are common starting values, not resin-specific
 * recommendations: use your resin's exposure times.
 */
export const PHOTON_MONO_2: PrinterProfile = { name: 'Anycubic Photon Mono 2', pixelMm: 0.034, buildMm: [143.4, 89.6, 165] };
export const DEFAULT_PRINT: PrintSettings = {
  layerMm: 0.05, exposureS: 2.0, bottomExposureS: 25, bottomLayers: 6,
  liftMm: 6, liftSpeedMmS: 2, retractSpeedMmS: 3, lightOffDelayS: 0.5, supportHeightMm: 5,
};

export interface Orientation { tiltXDeg: number; tiltYDeg: number; spinZDeg: number }

/** Rotated copy of the positions (x,y,z,…), Z up. Works on a mesh's vertices or an STL triangle soup. */
export function orient(positions: ArrayLike<number>, o: Orientation): Float64Array {
  const rad = (d: number) => (d * Math.PI) / 180;
  const [ax, ay, az] = [rad(o.tiltXDeg), rad(o.tiltYDeg), rad(o.spinZDeg)];
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  const out = new Float64Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    let x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    let t = y * cx - z * sx; z = y * sx + z * cx; y = t; // about X
    t = x * cy + z * sy; z = -x * sy + z * cy; x = t; // about Y
    t = x * cz - y * sz; y = x * sz + y * cz; x = t; // about Z
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
  }
  return out;
}

export function orientedSize(positions: ArrayLike<number>, o: Orientation): [number, number, number] {
  const p = orient(positions, o);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, p[i + k]!); max[k] = Math.max(max[k]!, p[i + k]!); }
  return [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
}

export interface PrintEstimate {
  layers: number;
  seconds: number;
  heightMm: number;
  fits: boolean;
  fitNote: string;
}

export function estimatePrint(sizeMm: [number, number, number], s: PrintSettings, printer: PrinterProfile = PHOTON_MONO_2): PrintEstimate {
  const heightMm = sizeMm[2] + Math.max(0, s.supportHeightMm);
  const layers = Math.max(1, Math.ceil(heightMm / s.layerMm - 1e-9));
  const move = s.liftMm / s.liftSpeedMmS + s.liftMm / s.retractSpeedMmS + s.lightOffDelayS;
  const bottom = Math.min(layers, s.bottomLayers);
  const seconds = bottom * (s.bottomExposureS + move) + (layers - bottom) * (s.exposureS + move);
  const [bx, by, bz] = printer.buildMm;
  const flatFits = (sizeMm[0] <= bx && sizeMm[1] <= by) || (sizeMm[0] <= by && sizeMm[1] <= bx);
  const fits = flatFits && heightMm <= bz;
  const fitNote = fits ? `Fits the ${printer.name} build volume (${bx} × ${by} × ${bz} mm, nominal).`
    : !flatFits ? `Wider than the build plate (${bx} × ${by} mm) in this orientation.` : `Taller than the build height (${bz} mm) with supports.`;
  return { layers, seconds, heightMm, fits, fitNote };
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export interface FragileReport {
  /** Per triangle: 1 = measured thinner than the minimum wall, 2 = thinner than one printer pixel. */
  flags: Uint8Array;
  thinTriangles: number;
  subPixelTriangles: number;
  thinAreaPct: number;
  measured: number;
  minWallMm: number;
}

/**
 * Wall thickness by casting a ray inwards from each triangle's centre (a "shape diameter" estimate).
 * Thin parts such as blades, fingers, feathers and staffs show up as short distances. On very large
 * meshes an even sample of triangles is measured.
 */
export function fragileGeometry(m: Mesh, minWallMm: number, pixelMm: number, maxSamples = 250_000, onProgress?: (f: number) => void): FragileReport {
  const nt = m.tri.length / 3;
  const grid = buildGrid(m);
  const flags = new Uint8Array(nt);
  const stride = Math.max(1, Math.ceil(nt / maxSamples));
  let thin = 0, sub = 0, measured = 0, thinArea = 0, area = 0;
  const p = m.pos;
  for (let t = 0; t < nt; t += stride) {
    if (onProgress && measured % 20000 === 0) onProgress(t / nt);
    const a = m.tri[t * 3]! * 3, b = m.tri[t * 3 + 1]! * 3, c = m.tri[t * 3 + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) continue;
    const ar = len / 2;
    nx /= len; ny /= len; nz /= len;
    const ox = (p[a]! + p[b]! + p[c]!) / 3, oy = (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3, oz = (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3;
    measured++; area += ar;
    const d = rayHit(grid, ox, oy, oz, -nx, -ny, -nz, t, minWallMm);
    if (d < minWallMm) {
      thin++; thinArea += ar;
      flags[t] = d < pixelMm ? 2 : 1;
      if (d < pixelMm) sub++;
      // Mark the unmeasured neighbours in this stride the same way, so highlighting is continuous.
      for (let k = 1; k < stride && t + k < nt; k++) flags[t + k] = flags[t]!;
    }
  }
  return { flags, thinTriangles: thin, subPixelTriangles: sub, thinAreaPct: area > 0 ? (thinArea / area) * 100 : 0, measured, minWallMm };
}
