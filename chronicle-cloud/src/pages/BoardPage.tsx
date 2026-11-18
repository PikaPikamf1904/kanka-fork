import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboard, type PointerEvent as ReactPointer } from 'react';
import { Link } from 'react-router';
import { MediaImage } from '../components/MediaImage.tsx';
import { articlesBySlugs, suggest } from '../lib/api.ts';
import {
  addCard, addGroup, addLink, deleteCard, deleteGroup, deleteLink, loadBoard, resolvePins, updateCard,
  type Board, type BoardItem, type BoardLink, type CardPatch, type PinTarget,
} from '../lib/boardData.ts';
import {
  activityText, BOARD_COLOURS, buildBoardSvg, CARD_H, CARD_W, colourLabel, fitView, groupCards, HOME_VIEW, linkLine, MARKS, NUDGE, nudge,
  spawnPosition, statusLabel, THEORY_STATUS, zoomAt, type ExportCard, type View,
} from '../lib/boardLogic.ts';
import { useSession } from '../lib/session.tsx';
import type { ArticleRef } from '../lib/types.ts';

const UNAVAILABLE = 'This evidence is no longer available';
const CONFLICT_NOTICE = 'Someone else changed this card; the board was refreshed.';
const POLL_MS = 10000;
type Draft = null | 'pin' | 'note' | 'theory';

const kindWord = (i: BoardItem) => (i.kind === 'pin' ? 'Pinned page' : i.kind === 'note' ? 'Note' : 'Theory');

interface Ctx {
  userId: string;
  isDm: boolean;
  board: Board;
  targets: Map<string, PinTarget>;
  titleOf(i: BoardItem): string;
  change(item: BoardItem, patch: CardPatch): Promise<boolean>;
  remove(item: BoardItem): Promise<void>;
  connect(from: string, to: string, label: string): Promise<boolean>;
  disconnect(link: BoardLink): Promise<void>;
  close(): void;
}

