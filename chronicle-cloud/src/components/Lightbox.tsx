import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { orderByDocument, positionLabel, stepIndex, swipeDelta } from '../lib/lightbox.ts';

/** A picture the reader can already see, registered once its signed URL has loaded. */
export interface LightboxEntry {
  id: string;
  /** The figure in the page; its position in the document decides the order. */
  el: HTMLElement;
  url: string;
  alt: string;
  caption: string;
  /** Asks the figure for a fresh link after `failedUrl` stopped loading; it re-registers with the new one. */
  refresh?: (failedUrl: string) => void;
}

interface LightboxApi {
  register: (entry: LightboxEntry) => () => void;
  open: (id: string, opener: HTMLElement | null) => void;
}

const LightboxContext = createContext<LightboxApi | null>(null);

/** Null when there is no provider, so a picture falls back to a plain link to the file. */
export function useLightbox(): LightboxApi | null {
  return useContext(LightboxContext);
}

/**
 * Lets every picture in the article body below it open one viewer that steps through all of
 * them in page order. Pictures register only after their signed link loaded, so the viewer never
 * fetches, lists or reveals anything the reader cannot already see on the page.
 */
export function LightboxProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ReadonlyMap<string, LightboxEntry>>(new Map());
  const [view, setView] = useState<{ origin: string; current: string } | null>(null);
  const originRef = useRef<HTMLElement | null>(null);

  const register = useCallback((entry: LightboxEntry) => {
    setEntries((prev) => new Map(prev).set(entry.id, entry));
    return () =>
      setEntries((prev) => {
        if (prev.get(entry.id) !== entry) return prev;
        const next = new Map(prev);
        next.delete(entry.id);
        return next;
      });
  }, []);
  const open = useCallback((id: string, opener: HTMLElement | null) => {
    originRef.current = opener;
    setView({ origin: id, current: id });
  }, []);
  const api = useMemo(() => ({ register, open }), [register, open]);

  // Recomputed as pictures appear, vanish or get a fresh link while the viewer is open.
  const ordered = useMemo(() => (view ? orderByDocument(entries.values()) : []), [view, entries]);

  const close = useCallback(() => {
    const target = originRef.current;
    setView(null);
    // The viewer unmounts first; then the clicked picture gets focus back.
    requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
    });
  }, []);

  return (
    <LightboxContext.Provider value={api}>
      {children}
      {view && ordered.length > 0 &&
        createPortal(
          <Viewer
            entries={ordered}
            currentId={view.current}
            onChange={(id) => setView((v) => (v ? { ...v, current: id } : v))}
            onClose={close}
          />,
          document.body,
        )}
    </LightboxContext.Provider>
  );
}

function Viewer({ entries, currentId, onChange, onClose }: { entries: LightboxEntry[]; currentId: string; onChange: (id: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const found = entries.findIndex((e) => e.id === currentId);
  const index = found < 0 ? 0 : found;
  const entry = entries[index]!;
  const many = entries.length > 1;

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = before;
    };
  }, []);

  const go = (delta: number) => onChange(entries[stepIndex(index, entries.length, delta)]!.id);

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerUp = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || s.id !== e.pointerId || !many) return;
    const delta = swipeDelta(e.clientX - s.x, e.clientY - s.y);
    if (delta) go(delta);
  };

  return (
    <dialog
      ref={dialog}
      className="lightbox"
      aria-label="Picture viewer"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) dialog.current?.close(); // a click on the backdrop
      }}
      onKeyDown={(e) => {
        if (!many || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      }}
    >
      <div className="lightbox-frame">
        <div className="lightbox-bar">
          <p className="lightbox-position" aria-live="polite" data-testid="lightbox-position">{positionLabel(index, entries.length)}</p>
          <a className="lightbox-original" href={entry.url} target="_blank" rel="noopener noreferrer">Open original</a>
          <button type="button" className="lightbox-button" aria-label="Close" onClick={() => dialog.current?.close()}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="lightbox-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { start.current = null; }}>
          {many && (
            <button type="button" className="lightbox-button lightbox-prev" aria-label="Previous picture" onClick={() => go(-1)}>
              <span aria-hidden="true">‹</span>
            </button>
          )}
          <img key={entry.id} src={entry.url} alt={entry.alt} draggable={false} referrerPolicy="no-referrer" onError={() => entry.refresh?.(entry.url)} />
          {many && (
            <button type="button" className="lightbox-button lightbox-next" aria-label="Next picture" onClick={() => go(1)}>
              <span aria-hidden="true">›</span>
            </button>
          )}
        </div>
        {(entry.caption || entry.alt) && (
          <div className="lightbox-text">
            {entry.caption && <p className="lightbox-caption">{entry.caption}</p>}
            {entry.alt && <p className="lightbox-alt">{entry.alt}</p>}
          </div>
        )}
      </div>
    </dialog>
  );
}
