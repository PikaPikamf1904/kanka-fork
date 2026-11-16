import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ASPECTS, clampView, cropFromView, MAX_ZOOM, type AspectKey, type View } from './crop.ts';

/**
 * Drag (or use the arrow keys) to reposition, pinch or use the slider to zoom. Controlled: the
 * parent keeps the view and turns it into a crop with cropFromView when saving.
 */
export function Cropper({ src, width, height, aspect, onAspect, view, onView, aspects }: {
  src: string;
  width: number;
  height: number;
  aspect: AspectKey;
  onAspect(a: AspectKey): void;
  view: View;
  onView(v: View): void;
  aspects: AspectKey[];
}) {
  const ratio = ASPECTS[aspect].ratio;
  const r = ratio ?? width / height;
  const box = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const maxH = Math.max(180, (typeof window === 'undefined' ? 800 : window.innerHeight) * 0.5);
  const frameW = Math.max(1, Math.min(boxWidth || 320, maxH * r));
  const frameH = frameW / r;
  const crop = cropFromView(view, width, height, ratio);
  const scale = frameW / crop.width;

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; x: number; y: number; dist: number } | null>(null);
  const set = (v: View) => onView(clampView(v, width, height, ratio));
  const centre = () => {
    const pts = [...pointers.current.values()];
    const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0;
    return { x, y, dist };
  };
  function down(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current = { view, ...centre() };
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const now = centre();
    const zoom = g.dist > 0 && now.dist > 0 ? g.view.zoom * (now.dist / g.dist) : g.view.zoom;
    set({ zoom, cx: g.view.cx - (now.x - g.x) / scale / width, cy: g.view.cy - (now.y - g.y) / scale / height });
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    gesture.current = pointers.current.size ? { view, ...centre() } : null;
  }
  function key(e: KeyboardEvent<HTMLDivElement>) {
    const step = 0.02;
    const moves: Record<string, Partial<View>> = {
      ArrowLeft: { cx: view.cx - step }, ArrowRight: { cx: view.cx + step }, ArrowUp: { cy: view.cy - step }, ArrowDown: { cy: view.cy + step },
      '+': { zoom: view.zoom * 1.1 }, '=': { zoom: view.zoom * 1.1 }, '-': { zoom: view.zoom / 1.1 },
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    set({ ...view, ...m });
  }

  return (
    <div className="cropper">
      {aspects.length > 1 && (
        <div className="cropper-aspects" role="group" aria-label="Shape">
          {aspects.map((a) => (
            <button key={a} type="button" className={a === aspect ? 'chip chip-on' : 'chip'} aria-pressed={a === aspect} onClick={() => onAspect(a)}>
              {ASPECTS[a].label}
            </button>
          ))}
        </div>
      )}
      <div ref={box} className="cropper-box">
        <div
          className="cropper-frame"
          style={{ width: frameW, height: frameH }}
          tabIndex={0}
          role="application"
          aria-label="Picture position. Drag to move, pinch or use the slider to zoom; arrow keys move, plus and minus zoom."
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key}
          data-testid="crop-frame"
        >
          <img
            src={src}
            alt=""
            draggable={false}
            style={{ width: width * scale, height: height * scale, transform: `translate(${-crop.x * scale}px, ${-crop.y * scale}px)` }}
          />
          <div className="cropper-grid" aria-hidden="true" />
        </div>
      </div>
      <label className="cropper-zoom">
        Zoom
        <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={view.zoom} onChange={(e) => set({ ...view, zoom: Number(e.target.value) })} />
      </label>
      <p className="fine-print">Drag the picture to move it{aspect === 'original' ? '' : ' inside the frame'}; pinch or use the slider to zoom. Only the part inside the frame is saved.</p>
    </div>
  );
}
