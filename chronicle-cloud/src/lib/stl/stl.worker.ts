// The STL Workshop's processing thread. Everything happens here, on the DM's own device: the model is
// never uploaded or stored. The geometry library (WebAssembly) is loaded only when enhancement starts.
// Cancelling terminates this worker, which also releases all of its memory.
import type { Mesh } from './mesh.ts';
import { facetDeviation, settingsFor, type ManifoldModule } from './enhance.ts';
import { enhanceModel, readModel } from './pipeline.ts';
import { StlError } from './stlIO.ts';

export type WorkerIn =
  | { type: 'analyze'; name: string; data: ArrayBuffer; pixelMm: number }
  | { type: 'enhance'; strength: number; minWallMm: number; pixelMm: number; maxTriangles: number };

let mesh: Mesh | null = null;
let manifold: Promise<ManifoldModule> | null = null;

async function loadManifold(): Promise<ManifoldModule> {
  manifold ??= (async () => {
    const [{ default: Module }, { default: wasmUrl }] = await Promise.all([import('manifold-3d'), import('manifold-3d/manifold.wasm?url')]);
    const w = await Module({ locateFile: () => wasmUrl });
    w.setup();
    return w as unknown as ManifoldModule;
  })();
  return manifold;
}

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'analyze') {
      post({ type: 'progress', fraction: 0.1, label: 'Reading the STL' });
      const { mesh: m, out } = readModel(msg.name, msg.data, msg.pixelMm);
      mesh = m;
      post({ type: 'progress', fraction: 0.8, label: 'Measuring the facets' });
      const facet = facetDeviation(m, settingsFor(0.5).minSharpAngle);
      post({ type: 'analyzed', name: out.name, format: out.format, warnings: out.warnings, report: out.report, facet, soup: out.soup }, [out.soup.buffer]);
      return;
    }
    if (msg.type === 'enhance') {
      if (!mesh) throw new Error('No model is loaded.');
      post({ type: 'progress', fraction: 0.01, label: 'Loading the geometry library' });
      const M = await loadManifold();
      const out = enhanceModel(M, mesh, { strength: msg.strength, maxTriangles: msg.maxTriangles, minWallMm: msg.minWallMm, pixelMm: msg.pixelMm },
        (fraction, label) => post({ type: 'progress', fraction, label }));
      post({ type: 'enhanced', out }, [out.stl, out.enhancedSoup.buffer, out.repairedSoup.buffer, out.enhancedFlags.buffer, out.originalFlags.buffer]);
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof StlError ? e.message : `Processing failed: ${e instanceof Error ? e.message : String(e)}` });
  }
};
