// DM: STL Workshop. Upload, then everything is automatic: analyse -> repair -> enhance (measured and
// guarded per part) -> verify -> compare -> download. Entirely on this device.
// The model never leaves the browser: nothing is uploaded, stored or sent anywhere.
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { StlCompare } from '../../components/stl/StlCompare.tsx';
import type { MeshReport } from '../../lib/stl/mesh.ts';
import type { EnhanceOutput } from '../../lib/stl/pipeline.ts';
import { DEFAULT_PRINT, estimatePrint, formatDuration, orientedSize, PHOTON_MONO_2, type Orientation, type PrintSettings } from '../../lib/stl/printer.ts';
import { writeBinaryStl } from '../../lib/stl/stlIO.ts';
import type { WorkerIn } from '../../lib/stl/stl.worker.ts';
import '../../styles/stl.css';

const MAX_FILE = 600 * 1024 * 1024;
const MAX_OUT_TRIANGLES = 6_000_000;
/** Walls thinner than this are flagged as fragile (a common minimum for resin miniatures). */
const MIN_WALL_MM = 0.5;

interface Analysis { name: string; format: 'binary' | 'ascii'; warnings: string[]; report: MeshReport; facet: { max: number; p95: number; smoothEdges: number }; soup: Float32Array }
type Busy = { label: string; fraction: number } | null;

const mm = (v: number, d = 2) => `${v.toFixed(d)} mm`;
const um = (v: number) => (v >= 1 ? `${v.toFixed(2)} mm` : v * 1000 < 10 ? `${(v * 1000).toFixed(1)} µm` : `${Math.round(v * 1000)} µm`);
const n = (v: number) => v.toLocaleString();

