import './beta.css';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useIsDm } from '../lib/session.tsx';
import { TEMPLATES } from '../lib/templates.ts';
import { pageIndex, type IndexEntry } from './api.ts';
import { rank } from './fuzzy.ts';

interface Item { key: string; label: string; hint: string; to: string; glyph: string }

const PLACES: Item[] = [
  { key: 'go:home', label: 'Main page', hint: 'Go to', to: '/', glyph: '⌂' },
  { key: 'go:news', label: 'The Goblin Gazette', hint: 'Go to', to: '/news', glyph: '✒' },
  { key: 'go:maps', label: 'Maps', hint: 'Go to', to: '/maps', glyph: '⌘' },
  { key: 'go:timeline', label: 'Timeline', hint: 'Go to', to: '/timeline', glyph: '⧗' },
  { key: 'go:connections', label: 'Connections', hint: 'Go to', to: '/connections', glyph: '⚭' },
  { key: 'go:sessions', label: 'Session journals', hint: 'Go to', to: '/browse/session', glyph: '✎' },
];
const DM: Item[] = [
  { key: 'dm:table', label: 'Table screen (initiative, dice, pinned pages)', hint: 'DM', to: '/dm/table', glyph: '⚔' },
  { key: 'dm:new', label: 'New article', hint: 'DM', to: '/dm/new', glyph: '+' },
  { key: 'dm:story', label: 'Write a Gazette story', hint: 'DM', to: '/dm/news/new', glyph: '✒' },
  { key: 'dm:desk', label: 'DM desk', hint: 'DM', to: '/dm', glyph: '☰' },
  { key: 'dm:news', label: 'News desk', hint: 'DM', to: '/dm/news', glyph: '✒' },
  { key: 'dm:media', label: 'Media library', hint: 'DM', to: '/dm/media', glyph: '🖼' },
  { key: 'dm:notes', label: 'Private notes', hint: 'DM', to: '/dm/notes', glyph: '✉' },
  { key: 'dm:settings', label: 'Wiki settings', hint: 'DM', to: '/dm/settings', glyph: '⚙' },
];

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * Quick jump: Ctrl+K (⌘K on a Mac) or "/" anywhere outside a text box, or the header button.
 * Fuzzy-finds any page the reader may see, plus places and (for the DM) tools.
 */
export function QuickJump() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === '/' && !typing(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('chronicle:quick-jump', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('chronicle:quick-jump', onOpen);
    };
  }, []);
  return open ? <Palette onClose={() => setOpen(false)} /> : null;
}

export function QuickJumpButton() {
  return (
    <button type="button" className="icon-button quick-jump-button" onClick={() => window.dispatchEvent(new Event('chronicle:quick-jump'))} title="Quick jump (Ctrl+K)">
      <span aria-hidden="true">⤳</span>
      <span className="visually-hidden">Quick jump to a page</span>
    </button>
  );
}

function Palette({ onClose }: { onClose(): void }) {
  const isDm = useIsDm();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [pages, setPages] = useState<IndexEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    input.current?.focus();
    let live = true;
    pageIndex().then((p) => live && setPages(p), () => live && setFailed(true));
    return () => {
      live = false;
      prev?.focus?.();
    };
  }, []);

  const items = useMemo<Item[]>(() => {
    const tools = [...PLACES, ...(isDm ? DM : [])];
    const asItems = (pages ?? []).map((p): Item => ({
      key: `page:${p.slug}`, label: p.title, hint: TEMPLATES[p.type]?.label ?? p.type,
      to: p.type === 'news' ? `/news/${p.slug}` : `/wiki/${p.slug}`, glyph: TEMPLATES[p.type]?.glyph ?? '•',
    }));
    if (!q.trim()) return tools;
    const found = rank(q, [...asItems, ...tools], (i) => i.label, 14);
    return [...found, { key: 'search', label: `Search the wiki for “${q.trim()}”`, hint: 'Full text', to: `/search?q=${encodeURIComponent(q.trim())}`, glyph: '⌕' }];
  }, [q, pages, isDm]);

  const go = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    navigate(item.to);
  };

  return (
    <>
      <div className="quick-jump-backdrop" onClick={onClose} />
      <div className="quick-jump" role="dialog" aria-modal="true" aria-label="Quick jump">
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          aria-label="Jump to a page or tool"
          placeholder="Jump to a page or tool…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); go(items[active]); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
        />
        <ul id={listId} role="listbox" className="quick-jump-list" aria-label="Results">
          {items.map((item, i) => (
            <li
              key={item.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'on' : undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(item)}
            >
              <span className="quick-jump-glyph" aria-hidden="true">{item.glyph}</span>
              <span className="quick-jump-label">{item.label}</span>
              <span className="quick-jump-hint">{item.hint}</span>
            </li>
          ))}
        </ul>
        <p className="quick-jump-foot">
          {failed ? 'Could not load the page list; places still work.' : pages === null ? 'Loading pages…' : `${pages.length} pages`}
          <span aria-hidden="true"> · ↑↓ to choose · Enter to open · Esc to close</span>
        </p>
      </div>
    </>
  );
}
