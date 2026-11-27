// STL reading and writing. Binary and ASCII input; binary output only (what Lychee and every other
// slicer read fastest). Units are whatever the file uses; Hero Forge and Lychee both use millimetres.

export interface TriangleSoup {
  /** 9 numbers per triangle: x,y,z of its three corners, as stored in the file. */
  positions: Float32Array;
  triangleCount: number;
  format: 'binary' | 'ascii';
  /** Problems that did not stop the file from being read. */
  warnings: string[];
}

export class StlError extends Error {}

const MAX_TRIANGLES = 12_000_000; // ~600 MB of binary STL: beyond what a browser tab can process.

/** Reads a binary or ASCII STL. Throws StlError with a readable reason when the file is not usable. */
export function parseStl(data: ArrayBuffer): TriangleSoup {
  if (data.byteLength < 15) throw new StlError('This file is too small to be an STL model.');
  const view = new DataView(data);
  // A binary STL is exactly 84 + 50 bytes per triangle. Many binary files start with "solid" in their
  // header too, so the size test decides, not the first word.
  if (data.byteLength >= 84) {
    const count = view.getUint32(80, true);
    if (count > 0 && 84 + count * 50 === data.byteLength) return parseBinary(view, count);
  }
  const head = new TextDecoder().decode(new Uint8Array(data, 0, Math.min(512, data.byteLength))).trimStart().toLowerCase();
  if (head.startsWith('solid') && /facet|endsolid/.test(new TextDecoder().decode(new Uint8Array(data, 0, Math.min(4096, data.byteLength))).toLowerCase())) {
    return parseAscii(new TextDecoder().decode(new Uint8Array(data)));
  }
  if (data.byteLength >= 84) {
    const count = view.getUint32(80, true);
    if (count === 0) throw new StlError('This STL file contains no triangles.');
    const expected = 84 + count * 50;
    if (data.byteLength < expected) throw new StlError(`This STL file is cut short: it says it has ${count.toLocaleString()} triangles but holds only ${Math.floor((data.byteLength - 84) / 50).toLocaleString()}. The download or export may not have finished.`);
    // Some exporters add padding after the triangles; read what is declared and warn.
    const soup = parseBinary(view, count);
    soup.warnings.push(`The file has ${(data.byteLength - expected).toLocaleString()} unexpected extra bytes after the last triangle; they were ignored.`);
    return soup;
  }
  throw new StlError('This is not an STL file this tool can read (neither binary nor ASCII STL).');
}

function parseBinary(view: DataView, count: number): TriangleSoup {
  if (count > MAX_TRIANGLES) throw new StlError(`This model has ${count.toLocaleString()} triangles; the workshop handles up to ${MAX_TRIANGLES.toLocaleString()}.`);
  const positions = new Float32Array(count * 9);
  let bad = 0;
  for (let t = 0; t < count; t++) {
    const base = 84 + t * 50 + 12; // skip the stored normal: it is recomputed, and often wrong in exports
    for (let k = 0; k < 9; k++) {
      const v = view.getFloat32(base + k * 4, true);
      if (!Number.isFinite(v)) bad++;
      positions[t * 9 + k] = Number.isFinite(v) ? v : 0;
    }
  }
  if (bad > 0) throw new StlError(`The file contains ${bad.toLocaleString()} invalid coordinates (not numbers). It is damaged.`);
  return { positions, triangleCount: count, format: 'binary', warnings: [] };
}

function parseAscii(text: string): TriangleSoup {
  const out: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const x = Number(m[1]), y = Number(m[2]), z = Number(m[3]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new StlError('The file contains a vertex that is not a number. It is damaged.');
    out.push(x, y, z);
    if (out.length > MAX_TRIANGLES * 9) throw new StlError(`This model has more than ${MAX_TRIANGLES.toLocaleString()} triangles.`);
  }
  if (out.length === 0) throw new StlError('This ASCII STL file contains no triangles.');
  const warnings: string[] = [];
  if (out.length % 9 !== 0) warnings.push('The last triangle is incomplete and was ignored.');
  const n = Math.floor(out.length / 9);
  return { positions: Float32Array.from(out.slice(0, n * 9)), triangleCount: n, format: 'ascii', warnings };
}

/**
 * Binary STL, little-endian, millimetres, with correct facet normals. The 80-byte header deliberately
 * does NOT start with "solid", so no slicer mistakes it for ASCII.
 */
export function writeBinaryStl(positions: Float32Array | Float64Array, triangleCount: number, header = 'Chronicle STL Workshop, binary STL, units: mm'): ArrayBuffer {
  const buf = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buf);
  const h = new TextEncoder().encode(header.slice(0, 80));
  new Uint8Array(buf, 0, 80).set(h);
  view.setUint32(80, triangleCount, true);
  for (let t = 0; t < triangleCount; t++) {
    const p = t * 9;
    const ax = positions[p + 3]! - positions[p]!, ay = positions[p + 4]! - positions[p + 1]!, az = positions[p + 5]! - positions[p + 2]!;
    const bx = positions[p + 6]! - positions[p]!, by = positions[p + 7]! - positions[p + 1]!, bz = positions[p + 8]! - positions[p + 2]!;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const o = 84 + t * 50;
    view.setFloat32(o, nx, true); view.setFloat32(o + 4, ny, true); view.setFloat32(o + 8, nz, true);
    for (let k = 0; k < 9; k++) view.setFloat32(o + 12 + k * 4, positions[p + k]!, true);
    view.setUint16(o + 48, 0, true);
  }
  return buf;
}
