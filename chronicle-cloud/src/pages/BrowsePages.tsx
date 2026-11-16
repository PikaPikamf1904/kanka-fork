import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArticleCard } from '../components/ArticleCard.tsx';
import { categoryCounts, getCategory, listArticles, listCharacterFacts, listRelations, search, timeline } from '../lib/api.ts';
import { useIsDm } from '../lib/session.tsx';
import { relationLabel, TEMPLATES, TYPE_ORDER } from '../lib/templates.ts';
import type { ArticleType } from '../lib/types.ts';
import { useLoad } from '../lib/useLoad.ts';
import { Markdown } from '../components/Markdown.tsx';
import { StatusBadge, VisibilityBadge } from '../components/Badges.tsx';
import { NotFound } from './NotFound.tsx';

export function BrowsePage() {
  const { type = '' } = useParams();
  const isDm = useIsDm();
  const valid = (TYPE_ORDER as string[]).includes(type);
  const list = useLoad(() => (valid ? listArticles({ type: type as ArticleType, order: type === 'session' ? 'session' : 'title', limit: 500 }) : Promise.resolve([])), [type, isDm]);
  const [filter, setFilter] = useState('');
  const characterIds = type === 'character' ? (list.data ?? []).map((a) => a.id) : [];
  const facts = useLoad(() => listCharacterFacts(characterIds), [characterIds.join(',')]);
  const [characterCategory, setCharacterCategory] = useState<'all' | 'party' | 'others'>('all');
  if (!valid) return <NotFound />;
  const t = TEMPLATES[type as ArticleType];
  const isCharacter = type === 'character';
  const matching = (list.data ?? []).filter((a) => a.title.toLowerCase().includes(filter.toLowerCase()));
  const shown = isCharacter
    ? matching.filter((a) => characterCategory === 'all' || (characterCategory === 'party' ? a.is_party_member : !a.is_party_member))
    : matching;
  const firstLetter = (name: string) => {
    const first = name.trim().charAt(0).toUpperCase();
    return /^[A-Z]$/.test(first) ? first : '#';
  };
  // Letter headings only earn their space in a long list; a short one is a single grid.
  const byLetter = shown.length >= 12;
  const characterGroups = isCharacter
    ? (byLetter ? [...new Set(shown.map((a) => firstLetter(a.title)))].sort() : ['all']).map((letter) => ({
        letter,
        entries: byLetter ? shown.filter((a) => firstLetter(a.title) === letter) : shown,
      }))
    : [];
  return (
    <div>
      <h1 className="page-title"><span aria-hidden="true">{t.glyph} </span>{t.plural}</h1>
      <div className="toolbar">
        <label className="filter">
          <span className="visually-hidden">Filter {t.plural.toLowerCase()}</span>
          <input type="search" placeholder={`Filter ${t.plural.toLowerCase()}…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        {isDm && <Link className="button" to={`/dm/new?type=${type}`}>New {t.label.toLowerCase()}</Link>}
      </div>
      {list.error && <p className="form-error">{list.error}</p>}
      {list.data && shown.length === 0 && <p className="muted">{(list.data.length > 0) ? `No ${t.plural.toLowerCase()} match those filters.` : 'Nothing here yet.'}</p>}
      {isCharacter ? (
        <div className="character-directory">
          <div className="character-directory-toolbar">
            <div className="character-directory-filters" role="group" aria-label="Character groups">
              {([
                ['all', 'All characters'],
                ['party', 'Party members'],
                ['others', 'Other characters'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={characterCategory === value ? 'character-filter active' : 'character-filter'}
                  aria-pressed={characterCategory === value}
                  onClick={() => setCharacterCategory(value)}
                >{label}</button>
              ))}
            </div>
            <p className="character-directory-count" aria-live="polite">{shown.length} {shown.length === 1 ? 'character' : 'characters'}</p>
          </div>
          {characterGroups.length > 1 && (
            <nav className="character-alphabet" aria-label="Browse characters by first letter">
              {characterGroups.map(({ letter }) => (
                <a key={letter} href={`#character-letter-${letter === '#' ? 'other' : letter.toLowerCase()}`}>{letter}</a>
              ))}
            </nav>
          )}
          {characterGroups.map(({ letter, entries }) => (
            <section className="character-letter-section" key={letter} aria-label={byLetter ? `Characters beginning with ${letter}` : 'Characters'}>
              {byLetter && <h2 id={`character-letter-${letter === '#' ? 'other' : letter.toLowerCase()}`}>{letter}</h2>}
              <div className="character-grid">
                {entries.map((a) => {
                  const f = facts.data?.get(a.id);
                  return <ArticleCard key={a.id} article={a} showState={isDm} portrait meta={[f?.race, f?.class].filter(Boolean).join(' · ')} badge={a.is_party_member ? 'Party' : undefined} />;
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="card-grid">{shown.map((a) => <ArticleCard key={a.id} article={a} showState={isDm} />)}</div>
      )}
    </div>
  );
}

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const results = useLoad(() => (q.trim() ? search(q) : Promise.resolve([])), [q]);
  return (
    <div>
      <h1 className="page-title">Search</h1>
      <p className="muted">Results for “{q}”</p>
      {results.error && <p className="form-error">{results.error}</p>}
      {results.data?.length === 0 && <p>No pages match. Try fewer or different words.</p>}
      <ol className="search-results">
        {results.data?.map((hit) => (
          <li key={hit.article_id}>
            <Link to={`/wiki/${hit.slug}`} className="search-title">{hit.title}</Link>
            <span className="muted"> · {TEMPLATES[hit.type].label}</span>
            {hit.snippet ? <p className="snippet"><Highlighted text={hit.snippet} /></p> : hit.summary && <p className="snippet">{hit.summary}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** ts_headline marks matches with ⟦ ⟧; render them as <mark> without any HTML parsing. */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(⟦[^⟧]*⟧)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('⟦') && p.endsWith('⟧') ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}

export function CategoriesPage() {
  const cats = useLoad(categoryCounts, []);
  const list = cats.data;
  const groups = useMemo(() => {
    const out = { category: [] as NonNullable<typeof list>, tag: [] as NonNullable<typeof list> };
    for (const c of list ?? []) out[c.kind].push(c);
    return out;
  }, [list]);
  return (
    <div>
      <h1 className="page-title">Categories</h1>
      {cats.error && <p className="form-error">{cats.error}</p>}
      <div className="category-columns">
        <section className="panel">
          <h2>Categories</h2>
          <ul className="category-list">
            {groups.category.map((c) => (
              <li key={c.id}><Link to={`/category/${c.slug}`}>{c.name}</Link> <span className="muted">({c.article_count})</span></li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2>Tags</h2>
          <div className="chip-cloud">
            {groups.tag.map((c) => (
              <Link key={c.id} className="chip chip-tag" to={`/category/${c.slug}`}>{c.name} <span className="muted">{c.article_count}</span></Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function CategoryPage() {
  const { slug = '' } = useParams();
  const isDm = useIsDm();
  const data = useLoad(() => getCategory(slug), [slug, isDm]);
  if (data.error) return <p className="form-error">{data.error}</p>;
  if (!data.loading && !data.data) return <NotFound what="category" />;
  const d = data.data;
  return (
    <div>
      <h1 className="page-title">{d?.category.kind === 'tag' ? 'Tag' : 'Category'}: {d?.category.name}</h1>
      {d?.category.description && <Markdown text={d.category.description} />}
      <div className="card-grid">{d?.articles.map((a) => <ArticleCard key={a.id} article={a} showState={isDm} />)}</div>
    </div>
  );
}

export function TimelinePage() {
  const isDm = useIsDm();
  const events = useLoad(timeline, [isDm]);
  return (
    <div>
      <div className="toolbar">
        <h1 className="page-title">Timeline</h1>
        {isDm && <Link className="button" to="/dm/timeline">Edit timeline</Link>}
      </div>
      {events.error && <p className="form-error">{events.error}</p>}
      {events.data?.length === 0 && <p className="muted">No events have been recorded yet.</p>}
      <ol className="timeline">
        {events.data?.map((e) => (
          <li key={e.id} className={isDm && (e.visibility === 'dm' || e.status === 'draft') ? 'dm-only' : undefined}>
            <div className="timeline-date">{e.date_label}</div>
            <div className="timeline-card">
              <h2>
                {e.article ? <Link to={`/wiki/${e.article.slug}`}>{e.title}</Link> : e.title}
                {isDm && e.visibility === 'dm' && <VisibilityBadge visibility="dm" />}
                {isDm && e.status === 'draft' && <StatusBadge status="draft" />}
              </h2>
              {e.body && <Markdown text={e.body} />}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ConnectionsPage() {
  const isDm = useIsDm();
  const rels = useLoad(listRelations, [isDm]);
  const [focus, setFocus] = useState('');
  const shown = (rels.data ?? []).filter(
    (r) => !focus || r.source.title.toLowerCase().includes(focus.toLowerCase()) || r.target.title.toLowerCase().includes(focus.toLowerCase()),
  );
  const byKind = new Map<string, typeof shown>();
  for (const r of shown) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  return (
    <div>
      <h1 className="page-title">Connections</h1>
      <p className="muted">Who knows whom, who serves whom, and where everyone lives, as far as the party knows.</p>
      <label className="filter">
        <span className="visually-hidden">Filter by name</span>
        <input type="search" placeholder="Filter by name…" value={focus} onChange={(e) => setFocus(e.target.value)} />
      </label>
      {rels.error && <p className="form-error">{rels.error}</p>}
      {[...byKind.entries()].map(([kind, list]) => (
        <section key={kind} className="panel">
          <h2>{relationLabel(kind)}</h2>
          <ul className="relation-list">
            {list.map((r) => (
              <li key={r.id}>
                <Link to={`/wiki/${r.source.slug}`}>{r.source.title}</Link>
                <span className="relation-arrow" aria-hidden="true"> → </span>
                <span className="visually-hidden"> {relationLabel(kind)} </span>
                <Link to={`/wiki/${r.target.slug}`}>{r.target.title}</Link>
                {r.label && <span className="muted"> ({r.label})</span>}
                {isDm && r.visibility === 'dm' && <VisibilityBadge visibility="dm" />}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {rels.data && shown.length === 0 && <p className="muted">No connections found.</p>}
    </div>
  );
}