function download(name: string, data: ArrayBuffer) {
  const url = URL.createObjectURL(new Blob([data], { type: 'model/stl' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** How the file the DM downloads slices, compared with the upload, and whether it fits the printer. */
function PrintCheck({ result, optimised, fits, fitNote }: { result: EnhanceOutput; optimised: boolean; fits: boolean | null; fitNote: string }) {
  const s = optimised ? result.slices.optimised : result.slices.original, o = result.slices.original;
  const sliced = s.exposedEnds === 0
    ? (s.layersWithOpenOutlines === 0
      ? `Slices into closed layers (${n(s.layers)} layers checked).`
      : `Slices into closed layers (${n(s.layers)} layers checked): every open edge in the export is buried inside another part or within one printer pixel of other surface.`)
    : `${n(s.layersWithExposedEnds)} of ${n(s.layers)} checked layers have hairline gaps (widest ${um(s.widestGapMm)}) where an open edge in the export meets nearby surface${optimised ? `; the uploaded file has ${n(o.layersWithExposedEnds)} such layers (widest ${um(o.widestGapMm)})` : ''}. A slicer's repair option can close gaps this narrow; check its layer preview around ${mm(s.worstLayerZ ?? 0, 1)} height.`;
  const walls = optimised ? result.fragile.enhanced : result.fragile.original;
  return (
    <div className="stl-print-check" aria-label="Print check">
      <h3>Print check</h3>
      <ul>
        <li className={s.exposedEnds === 0 ? 'form-ok' : 'stl-note'}>{sliced}</li>
        {fits !== null && <li className={fits ? 'form-ok' : 'form-error'}>{fitNote}</li>}
        <li className={walls.subPixelTriangles === 0 ? 'form-ok' : 'stl-note'}>{walls.subPixelTriangles === 0 ? 'No walls thinner than one printer pixel were found.' : `${n(walls.subPixelTriangles)} triangles sit on walls thinner than one printer pixel (34 µm); those spots will not print. They are shown in red in the 3D view.`}</li>
      </ul>
      <p className="fine-print">These are checks, not a guarantee: supports, orientation and exposure are set in your slicer.</p>
    </div>
  );
}

export function StlWorkshop() {
  const worker = useRef<Worker | null>(null);
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [result, setResult] = useState<EnhanceOutput | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState('');
  const [highlight, setHighlight] = useState(true);
  const [wire, setWire] = useState(false);
  const [print, setPrint] = useState<PrintSettings>(DEFAULT_PRINT);
  const [orientation, setOrientation] = useState<Orientation>({ tiltXDeg: 0, tiltYDeg: 0, spinZDeg: 0 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => { document.title = 'STL Workshop · Chronicle'; return () => worker.current?.terminate(); }, []);

  function startWorker(): Worker {
    worker.current?.terminate();
    const w = new Worker(new URL('../../lib/stl/stl.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { type: string } & Record<string, unknown>;
      if (m.type === 'progress') setBusy({ label: m.label as string, fraction: m.fraction as number });
      else if (m.type === 'analyzed') {
        setAnalysis(m as unknown as Analysis);
        // No settings: enhancement starts as soon as the model is read.
        setBusy({ label: 'Repairing', fraction: 0.02 });
        send(w, { type: 'enhance', minWallMm: MIN_WALL_MM, pixelMm: PHOTON_MONO_2.pixelMm, maxTriangles: MAX_OUT_TRIANGLES });
      }
      else if (m.type === 'enhanced') { setResult(m.out as EnhanceOutput); setBusy(null); }
      else if (m.type === 'error') { setError(m.message as string); setBusy(null); }
    };
    w.onerror = () => { setError('The processing thread stopped unexpectedly (the model may be too large for this device).'); setBusy(null); };
    worker.current = w;
    return w;
  }
  const send = (w: Worker, msg: WorkerIn, transfer: Transferable[] = []) => w.postMessage(msg, transfer);

  function analyse(name: string, data: ArrayBuffer) {
    setError(''); setResult(null); setAnalysis(null);
    setBusy({ label: 'Reading the STL', fraction: 0 });
    const copy = data.slice(0); // keep the original for a restart after cancelling
    send(startWorker(), { type: 'analyze', name, data: copy, pixelMm: PHOTON_MONO_2.pixelMm }, [copy]);
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setError('');
    if (!/\.stl$/i.test(file.name)) { setError('Choose an .stl file.'); return; }
    if (file.size > MAX_FILE) { setError(`This file is ${(file.size / 1e6).toFixed(0)} MB; the workshop handles up to ${MAX_FILE / 1024 / 1024} MB.`); return; }
    const data = await file.arrayBuffer();
    setFileName(file.name);
    analyse(file.name, data);
  }

  function cancel() {
    worker.current?.terminate();
    worker.current = null;
    setBusy(null);
    setResult(null);
    setError('Cancelled. The original is unchanged; choose the file again to start over.');
  }

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); void pick(e.dataTransfer.files[0]); };
  const base = fileName.replace(/\.stl$/i, '');
  const r = analysis?.report;
  // Which model would be printed: the enhanced one only when it actually improved the geometry.
  const useEnhanced = result?.result.verdict === 'improved';
  const printSoup = useEnhanced ? result!.enhancedSoup : analysis?.soup;
  const oriented = useMemo(() => (printSoup ? orientedSize(printSoup, orientation) : null), [printSoup, orientation]);
  const estimate = oriented ? estimatePrint(oriented, print) : null;
  const leftView = useMemo(() => (result ? { soup: result.repairedSoup, flags: result.originalFlags, label: 'Original (repaired)' } : analysis ? { soup: analysis.soup, label: 'Original' } : null), [analysis, result]);
  const rightView = useMemo(() => (result ? (useEnhanced ? { soup: result.enhancedSoup, flags: result.enhancedFlags, label: 'Optimised' } : { soup: result.repairedSoup, flags: result.originalFlags, label: 'Kept as it was' }) : null), [result, useEnhanced]);
  const setP = (k: keyof PrintSettings, v: number) => setPrint((p) => ({ ...p, [k]: Number.isFinite(v) ? v : p[k] }));

  return (
    <div className="stl-workshop">
      <h1 className="page-title">STL Workshop</h1>
      <p className="muted">Drop in a miniature and download a print-ready version for the {PHOTON_MONO_2.name}. Everything is automatic: defects are repaired, faceted curves are smoothed while sharp edges and fine detail are kept, and the result is checked before you get it. If the model is already as good as it can print, it is kept and you are told why. Everything runs on this device; the model is never uploaded or stored.</p>

      <section className={dragging ? 'panel stl-drop stl-drop-active' : 'panel stl-drop'} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        <p><strong>Drop an STL file here</strong>, or</p>
        <label className="button">Choose an STL file<input type="file" accept=".stl,model/stl,application/sla" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f); }} /></label>
        {fileName && <p className="fine-print">{fileName}</p>}
      </section>

      {busy && (
        <section className="panel stl-busy" role="status" aria-live="polite">
          <p>{busy.label}…</p>
          <progress max={1} value={busy.fraction} />
          <button type="button" className="button secondary small" onClick={cancel}>Cancel</button>
        </section>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      {analysis && r && (
        <>
          {analysis.warnings.map((w) => <p key={w} className="fine-print">{w}</p>)}
          <section className="panel" aria-labelledby="stl-analysis">
            <h2 id="stl-analysis">Analysis</h2>
            <dl className="stl-stats">
              <dt>Size</dt><dd>{mm(r.sizeMm[0])} × {mm(r.sizeMm[1])} × {mm(r.sizeMm[2])}</dd>
              <dt>Triangles</dt><dd>{n(r.triangles)} ({n(r.vertices)} vertices)</dd>
              <dt>Parts</dt><dd>{r.parts} ({r.closedParts} closed)</dd>
              <dt>Volume</dt><dd>{r.closedParts === r.parts ? `${(r.volumeMm3 / 1000).toFixed(2)} ml` : 'not measurable (some parts are open)'}</dd>
              <dt>Typical edge</dt><dd>{um(r.edgeLengthMm.median)} (printer pixel: 34 µm)</dd>
              <dt>Faceting on curves</dt><dd>up to {um(analysis.facet.max)} (95 % of edges under {um(analysis.facet.p95)})</dd>
              <dt>Watertight</dt><dd>{r.watertight ? 'Yes' : 'No'}</dd>
              {(r.openEdges > 0 || r.nonManifoldEdges > 0) && <><dt>Open / non-manifold edges</dt><dd>{n(r.openEdges)} / {n(r.nonManifoldEdges)}</dd></>}
              {(r.degenerateTriangles > 0 || r.duplicateTriangles > 0) && <><dt>Broken / repeated triangles</dt><dd>{n(r.degenerateTriangles)} / {n(r.duplicateTriangles)} (will be removed)</dd></>}
              {(r.inconsistentEdges > 0 || r.invertedParts > 0) && <><dt>Wrong-facing faces</dt><dd>{n(r.inconsistentEdges)} edges, {r.invertedParts} inside-out parts (will be turned)</dd></>}
            </dl>
          </section>
        </>
      )}

      {result && (
        <section className="panel" aria-labelledby="stl-result">
          <h2 id="stl-result">Result</h2>
          {useEnhanced && (
            <p className="fine-print">Methods chosen automatically for each part{result.result.fallbacks > 0 ? `; ${result.result.fallbacks} attempt(s) were refused by the checks and a safer method was used instead` : ''}. Creases sharper than {result.result.settings.creaseAngleDeg}° were kept sharp.</p>
          )}
          <p className={useEnhanced ? 'form-ok' : 'stl-note'}>{result.result.message}</p>
          {useEnhanced && <table className="table stl-table">
            <thead><tr><th scope="col" /><th scope="col">Original</th><th scope="col">Optimised</th></tr></thead>
            <tbody>
              <tr><th scope="row">Faceting on curves</th><td>max {um(result.result.faceting.before.max)}, 95 % under {um(result.result.faceting.before.p95)}</td><td>max {um(result.result.faceting.after.max)}, 95 % under {um(result.result.faceting.after.p95)}</td></tr>
              <tr><th scope="row">Triangles</th><td>{n(result.repaired.triangles)}</td><td>{n(result.enhanced.triangles)}</td></tr>
              <tr><th scope="row">Size (mm)</th><td>{result.repaired.sizeMm.map((v) => v.toFixed(3)).join(' × ')}</td><td>{result.enhanced.sizeMm.map((v) => v.toFixed(3)).join(' × ')}</td></tr>
              <tr><th scope="row">Volume</th><td>{(result.repaired.volumeMm3 / 1000).toFixed(3)} ml</td><td>{(result.enhanced.volumeMm3 / 1000).toFixed(3)} ml ({result.result.comparison.volumeChangePct >= 0 ? '+' : ''}{result.result.comparison.volumeChangePct.toFixed(2)} %)</td></tr>
              <tr><th scope="row">Surface moved</th><td>—</td><td>max {um(result.result.comparison.enhancedToOriginal.max)}, mean {um(result.result.comparison.enhancedToOriginal.mean)}</td></tr>
              <tr><th scope="row">Original vertices moved</th><td>—</td><td>max {um(result.result.comparison.originalVerticesToEnhanced.max)}</td></tr>
              <tr><th scope="row">Watertight</th><td>{result.repaired.watertight ? 'Yes' : 'No'}</td><td>{result.verified.watertight ? 'Yes' : 'No'} (checked in the written file)</td></tr>
              <tr><th scope="row">Fragile (thinner than {MIN_WALL_MM} mm)</th><td>{result.fragile.original.thinAreaPct.toFixed(1)} % of surface</td><td>{result.fragile.enhanced.thinAreaPct.toFixed(1)} % of surface</td></tr>
              <tr><th scope="row">Walls under one pixel</th><td>{n(result.fragile.original.subPixelTriangles)} triangles</td><td>{n(result.fragile.enhanced.subPixelTriangles)} triangles</td></tr>
            </tbody>
          </table>}
          <p className="fine-print">
            Repairs: {result.repairLog.removedDegenerate} broken and {result.repairLog.removedDuplicate} repeated triangles removed; {result.repairLog.flippedTriangles} faces turned the right way ({result.repairLog.flippedParts} inside-out parts).
            {result.result.partsUnchanged.length > 0 && ` Left exactly as they were: ${result.result.partsUnchanged.length} part(s) — ${[...new Set(result.result.partsUnchanged.map((p) => p.reason))].join('; ')}.`}
            {' '}Holes are never filled and no part is removed.
          </p>
          <PrintCheck result={result} optimised={useEnhanced} fits={estimate?.fits ?? null} fitNote={estimate?.fitNote ?? ''} />
          <div className="button-row">
            {useEnhanced
              ? <button type="button" className="button" onClick={() => download(`${base}-optimised.stl`, result.stl)}>Download optimised STL</button>
              : <button type="button" className="button" onClick={() => download(`${base}-print-ready.stl`, writeBinaryStl(result.repairedSoup, result.repairedSoup.length / 9))}>Download STL</button>}
          </div>
          <p className="fine-print">Binary STL in millimetres, for Lychee or any slicer. {useEnhanced ? 'Optimised geometry, repaired and verified.' : 'The original geometry, with only the safe repairs listed above.'} Your uploaded file is not changed.</p>
        </section>
      )}

      {leftView && (
        <section className="panel" aria-labelledby="stl-view">
          <h2 id="stl-view">Compare</h2>
          <div className="row-wrap">
            <label className="checkbox"><input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} /> Show fragile areas</label>
            <label className="checkbox"><input type="checkbox" checked={wire} onChange={(e) => setWire(e.target.checked)} /> Wireframe</label>
          </div>
          <StlCompare left={leftView} right={rightView} highlight={highlight} wireframe={wire} />
          {result && <p className="fine-print"><span className="stl-key stl-key-thin" /> thinner than {MIN_WALL_MM} mm <span className="stl-key stl-key-red" /> thinner than one printer pixel (34 µm): will not print. Thickness is measured straight through each surface; it is a guide, not a guarantee.</p>}
        </section>
      )}

      {analysis && estimate && oriented && (
        <details className="panel stl-print" aria-labelledby="stl-print">
          <summary><h2 id="stl-print">Print estimate for the {PHOTON_MONO_2.name} (optional)</h2></summary>
          <p className="fine-print">Nominal 34 µm XY pixel; build volume {PHOTON_MONO_2.buildMm.join(' × ')} mm (nominal). Settings are starting values: use your resin's exposure times. {useEnhanced ? 'Estimated for the enhanced model.' : 'Estimated for the original model.'}</p>
          <div className="stl-grid">
            <label>Tilt about X (°)<input type="number" min={-90} max={90} step={5} value={orientation.tiltXDeg} onChange={(e) => setOrientation({ ...orientation, tiltXDeg: Number(e.target.value) || 0 })} /></label>
            <label>Tilt about Y (°)<input type="number" min={-90} max={90} step={5} value={orientation.tiltYDeg} onChange={(e) => setOrientation({ ...orientation, tiltYDeg: Number(e.target.value) || 0 })} /></label>
            <label>Layer height (mm)<input type="number" min={0.01} max={0.1} step={0.01} value={print.layerMm} onChange={(e) => setP('layerMm', Number(e.target.value))} /></label>
            <label>Exposure (s)<input type="number" min={0.5} max={10} step={0.1} value={print.exposureS} onChange={(e) => setP('exposureS', Number(e.target.value))} /></label>
            <label>Bottom exposure (s)<input type="number" min={5} max={90} step={1} value={print.bottomExposureS} onChange={(e) => setP('bottomExposureS', Number(e.target.value))} /></label>
            <label>Bottom layers<input type="number" min={1} max={20} step={1} value={print.bottomLayers} onChange={(e) => setP('bottomLayers', Number(e.target.value))} /></label>
            <label>Lift distance (mm)<input type="number" min={1} max={15} step={0.5} value={print.liftMm} onChange={(e) => setP('liftMm', Number(e.target.value))} /></label>
            <label>Lift speed (mm/s)<input type="number" min={0.2} max={10} step={0.1} value={print.liftSpeedMmS} onChange={(e) => setP('liftSpeedMmS', Number(e.target.value))} /></label>
            <label>Retract speed (mm/s)<input type="number" min={0.2} max={10} step={0.1} value={print.retractSpeedMmS} onChange={(e) => setP('retractSpeedMmS', Number(e.target.value))} /></label>
            <label>Light-off delay (s)<input type="number" min={0} max={5} step={0.1} value={print.lightOffDelayS} onChange={(e) => setP('lightOffDelayS', Number(e.target.value))} /></label>
            <label>Support height (mm)<input type="number" min={0} max={20} step={0.5} value={print.supportHeightMm} onChange={(e) => setP('supportHeightMm', Number(e.target.value))} /></label>
          </div>
          <dl className="stl-stats">
            <dt>Oriented size</dt><dd>{mm(oriented[0])} × {mm(oriented[1])} × {mm(oriented[2])}</dd>
            <dt>Layers</dt><dd>{n(estimate.layers)} (model + supports: {mm(estimate.heightMm, 1)})</dd>
            <dt>Estimated print time</dt><dd><strong>{formatDuration(estimate.seconds)}</strong></dd>
            <dt>Build volume</dt><dd className={estimate.fits ? '' : 'form-error'}>{estimate.fitNote}</dd>
          </dl>
          <p className="fine-print">Print time on a resin printer depends on height, not width: every layer is exposed at once. This is an estimate from the settings above; supports, hollowing and printability are decided in Lychee, and nothing here guarantees a successful print.</p>
        </details>
      )}
    </div>
  );
}
