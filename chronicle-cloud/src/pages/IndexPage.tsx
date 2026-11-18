import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { StatusBadge, VisibilityBadge } from '../components/Badges.tsx';
import { listIndexEntries, listIndexTitles } from '../lib/api.ts';
import { defaultLetter, firstLetter, indexSearch, LETTERS, lettersWithEntries, parseIndexParams, snippet } from '../lib/azIndex.ts';
import { useIsDm } from '../lib/session.tsx';
import { TEMPLATES, TYPE_ORDER } from '../lib/templates.ts';
import { useLoad } from '../lib/useLoad.ts';

/**
 * The A-Z index: every page the reader can see, one letter at a time. The state lives in the address
 * (?letter=B&type=character&q=) so a view can be shared and back/forward work. Letters come from one
 * paged query of titles; a letter's pages are loaded from the server only when it is opened, and
 * typing searches titles on the server. Everything is read under the reader's own access.
 */
export function IndexPage() {
  const isDm = useIsDm();
  const [params, setParams] = useSearchParams();
  const { letter, type, q } = parseIndexParams(params, TYPE_ORDER);
  const [text, setText] = useState(q);

  const titles = useLoad(listIndexTitles, [isDm]);
  const available = useMemo(
    () => lettersWithEntries((titles.data ?? []).filter((t) => !type || t.type === type).map((t) => t.title)),
    [titles.data, type],
  );
  const active = q ? null : letter ?? (titles.data ? defaultLetter(available) : null);

  const entries = useLoad(
    () => (q ? listIndexEntries({ contains: q, type }) : active ? listIndexEntries({ letter: active, type }) : Promise.resolve([])),
    [q, active, type, isDm],
  );

  const go = (next: Partial<{ letter: string | null; type: typeof type; q: string }>, replace = false) => {
    const merged = { letter, type, q, ...next };
    setParams(indexSearch(merged).replace(/^\?/, ''), { replace });
  };

  // The box follows the address (back/forward), and writes to it once typing pauses.
  const [seenQ, setSeenQ] = useState(q);
  if (seenQ !== q) {
    setSeenQ(q);
    setText(q);
  }
  useEffect(() => {
    if (text.trim() === q) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (text.trim()) {
        next.set('q', text.trim());
        next.delete('letter');
      } else next.delete('q');
      setParams(next, { replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [text, q, params, setParams]);

  useEffect(() => {
    document.title = 'A–Z index · Chronicle';
  }, []);

  const rows = entries.data ?? [];
  const error = titles.error ?? entries.error;
  return (
    <div className="az-index">
      <h1 className="page-title">A–Z index</h1>
      <div className="az-controls">
        <label className="az-field">
          <span className="az-label">Find by title</span>
          <input type="search" value={text} placeholder="Start typing a title…" onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </label>
        <label className="az-field">
          <span className="az-label">Kind of page</span>
          <select value={type ?? ''} onChange={(e) => go({ type: (e.target.value || null) as typeof type })}>
            <option value="">All kinds</option>
            {TYPE_ORDER.map((t) => <option key={t} value={t}>{TEMPLATES[t].plural}</option>)}
          </select>
        </label>
      </div>
      <nav className="az-bar" aria-label="Alphabet">
        {LETTERS.map((l) => {
          const has = available.has(l);
          return (
            <button
              key={l}
              type="button"
              className={active === l ? 'az-letter az-letter-on' : 'az-letter'}
              disabled={!has}
              aria-pressed={active === l}
              aria-label={l === '#' ? 'Other characters' : l}
              onClick={() => go({ letter: l, q: '' })}
            >
              {l}
            </button>
          );
        })}
      </nav>
      {error && <p className="form-error">{error}</p>}
      {titles.data && titles.data.length === 0 && <p className="muted">There are no pages you can read yet.</p>}
      {titles.data && titles.data.length > 0 && (
        <h2 className="az-heading" aria-live="polite">
          {q ? `Titles containing “${q}”` : active === '#' ? 'Other' : active ?? ''}
          {entries.data && <span className="muted"> · {rows.length}{q && rows.length === 100 ? '+' : ''} {rows.length === 1 ? 'page' : 'pages'}</span>}
        </h2>
      )}
      {entries.data && rows.length === 0 && titles.data && titles.data.length > 0 && (
        <p className="muted">{q ? 'No titles match.' : type ? `No ${TEMPLATES[type].plural.toLowerCase()} under this letter.` : 'Nothing under this letter.'}</p>
      )}
      <ul className="az-list">
        {rows.map((a) => (
          <li key={a.id} className="az-row" data-letter={firstLetter(a.title)}>
            <div className="az-row-head">
              <Link to={`/wiki/${a.slug}`} className="az-title">{a.title}</Link>
              <Link to={`/a-z${indexSearch({ type: a.type })}`} className="az-type" title={`Only ${TEMPLATES[a.type].plural.toLowerCase()}`}>{TEMPLATES[a.type].label}</Link>
              {isDm && a.status !== 'published' && <StatusBadge status={a.status} />}
              {isDm && a.visibility !== 'players' && <VisibilityBadge visibility={a.visibility} />}
            </div>
            {a.summary && <p className="az-snippet">{snippet(a.summary)}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
