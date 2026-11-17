import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { existingPin, pinThing, type RefType } from '../lib/boardData.ts';
import { isReleased, kindLabel, mysteryShowsClues } from '../lib/clues.ts';
import { cluesFor, discoveredAmong, recordDiscovery, type ClueWithHints } from '../lib/mysteryData.ts';
import { useIsDm } from '../lib/session.tsx';
import { useLoad } from '../lib/useLoad.ts';
import { Markdown } from './Markdown.tsx';

/** "Pin this page" / "Pin to the board": adds a pin once, then links to the board. */
export function PinButton({ refType, refId, label = 'Pin this page' }: { refType: RefType; refId: string; label?: string }) {
  const state = useLoad(() => existingPin(refType, refId), [refType, refId]);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (state.error) return null;
  if (state.data === undefined) return null;
  if (pinned || state.data) {
    return <Link className="button small secondary" to="/board">On the board</Link>;
  }
  return (
    <>
      <button
        type="button"
        className="button small secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          pinThing(refType, refId).then(() => setPinned(true), (e: unknown) => setError(e instanceof Error ? e.message : 'Could not pin that.')).finally(() => setBusy(false));
        }}
      >
        {label}
      </button>
      {error && <span className="form-error" role="alert">{error}</span>}
    </>
  );
}

/** Released clues attached to this page or map, as items the reader can choose to open. */
export function ClueFinds({ attach, id }: { attach: 'article' | 'map'; id: string }) {
  const isDm = useIsDm();
  const clues = useLoad(async () => {
    const all = await cluesFor(attach, id);
    // The database already returns only what a player may see. The DM's account can read everything,
    // so the DM's screens apply the same rule here (released, in an open mystery).
    const shown = isDm ? all.filter((c) => isReleased(c) && mysteryShowsClues(c.mystery_status)) : all;
    return { shown, found: await discoveredAmong(shown.map((c) => c.id)) };
  }, [attach, id, isDm]);
  const [open, setOpen] = useState<ClueWithHints | null>(null);
  const [foundNow, setFoundNow] = useState<string[]>([]);
  if (!clues.data || clues.data.shown.length === 0) return null;
  const found = (cid: string) => clues.data!.found.has(cid) || foundNow.includes(cid);
  return (
    <section className="clue-finds" aria-label="Things you may have noticed">
      {clues.data.shown.map((c) => (
        <button key={c.id} type="button" className={found(c.id) ? 'clue-find clue-found' : 'clue-find'} onClick={() => setOpen(c)}>
          <span aria-hidden="true" className="clue-glyph">{found(c.id) ? '✉' : '✦'}</span>
          {found(c.id) ? <span><strong>{c.title}</strong> <span className="muted">· {kindLabel(c.kind)} you found</span></span> : <span>Something catches your eye…</span>}
        </button>
      ))}
      {open && (
        <ClueDialog
          clue={open}
          record={!isDm}
          onClose={() => setOpen(null)}
          onFound={() => setFoundNow((f) => [...f, open.id])}
        />
      )}
    </section>
  );
}

/** The recovered document. Opening it records the discovery (not for the DM). */
export function ClueDialog({ clue, record, onClose, onFound }: { clue: ClueWithHints; record: boolean; onClose: () => void; onFound?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const isDm = useIsDm();
  useEffect(() => {
    const d = dialog.current!;
    if (!d.open) d.showModal();
    if (record) recordDiscovery(clue.id).then(() => onFound?.(), () => undefined);
    const back = opener.current;
    return () => { if (back instanceof HTMLElement && back.isConnected) back.focus(); };
    // The discovery is recorded once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clue.id]);
  const hints = (isDm ? clue.hints.filter((h) => isReleased(h)) : clue.hints);
  return (
    <dialog ref={dialog} className="clue-dialog" aria-labelledby={`clue-${clue.id}`} onClose={onClose} onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
      <article className={`clue-document clue-kind-${clue.kind}`}>
        <p className="clue-kind">{kindLabel(clue.kind)}</p>
        <h2 id={`clue-${clue.id}`}>{clue.title}</h2>
        {clue.body && <Markdown text={clue.body} />}
        {clue.source_line && <p className="clue-source">{clue.source_line}</p>}
      </article>
      {hints.length > 0 && (
        <section className="clue-hints">
          <h3>Hints</h3>
          <ul>{hints.map((h) => <li key={h.id}>{h.body}</li>)}</ul>
        </section>
      )}
      <div className="button-row">
        <PinButton refType="clue" refId={clue.id} label="Pin to the board" />
        <button type="button" className="button" onClick={() => dialog.current?.close()}>Close</button>
      </div>
    </dialog>
  );
}
