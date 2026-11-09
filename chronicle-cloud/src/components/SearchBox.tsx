import { useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { suggest } from '../lib/api.ts';
import { TEMPLATES } from '../lib/templates.ts';
import type { ArticleRef } from '../lib/types.ts';

export function SearchBox({ autoFocus = false, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const [q, setQ] = useState('');
  const [found, setItems] = useState<ArticleRef[]>([]);
  const [active, setActive] = useState(-1);
  const navigate = useNavigate();
  const listId = useId();
  const items = q.trim() ? found : [];

  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) return;
    const timer = setTimeout(() => {
      suggest(term).then(setItems).catch(() => setItems([]));
    }, 150);
    return () => clearTimeout(timer);
  }, [q]);

  function go(path: string) {
    setItems([]);
    setQ('');
    onDone?.();
    navigate(path);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const pick = active >= 0 ? items[active] : undefined;
    if (pick) go(`/wiki/${pick.slug}`);
    else if (q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <form className="searchbox" role="search" onSubmit={submit}>
      <label htmlFor={`${listId}-input`} className="visually-hidden">Search the wiki</label>
      <input
        id={`${listId}-input`}
        type="search"
        placeholder="Search the wiki…"
        value={q}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(-1, a - 1));
          } else if (e.key === 'Escape') {
            setItems([]);
          }
        }}
      />
      <button type="submit" className="searchbox-button" aria-label="Search">⌕</button>
      {items.length > 0 && (
        <ul id={listId} role="listbox" className="suggestions">
          {items.map((item, i) => (
            <li
              key={item.slug}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                go(`/wiki/${item.slug}`);
              }}
            >
              <span className="suggestion-glyph" aria-hidden="true">{TEMPLATES[item.type].glyph}</span>
              {item.title}
              <span className="suggestion-type">{TEMPLATES[item.type].label}</span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