/** The party's Investigation Board: pinned evidence, notes and theories, connected with labelled lines. */
export function BoardPage() {
  const { state } = useSession();
  const userId = state.kind === 'member' ? state.userId : '';
  const isDm = state.kind === 'member' && state.role === 'dm';
  const [board, setBoard] = useState<Board | null>(null);
  const [targets, setTargets] = useState<Map<string, PinTarget>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<Draft>(null);
  const [list, setList] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 599px)').matches);
  const [section, setSection] = useState<string>('all');
  const [view, setView] = useState<View>(HOME_VIEW);
  const [moved, setMoved] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const boardRef = useRef<Board | null>(null);
  const busyDrag = useRef(false);
  const loadSeq = useRef(0);
  const timers = useRef(new Map<string, number>());

  const reload = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const b = await loadBoard();
      const t = await resolvePins(b.items);
      if (seq !== loadSeq.current) return;
      boardRef.current = b;
      setBoard(b);
      setTargets(t);
      setLoadError(null);
    } catch (e) {
      if (seq === loadSeq.current && !boardRef.current) setLoadError(e instanceof Error ? e.message : 'Could not load the board.');
    }
  }, []);

  useEffect(() => {
    // Loads the board when the page opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    // No realtime channel is available, so look for changes every 10 seconds while the tab is showing.
    const id = window.setInterval(() => { if (document.visibilityState === 'visible' && !busyDrag.current) void reload(); }, POLL_MS);
    const timerMap = timers.current;
    return () => { window.clearInterval(id); timerMap.forEach((t) => window.clearTimeout(t)); };
  }, [reload]);

  const items = useMemo(() => board?.items ?? [], [board]);
  const pos = useCallback((i: BoardItem) => (dragging?.id === i.id ? dragging : moved.get(i.id) ?? i), [dragging, moved]);
  const shown = useMemo(() => items.filter((i) => section === 'all' || (section === 'none' ? !i.group_id || !board?.groups.some((g) => g.id === i.group_id) : i.group_id === section)), [items, section, board]);
  const shownIds = useMemo(() => new Set(shown.map((i) => i.id)), [shown]);
  const rect = useCallback((i: BoardItem) => ({ x: pos(i).x, y: pos(i).y, w: CARD_W, h: CARD_H }), [pos]);

  // Keep every card in view: fit when the board first has cards, when cards are added or removed, when the
  // board area changes size, and on "Reset view". Once the reader pans or zooms, their own view is kept.
  const userMoved = useRef(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const surfaceOn = !!board && !list && items.length > 0;
  useEffect(() => {
    const el = viewport.current;
    if (!el || !surfaceOn) return;
    const measure = () => { const r = el.getBoundingClientRect(); setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height })); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [surfaceOn]);
  const fitKey = shown.map((i) => i.id).join(',');
  useEffect(() => {
    if (userMoved.current || size.w === 0 || shown.length === 0) return;
    const sh = boardRef.current?.items.filter((i) => fitKey.split(',').includes(i.id)) ?? [];
    setView(fitView(sh.map((i) => ({ x: i.x, y: i.y, w: CARD_W, h: CARD_H })), size.w, size.h));
    // Only the set of cards and the size of the area decide when to fit, not where cards sit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, size.w, size.h]);

  const titleOf = useCallback((i: BoardItem) => (i.kind === 'pin' ? targets.get(i.ref_id ?? '')?.title ?? UNAVAILABLE : i.title), [targets]);

  const applyItem = useCallback((item: BoardItem) => {
    setBoard((b) => {
      if (!b) return b;
      const next = { ...b, items: b.items.map((i) => (i.id === item.id ? item : i)) };
      boardRef.current = next;
      return next;
    });
  }, []);

  const change = useCallback(async (item: BoardItem, patch: CardPatch) => {
    setError(null);
    const r = await updateCard(item, patch);
    if (r.ok) { applyItem(r.item); return true; }
    if (r.reason === 'conflict') { setNotice(CONFLICT_NOTICE); await reload(); } else setError(r.message);
    return false;
  }, [applyItem, reload]);

  const commitMove = useCallback(async (id: string, x: number, y: number) => {
    const cur = boardRef.current?.items.find((i) => i.id === id);
    if (cur && (cur.x !== x || cur.y !== y)) await change(cur, { x, y });
    setMoved((m) => { const n = new Map(m); n.delete(id); return n; });
  }, [change]);

  const scheduleMove = (item: BoardItem, x: number, y: number) => {
    setMoved((m) => new Map(m).set(item.id, { x, y }));
    window.clearTimeout(timers.current.get(item.id));
    timers.current.set(item.id, window.setTimeout(() => void commitMove(item.id, x, y), 400));
  };

  const ctx: Ctx | null = board ? {
    userId, isDm, board, targets, titleOf, change,
    async remove(item) {
      if (!window.confirm(`Remove ${item.kind === 'pin' ? 'this pinned page' : `“${item.title}”`} from the board?`)) return;
      try { await deleteCard(item.id); setSelected(null); await reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not remove it.'); }
    },
    async connect(from, to, label) {
      try { await addLink(from, to, label); await reload(); return true; } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect them.'); return false; }
    },
    async disconnect(link) {
      try { await deleteLink(link.id); await reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not remove the connection.'); }
    },
    close: () => setSelected(null),
  } : null;

  // ----- pointer handling: drag a card, pan the board, pinch to zoom -----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<null | { type: 'pan'; sx: number; sy: number; v: View } | { type: 'card'; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }>(null);
  const pinch = useRef<null | { d: number; v: View; cx: number; cy: number }>(null);
  const dragRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  const onDown = (e: ReactPointer) => {
    if ((e.target as HTMLElement).closest('.board-tools')) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const r = viewport.current!.getBoundingClientRect();
      pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), v: viewRef.current, cx: (a!.x + b!.x) / 2 - r.left, cy: (a!.y + b!.y) / 2 - r.top };
      gesture.current = null;
      setDragging(null);
      return;
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-card-id]');
    const item = el ? items.find((i) => i.id === el.dataset.cardId) : undefined;
    if (item) {
      gesture.current = { type: 'card', id: item.id, sx: e.clientX, sy: e.clientY, ox: pos(item).x, oy: pos(item).y, moved: false };
    } else {
      gesture.current = { type: 'pan', sx: e.clientX, sy: e.clientY, v: viewRef.current };
    }
  };
  const onMove = (e: ReactPointer) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      userMoved.current = true;
      setView(zoomAt(pinch.current.v, d / pinch.current.d, pinch.current.cx, pinch.current.cy));
      return;
    }
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (g.type === 'pan') { if (Math.hypot(dx, dy) > 3) userMoved.current = true; setView({ ...g.v, x: g.v.x + dx, y: g.v.y + dy }); }
    else {
      if (!g.moved && Math.hypot(dx, dy) < 4) return;
      g.moved = true;
      busyDrag.current = true;
      const k = viewRef.current.k;
      const d = { id: g.id, ...nudge({ x: g.ox, y: g.oy }, dx / k, dy / k) };
      dragRef.current = d;
      setDragging(d);
    }
  };
  const onUp = (e: ReactPointer) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const g = gesture.current;
    gesture.current = null;
    if (g?.type !== 'card') return;
    busyDrag.current = false;
    const d = dragRef.current;
    dragRef.current = null;
    if (g.moved && d) {
      setMoved((m) => new Map(m).set(d.id, { x: d.x, y: d.y }));
      setDragging(null);
      void commitMove(d.id, d.x, d.y);
    } else {
      setDragging(null);
      setSelected(g.id);
    }
  };
  const onCancel = (e: ReactPointer) => {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    gesture.current = null;
    dragRef.current = null;
    busyDrag.current = false;
    setDragging(null);
  };

  // Wheel zoom needs a non-passive listener so the page does not scroll as well.
  const surfaceReady = !!board && !list;
  useEffect(() => {
    const el = viewport.current;
    if (!el || !surfaceReady) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userMoved.current = true;
      const r = el.getBoundingClientRect();
      setView((v) => zoomAt(v, Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [surfaceReady]);

  const onCardKey = (e: ReactKeyboard, item: BoardItem) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(item.id); return; }
    const d = ({ ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] } as Record<string, [number, number]>)[e.key];
    if (!d) return;
    e.preventDefault();
    const p = nudge(moved.get(item.id) ?? item, d[0], d[1]);
    scheduleMove(item, p.x, p.y);
  };

  const resetView = () => {
    userMoved.current = false;
    const r = viewport.current?.getBoundingClientRect();
    setView(r && shown.length ? fitView(shown.map((i) => rect(i)), r.width, r.height) : { ...HOME_VIEW });
  };
  const zoomBy = (f: number) => {
    userMoved.current = true;
    const r = viewport.current?.getBoundingClientRect();
    setView((v) => zoomAt(v, f, (r?.width ?? 600) / 2, (r?.height ?? 400) / 2));
  };

  async function saveImage() {
    if (!board) return;
    const cards: ExportCard[] = shown.map((i) => ({
      id: i.id, ...rect(i), title: titleOf(i), colour: i.colour,
      subtitle: i.kind === 'theory' ? `Theory · ${statusLabel(i.theory_status)}` : kindWord(i),
    }));
    const svg = buildBoardSvg(cards, board.links.filter((l) => shownIds.has(l.from_item) && shownIds.has(l.to_item)).map((l) => ({ from: l.from_item, to: l.to_item, label: l.label })));
    const download = (blob: Blob, name: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    try {
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('image')); img.src = url; });
      const canvas = document.createElement('canvas');
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const png = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
      if (!png) throw new Error('png');
      download(png, 'investigation-board.png');
    } catch {
      download(svgBlob, 'investigation-board.svg');
    }
  }

  const selectedItem = items.find((i) => i.id === selected) ?? null;
  const addAt = (): { x: number; y: number } => {
    const r = viewport.current?.getBoundingClientRect();
    if (r && !list) return spawnPosition(view, r.width, r.height, items.length);
    return { x: (items.length % 6) * 40, y: Math.floor(items.length / 6) * 40 };
  };
  const created = async (item: BoardItem) => { setAdding(null); setSelected(item.id); await reload(); };

  if (loadError) {
    return (
      <div className="board-page">
        <h1 className="page-title">Investigation board</h1>
        <div className="notice" role="alert"><p>Could not open the board: {loadError}</p><button type="button" className="button secondary small" onClick={() => void reload()}>Try again</button></div>
      </div>
    );
  }
  // eslint-disable-next-line react-hooks/refs -- the context object only holds callbacks; no ref is read while rendering
  if (!board || !ctx) return <div className="board-page"><h1 className="page-title">Investigation board</h1><p className="muted" role="status">Opening the board…</p></div>;

  return (
    <div className="board-page">
      <h1 className="page-title">Investigation board</h1>
      <p className="muted">The party&rsquo;s shared board. Pin pages you have found, add notes, and connect them. <strong>Theories are the party&rsquo;s guesses, not facts of the story.</strong></p>
      {notice && <p className="notice" role="status">{notice} <button type="button" className="link-button" onClick={() => setNotice(null)}>Dismiss</button></p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="board-toolbar" role="toolbar" aria-label="Board tools">
        <button type="button" className="button small" onClick={() => setAdding(adding === 'pin' ? null : 'pin')} aria-expanded={adding === 'pin'}>Pin a page</button>
        <button type="button" className="button small" onClick={() => setAdding(adding === 'note' ? null : 'note')} aria-expanded={adding === 'note'}>Add a note</button>
        <button type="button" className="button small" onClick={() => setAdding(adding === 'theory' ? null : 'theory')} aria-expanded={adding === 'theory'}>Add a theory</button>
        <label className="board-filter">
          <span className="visually-hidden">Show section</span>
          <select aria-label="Show section" value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="all">All sections</option>
            {board.groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            <option value="none">No section</option>
          </select>
        </label>
        <button type="button" className="button small secondary" aria-pressed={list} onClick={() => setList(!list)}>{list ? 'Board view' : 'List view'}</button>
        {!list && (
          <>
            <button type="button" className="button small secondary" onClick={() => zoomBy(1.25)}>Zoom in</button>
            <button type="button" className="button small secondary" onClick={() => zoomBy(0.8)}>Zoom out</button>
            <button type="button" className="button small secondary" onClick={resetView}>Reset view</button>
          </>
        )}
        <button type="button" className="button small secondary" onClick={() => void saveImage()} disabled={shown.length === 0}>Save as image</button>
      </div>

      {adding && <AddPanel kind={adding} groups={board.groups} at={addAt} onAdded={created} onCancel={() => setAdding(null)} setError={setError} />}
      <SectionsPanel ctx={ctx} onChanged={reload} setError={setError} />

      {items.length === 0 && !adding && (
        <section className="panel board-empty">
          <h2>Start the board</h2>
          <p>This is where the party lays out what it knows. Pin a page you have read, jot a note, or write down a theory, then draw lines between them to show how they connect.</p>
          <div className="button-row">
            <button type="button" className="button" onClick={() => setAdding('pin')}>Pin a page</button>
            <button type="button" className="button" onClick={() => setAdding('note')}>Add a note</button>
            <button type="button" className="button" onClick={() => setAdding('theory')}>Add a theory</button>
          </div>
        </section>
      )}

      {items.length > 0 && !list && (
        <div className="board-layout">
          <div
            ref={viewport}
            className="board-surface"
            role="region"
            aria-label="Board. Tab to a card and press Enter to open it, or use the arrow keys to move it."
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onCancel}
          >
            <div className="board-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
              <svg className="board-links" width="1" height="1" aria-hidden="true">
                {board.links.filter((l) => shownIds.has(l.from_item) && shownIds.has(l.to_item)).map((l) => {
                  const a = items.find((i) => i.id === l.from_item)!;
                  const b = items.find((i) => i.id === l.to_item)!;
                  const g = linkLine(rect(a), rect(b));
                  return (
                    <g key={l.id} data-testid="board-link">
                      <line x1={g.from.x} y1={g.from.y} x2={g.to.x} y2={g.to.y} />
                      {l.label && <text x={g.mid.x} y={g.mid.y - 6} textAnchor="middle">{l.label}</text>}
                    </g>
                  );
                })}
              </svg>
              {shown.map((i) => {
                const p = pos(i);
                const group = board.groups.find((g) => g.id === i.group_id);
                const target = i.kind === 'pin' ? targets.get(i.ref_id ?? '') : undefined;
                return (
                  <div
                    key={i.id}
                    role="button"
                    tabIndex={0}
                    data-card-id={i.id}
                    data-testid="board-card"
                    aria-pressed={selected === i.id}
                    aria-label={`${kindWord(i)}: ${titleOf(i)}`}
                    className={`board-card bc-${i.colour} bc-${i.kind}${selected === i.id ? ' bc-selected' : ''}${i.kind === 'pin' && !target ? ' bc-gone' : ''}`}
                    style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }}
                    onKeyDown={(e) => onCardKey(e, i)}
                  >
                    <span className="bc-kind">{kindWord(i)}{i.kind === 'theory' && <span className="bc-status">{statusLabel(i.theory_status)}</span>}</span>
                    <span className="bc-title">{titleOf(i)}</span>
                    {target?.mediaId && <MediaImage id={target.mediaId} alt="" className="bc-thumb" />}
                    <span className="bc-foot">
                      {i.marks.map((m) => <span key={m} className="bc-mark">{MARKS.find((x) => x.value === m)?.label}</span>)}
                      {group && <span className="bc-group">{group.title}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          {selectedItem && <aside className="board-side"><CardDetails ctx={ctx} item={selectedItem} /></aside>}
        </div>
      )}

      {items.length > 0 && list && (
        <BoardList ctx={ctx} items={shown} selected={selected} onSelect={(id) => setSelected(selected === id ? null : id)} />
      )}

      <section className="panel board-activity" aria-labelledby="board-activity-h">
        <h2 id="board-activity-h">Recent activity</h2>
        {board.activity.length === 0 ? <p className="muted">Nothing has happened on the board yet.</p> : (
          <ul className="plain-list">
            {board.activity.slice(0, 15).map((a) => <li key={a.id}>{activityText(a)} <span className="muted">· {new Date(a.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------- the list view: sections, then cards with their connections as text ----------

function BoardList({ ctx, items, selected, onSelect }: { ctx: Ctx; items: BoardItem[]; selected: string | null; onSelect(id: string): void }) {
  const sections = groupCards(items, ctx.board.groups);
  const byId = new Map(ctx.board.items.map((i) => [i.id, i]));
  return (
    <div className="board-list">
      {sections.filter((s) => s.cards.length > 0 || s.id !== null).map((s) => (
        <section key={s.id ?? 'none'} className="panel" aria-labelledby={`bl-${s.id ?? 'none'}`}>
          <h2 id={`bl-${s.id ?? 'none'}`}>{s.title} <span className="muted">({s.cards.length})</span></h2>
          {s.cards.length === 0 && <p className="muted">No cards in this section.</p>}
          <ul className="board-list-items">
            {s.cards.map((i) => {
              const links = ctx.board.links.filter((l) => l.from_item === i.id || l.to_item === i.id);
              return (
                <li key={i.id} data-testid="board-list-card" className={`bl-item bc-${i.colour}`}>
                  <button type="button" className="bl-open" aria-expanded={selected === i.id} onClick={() => onSelect(i.id)}>
                    <span className="bc-kind">{kindWord(i)}{i.kind === 'theory' && <span className="bc-status">{statusLabel(i.theory_status)}</span>}</span>
                    <span className="bc-title">{ctx.titleOf(i)}</span>
                  </button>
                  {i.marks.length > 0 && <p className="bc-foot">{i.marks.map((m) => <span key={m} className="bc-mark">{MARKS.find((x) => x.value === m)?.label}</span>)}</p>}
                  {links.length > 0 && (
                    <ul className="bl-links">
                      {links.map((l) => {
                        const other = byId.get(l.from_item === i.id ? l.to_item : l.from_item);
                        return <li key={l.id}>Connected to {other ? ctx.titleOf(other) : 'a removed card'}{l.label ? ` (${l.label})` : ''}</li>;
                      })}
                    </ul>
                  )}
                  {selected === i.id && <CardDetails ctx={ctx} item={i} />}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------- details for one card ----------

function CardDetails({ ctx, item }: { ctx: Ctx; item: BoardItem }) {
  const { userId, isDm, board, targets } = ctx;
  const canEdit = item.created_by === userId || isDm;
  const target = item.kind === 'pin' ? targets.get(item.ref_id ?? '') : undefined;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [colour, setColour] = useState(item.colour);
  const [connecting, setConnecting] = useState(false);
  const [to, setTo] = useState('');
  const [label, setLabel] = useState('');
  const links = board.links.filter((l) => l.from_item === item.id || l.to_item === item.id);
  const others = board.items.filter((i) => i.id !== item.id && !links.some((l) => l.from_item === i.id || l.to_item === i.id));

  return (
    <div className="board-details" aria-label={`Details: ${ctx.titleOf(item)}`} role="group">
      <div className="board-details-head">
        <h3>{ctx.titleOf(item)}</h3>
        <button type="button" className="button small secondary" onClick={ctx.close}>Close</button>
      </div>
      <p className="fine-print">
        {kindWord(item)}{item.author_name ? ` · added by ${item.author_name}${item.is_dm ? ' (DM)' : ''}` : ''}
      </p>
      {item.kind === 'theory' && <p className="fine-print">A theory is the party&rsquo;s guess. It is not a fact of the story.</p>}
      {item.kind === 'pin' && !target && <p className="muted">{UNAVAILABLE}.</p>}
      {target && (
        <p>
          {target.summary && <span>{target.summary}<br /></span>}
          {target.href ? <Link to={target.href}>Open {target.subtitle.toLowerCase()}</Link> : <span className="muted">{target.subtitle}</span>}
        </p>
      )}
      {item.kind !== 'pin' && !editing && item.body && <p className="board-body">{item.body}</p>}

      {editing ? (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void ctx.change(item, { title: title.trim(), body, colour }).then((ok) => { if (ok) setEditing(false); });
          }}
        >
          <label>Title<input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
          {item.kind !== 'pin' && <label>Text<textarea rows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} /></label>}
          <label>Card colour
            <select value={colour} onChange={(e) => setColour(e.target.value)}>{BOARD_COLOURS.map((c) => <option key={c} value={c}>{colourLabel(c)}</option>)}</select>
          </label>
          <div className="button-row">
            <button type="submit" className="button small" disabled={item.kind !== 'pin' && !title.trim()}>Save changes</button>
            <button type="button" className="button small secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="button-row">
          {canEdit && item.kind !== 'pin' && <button type="button" className="button small secondary" onClick={() => { setTitle(item.title); setBody(item.body); setColour(item.colour); setEditing(true); }}>Edit</button>}
          {canEdit && item.kind === 'pin' && <button type="button" className="button small secondary" onClick={() => { setColour(item.colour); setEditing(true); }}>Change colour</button>}
          {canEdit && <button type="button" className="button small danger" onClick={() => void ctx.remove(item)}>{item.kind === 'pin' ? 'Unpin' : 'Delete'}</button>}
        </div>
      )}

      {item.kind === 'theory' && (
        <label className="field">Theory status
          <select aria-label="Theory status" value={item.theory_status ?? 'unresolved'} onChange={(e) => void ctx.change(item, { theory_status: e.target.value })}>
            {THEORY_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      )}
      <div className="chip-cloud" role="group" aria-label="Marks">
        {MARKS.map((m) => {
          const on = item.marks.includes(m.value);
          return <button key={m.value} type="button" className={on ? 'chip chip-on' : 'chip'} aria-pressed={on} onClick={() => void ctx.change(item, { marks: on ? item.marks.filter((x) => x !== m.value) : [...item.marks, m.value] })}>{m.label}</button>;
        })}
      </div>
      <label className="field">Section
        <select aria-label="Section" value={item.group_id ?? ''} onChange={(e) => void ctx.change(item, { group_id: e.target.value || null })}>
          <option value="">No section</option>
          {board.groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
        </select>
      </label>

      <h4>Connections</h4>
      {links.length === 0 && <p className="muted">Not connected to anything yet.</p>}
      <ul className="plain-list">
        {links.map((l) => {
          const other = board.items.find((i) => i.id === (l.from_item === item.id ? l.to_item : l.from_item));
          return (
            <li key={l.id}>
              Connected to <strong>{other ? ctx.titleOf(other) : 'a removed card'}</strong>{l.label && <> ({l.label})</>}{' '}
              {(l.created_by === userId || isDm) && <button type="button" className="button small secondary" onClick={() => void ctx.disconnect(l)}>Remove connection</button>}
            </li>
          );
        })}
      </ul>
      {connecting ? (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            if (!to) return;
            void ctx.connect(item.id, to, label).then((ok) => { if (ok) { setConnecting(false); setTo(''); setLabel(''); } });
          }}
        >
          <label>Connect to
            <select aria-label="Connect to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose a card…</option>
              {others.map((o) => <option key={o.id} value={o.id}>{ctx.titleOf(o)}</option>)}
            </select>
          </label>
          <label>What links them? (optional)<input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="For example: was seen with" /></label>
          <div className="button-row">
            <button type="submit" className="button small" disabled={!to}>Connect</button>
            <button type="button" className="button small secondary" onClick={() => setConnecting(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="button small secondary" onClick={() => setConnecting(true)} disabled={others.length === 0}>Connect to…</button>
      )}
    </div>
  );
}

// ---------- adding ----------

function AddPanel({ kind, groups, at, onAdded, onCancel, setError }: {
  kind: 'pin' | 'note' | 'theory'; groups: Board['groups']; at(): { x: number; y: number }; onAdded(item: BoardItem): Promise<void>; onCancel(): void; setError(m: string | null): void;
}) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<ArticleRef[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [group, setGroup] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (kind !== 'pin') return;
    let live = true;
    const t = window.setTimeout(() => {
      if (q.trim().length < 2) { setFound([]); return; }
      suggest(q.trim()).then((r) => { if (live) setFound(r); }, () => { if (live) setFound([]); });
    }, 200);
    return () => { live = false; window.clearTimeout(t); };
  }, [q, kind]);

  async function run(make: () => Promise<BoardItem>) {
    setBusy(true);
    setError(null);
    try { await onAdded(await make()); } catch (e) { setError(e instanceof Error ? e.message : 'Could not add that.'); } finally { setBusy(false); }
  }

  if (kind === 'pin') {
    return (
      <section className="panel board-add" aria-label="Pin a page">
        <label htmlFor="board-pin-q">Find a page to pin</label>
        <input id="board-pin-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing a page name" autoComplete="off" />
        {found.length > 0 && (
          <ul className="plain-list" aria-label="Matching pages">
            {found.map((f) => (
              <li key={f.slug}>
                <button type="button" className="button secondary small" disabled={busy} onClick={() => void run(async () => {
                  const [page] = await articlesBySlugs([f.slug]);
                  if (!page) throw new Error('That page could not be found.');
                  return addCard({ kind: 'pin', ref_type: 'article', ref_id: page.id, ...at() });
                })}>Pin {f.title}</button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="button secondary small" onClick={onCancel}>Cancel</button>
      </section>
    );
  }
  return (
    <form
      className="panel board-add form-grid"
      aria-label={kind === 'note' ? 'Add a note' : 'Add a theory'}
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => addCard({ kind, title: title.trim(), body, group_id: group || null, ...at() }));
      }}
    >
      {kind === 'theory' && <p className="fine-print">A theory is a guess the party is trying out. It is not a fact of the story.</p>}
      <label>{kind === 'note' ? 'Note title' : 'Theory'}<input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Details (optional)<textarea rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} /></label>
      {groups.length > 0 && (
        <label>Section
          <select value={group} onChange={(e) => setGroup(e.target.value)}><option value="">No section</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
        </label>
      )}
      <div className="button-row">
        <button type="submit" className="button small" disabled={busy || !title.trim()}>{kind === 'note' ? 'Add note' : 'Add theory'}</button>
        <button type="button" className="button secondary small" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function SectionsPanel({ ctx, onChanged, setError }: { ctx: Ctx; onChanged(): Promise<void>; setError(m: string | null): void }) {
  const [title, setTitle] = useState('');
  const [colour, setColour] = useState<string>('amber');
  const { board, userId, isDm } = ctx;
  return (
    <details className="board-sections">
      <summary>Mystery sections ({board.groups.length})</summary>
      <p className="fine-print">Sections group cards by mystery. Choose a section on a card, or filter the board by section.</p>
      <ul className="plain-list">
        {board.groups.map((g) => (
          <li key={g.id}>
            <span className={`bc-group bc-${g.colour}`}>{g.title}</span>{' '}
            {(g.created_by === userId || isDm) && (
              <button type="button" className="button small secondary" aria-label={`Delete the section ${g.title}`} onClick={() => {
                if (window.confirm(`Delete the section “${g.title}”? Its cards stay on the board.`)) void deleteGroup(g.id).then(onChanged, (e: unknown) => setError(e instanceof Error ? e.message : 'Could not delete it.'));
              }}>Delete</button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="button-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          void addGroup(title, colour, Math.max(0, ...board.groups.map((g) => g.position)) + 1).then(() => { setTitle(''); return onChanged(); }, (er: unknown) => setError(er instanceof Error ? er.message : 'Could not add it.'));
        }}
      >
        <label className="visually-hidden" htmlFor="new-section">New section name</label>
        <input id="new-section" value={title} maxLength={80} placeholder="New section, for example: The missing ship" onChange={(e) => setTitle(e.target.value)} />
        <label className="visually-hidden" htmlFor="new-section-colour">Section colour</label>
        <select id="new-section-colour" value={colour} onChange={(e) => setColour(e.target.value)}>{BOARD_COLOURS.map((c) => <option key={c} value={c}>{colourLabel(c)}</option>)}</select>
        <button type="submit" className="button small" disabled={!title.trim()}>Add section</button>
      </form>
    </details>
  );
}
