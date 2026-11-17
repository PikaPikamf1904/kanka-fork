import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { suggest } from '../lib/api.ts';
import { paletteItems, type PaletteCommand } from '../lib/commands.ts';
import { useIsDm } from '../lib/session.tsx';
import { TEMPLATES } from '../lib/templates.ts';

const COMMANDS: PaletteCommand[] = [
  { id: 'home', label: 'Main page', to: '/', keywords: 'home start' },
  { id: 'characters', label: 'Characters', to: '/browse/character', keywords: 'people npcs' },
  { id: 'locations', label: 'Locations', to: '/browse/location', keywords: 'places' },
  { id: 'factions', label: 'Factions', to: '/browse/faction', keywords: 'groups' },
  { id: 'quests', label: 'Quests', to: '/browse/quest' },
  { id: 'sessions', label: 'Session journals', to: '/browse/session', keywords: 'recaps' },
  { id: 'news', label: 'The Goblin Gazette', to: '/news', keywords: 'news paper' },
  { id: 'graph', label: 'Knowledge graph', to: '/graph', keywords: 'web network links' },
  { id: 'az', label: 'A–Z index', to: '/a-z', keywords: 'alphabet directory all pages' },
  { id: 'recent', label: 'Recently updated', to: '/recent', keywords: 'changes new' },
  { id: 'wander', label: 'Wander to a random page', to: '/wander', keywords: 'random surprise' },
  { id: 'saved', label: 'Saved pages', to: '/saved', keywords: 'bookmarks reading lists favourites recently viewed' },
  { id: 'journal', label: 'Your journal', to: '/journal', keywords: 'character theories goals diary notes' },
  { id: 'scratchpad', label: 'My scratchpad', to: '/scratchpad', keywords: 'note jot' },
  { id: 'maps', label: 'Maps', to: '/maps' },
  { id: 'timeline', label: 'Timeline', to: '/timeline', keywords: 'history dates' },
  { id: 'feedback', label: 'Feedback for the DM', to: '/feedback', keywords: 'suggestion bug idea boundaries comfort anonymous' },
  { id: 'search', label: 'Search everything', to: '/search', keywords: 'find full text' },
  { id: 'dm', label: 'DM desk', to: '/dm', dmOnly: true },
  { id: 'new', label: 'New article', to: '/dm/new', keywords: 'create page write', dmOnly: true },
  { id: 'newsdesk', label: 'News desk', to: '/dm/news', keywords: 'gazette', dmOnly: true },
  { id: 'media', label: 'Media library', to: '/dm/media', keywords: 'pictures photos images', dmOnly: true },
  { id: 'tidy', label: 'Tidy up the wiki', to: '/dm/tidy', keywords: 'broken links stubs', dmOnly: true },
  { id: 'visibility', label: 'What players can see', to: '/dm/visibility', keywords: 'leaks hidden secrets', dmOnly: true },
  { id: 'journals', label: 'Player journals', to: '/dm/journals', keywords: 'players character diary theories', dmOnly: true },
  { id: 'feedbackinbox', label: 'Player feedback', to: '/dm/feedback', keywords: 'inbox suggestions bugs boundaries', dmOnly: true },
  { id: 'access', label: 'Player access', to: '/dm/access', keywords: 'codes members', dmOnly: true },
  { id: 'settings', label: 'Wiki settings', to: '/dm/settings', dmOnly: true },
];

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** Ctrl/⌘+K (or "/" when not typing) opens a quick way to any page or part of the site. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('chronicle:open-palette', onOpen);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('chronicle:open-palette', onOpen);
    };
  }, []);
  return open ? <Palette onClose={() => setOpen(false)} /> : null;
}

function Palette({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const navigate = useNavigate();
  const isDm = useIsDm();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [pages, setPages] = useState<{ slug: string; title: string; typeLabel: string }[]>([]);
  const [active, setActive] = useState(0);
  const items = useMemo(() => paletteItems(query, COMMANDS, pages, isDm), [query, pages, isDm]);
  const current = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => {
    const d = dialog.current!;
    if (!d.open) d.showModal();
    input.current?.focus();
    const back = opener.current;
    return () => {
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, []);

  // Page suggestions, debounced; an answer for an older query never replaces a newer one.
  useEffect(() => {
    const q = query.trim();
    let live = true;
    const t = window.setTimeout(() => {
      if (q.length < 2) {
        setPages([]);
        return;
      }
      suggest(q)
        .then((rows) => { if (live) setPages(rows.map((r) => ({ slug: r.slug, title: r.title, typeLabel: TEMPLATES[r.type]?.label ?? 'Page' }))); })
        .catch(() => { if (live) setPages([]); });
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [query]);

  const go = (to: string) => {
    opener.current = null; // the new page keeps the focus
    onClose();
    navigate(to);
  };

  return (
    <dialog ref={dialog} className="palette" aria-label="Jump to" onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
      <div className="palette-box">
        <input
          ref={input}
          className="palette-input"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-activedescendant={items[current] ? `${listId}-${current}` : undefined}
          aria-autocomplete="list"
          aria-label="Jump to a page or part of the site"
          placeholder="Jump to a page or part of the site…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === 'Home' && items.length) { e.preventDefault(); setActive(0); }
            else if (e.key === 'End' && items.length) { e.preventDefault(); setActive(items.length - 1); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              if (items[current]) go(items[current].to);
              else if (query.trim()) go(`/search?q=${encodeURIComponent(query.trim())}`);
            }
          }}
        />
        <ul id={listId} role="listbox" className="palette-list" aria-label="Results">
          {items.map((it, i) => (
            <li
              key={it.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              className={i === current ? 'palette-item active' : 'palette-item'}
              onMouseMove={() => setActive(i)}
              onClick={() => go(it.to)}
            >
              <span className="palette-label">{it.label}</span>
              <span className="palette-hint">{it.hint}</span>
            </li>
          ))}
          {items.length === 0 && query.trim() && <li className="palette-empty" role="presentation">Press Enter to search for “{query.trim()}”.</li>}
        </ul>
        <p className="palette-keys fine-print" aria-hidden="true">↑ ↓ to choose · Enter to open · Esc to close</p>
      </div>
    </dialog>
  );
}
