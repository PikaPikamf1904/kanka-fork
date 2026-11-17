import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Markdown } from '../components/Markdown.tsx';
import { suggest } from '../lib/api.ts';
import {
  addSource, addSummary, createCollection, deleteCollection, deleteSummary, getCollection, listCollections, loadSources, loadSummaries,
  relatedPages, removeSource, saveSummary, updateCollection, updateSource,
} from '../lib/research.ts';
import { byTopic, citedNumbers, collectionMarkdown, numberSources, searchCollection, sourceList, UNAVAILABLE, type ResearchSummary } from '../lib/researchExport.ts';
import { useSession } from '../lib/session.tsx';
import { TEMPLATES } from '../lib/templates.ts';
import type { ArticleRef } from '../lib/types.ts';
import { useLoad } from '../lib/useLoad.ts';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** /studio: the reader's research collections, and those other players shared with the party. */
export function StudioIndex() {
  const { state } = useSession();
  const me = state.kind === 'member' ? state.userId : '';
  const list = useLoad(listCollections, []);
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (list.data === null) return <div><h1 className="page-title">Knowledge Studio</h1><p className="muted">Knowledge Studio is not available on this site yet.</p></div>;
  const mine = (list.data ?? []).filter((c) => c.user_id === me);
  const shared = (list.data ?? []).filter((c) => c.user_id !== me);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const id = await createCollection(title, '');
      navigate(`/studio/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create it.');
    }
  }

  return (
    <div>
      <h1 className="page-title">Knowledge Studio</h1>
      <p className="muted">
        Gather pages into research collections, note what matters, quote passages and write summaries that cite their sources.
        Collections are yours alone unless you choose to share one with the party. Only pages you can read can be added.
      </p>
      <form className="panel studio-new" onSubmit={create}>
        <label>New collection<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="e.g. Who funds the cult?" /></label>
        <button type="submit" className="button small">Create</button>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
      {list.loading && <p className="muted" role="status">Loading…</p>}
      <section aria-labelledby="studio-mine">
        <h2 id="studio-mine">Your collections</h2>
        {mine.length === 0 ? <p className="muted">None yet. Start one above, then add pages to it.</p> : (
          <ul className="card-list studio-list">
            {mine.map((c) => (
              <li key={c.id} className="panel">
                <Link to={`/studio/${c.id}`}><strong>{c.title}</strong></Link>
                {c.shared && <span className="badge">Shared with the party</span>}
                {c.description && <p className="muted">{c.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {shared.length > 0 && (
        <section aria-labelledby="studio-shared">
          <h2 id="studio-shared">Shared by other players</h2>
          <ul className="card-list studio-list">
            {shared.map((c) => <li key={c.id} className="panel"><Link to={`/studio/${c.id}`}><strong>{c.title}</strong></Link>{c.description && <p className="muted">{c.description}</p>}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

function AddPage({ onAdd }: { onAdd: (slug: string) => Promise<void> }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ArticleRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="studio-add">
      <label>Add a page
        <input type="search" value={q} placeholder="Type a page name…" onChange={async (e) => {
          const v = e.target.value;
          setQ(v);
          setHits(v.trim().length >= 2 ? await suggest(v.trim()).catch(() => []) : []);
        }} />
      </label>
      {hits.length > 0 && (
        <ul className="studio-hits" aria-label="Matching pages">
          {hits.map((h) => (
            <li key={h.slug}>
              <button type="button" className="link-button" onClick={async () => {
                setError(null);
                try {
                  await onAdd(h.slug);
                  setQ('');
                  setHits([]);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not add it.');
                }
              }}>Add {h.title} <span className="muted">({TEMPLATES[h.type]?.label ?? 'Page'})</span></button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

function SummaryEditor({ s, editable, onChanged }: { s: ResearchSummary; editable: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(s.title);
  const [body, setBody] = useState(s.body);
  const [msg, setMsg] = useState<string | null>(null);
  if (!editing) {
    return (
      <article className="panel studio-summary" data-testid="studio-summary">
        <h3>{s.title}</h3>
        {s.body ? <Markdown text={s.body} /> : <p className="muted">Empty so far.</p>}
        {citedNumbers(s.body).length > 0 && <p className="fine-print">Cites sources {citedNumbers(s.body).join(', ')}.</p>}
        {editable && (
          <p className="badges-row">
            <button type="button" className="button secondary small" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" className="link-button" onClick={() => { if (window.confirm('Delete this summary?')) void deleteSummary(s.id).then(onChanged); }}>Delete</button>
          </p>
        )}
      </article>
    );
  }
  return (
    <form className="panel studio-summary" onSubmit={async (e) => {
      e.preventDefault();
      const ok = await saveSummary(s, { title, body });
      if (!ok) {
        setMsg('This summary was changed on another device. Copy your text, reload, and try again.');
        return;
      }
      setEditing(false);
      onChanged();
    }}>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required /></label>
      <label>Summary (cite sources by number, like [1] or [2, 3])<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} maxLength={10000} /></label>
      {msg && <p className="form-error" role="alert">{msg}</p>}
      <p className="badges-row"><button type="submit" className="button small">Save</button><button type="button" className="link-button" onClick={() => setEditing(false)}>Cancel</button></p>
    </form>
  );
}

/** /studio/:id — one collection. */
export function StudioCollection() {
  const { id = '' } = useParams();
  const { state } = useSession();
  const me = state.kind === 'member' ? state.userId : '';
  const isDm = state.kind === 'member' && state.role === 'dm';
  const coll = useLoad(() => getCollection(id), [id]);
  const sources = useLoad(() => loadSources(id), [id]);
  const summaries = useLoad(() => loadSummaries(id), [id]);
  const numbered = useMemo(() => numberSources(sources.data ?? []), [sources.data]);
  const related = useLoad(() => relatedPages(numbered.filter((s) => s.page).map((s) => s.article_id)), [numbered]);
  const [q, setQ] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState<boolean | null>(null);
  const navigate = useNavigate();

  if (coll.loading) return <p className="muted" role="status">Loading…</p>;
  const c = coll.data;
  if (!c) return <div><h1 className="page-title">Collection not found</h1><p><Link to="/studio">Back to Knowledge Studio</Link></p></div>;
  const owner = c.user_id === me;
  const found = searchCollection(numbered, summaries.data ?? [], q);
  const reloadAll = () => { sources.reload(); summaries.reload(); };
  const origin = window.location.origin;

  return (
    <div className="studio">
      <p className="breadcrumbs"><Link to="/studio">Knowledge Studio</Link> ›</p>
      <h1 className="page-title">{c.title}</h1>
      {!owner && <p className="badge">Shared with the party · read-only</p>}
      {owner ? (
        <details className="panel">
          <summary>About this collection</summary>
          <form className="form-grid" onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void updateCollection(c.id, { title: String(f.get('title')), description: String(f.get('description')) }).then(coll.reload);
          }}>
            <label>Title<input name="title" defaultValue={c.title} maxLength={120} required /></label>
            <label>Description<textarea name="description" defaultValue={c.description} maxLength={2000} rows={3} /></label>
            <button type="submit" className="button small">Save</button>
          </form>
          <label className="checkbox">
            <input type="checkbox" checked={shared ?? c.shared} disabled={isDm} onChange={(e) => {
              const next = e.target.checked;
              setShared(next);
              void updateCollection(c.id, { shared: next }).then(coll.reload, () => setShared(null));
            }} />
            Share with the party (read-only for everyone else)
          </label>
          {isDm && <p className="fine-print">Your research stays private: you can read hidden pages, so sharing goes through the wiki or the board instead.</p>}
          <button type="button" className="link-button" onClick={() => { if (window.confirm('Delete this collection? The pages themselves are not affected.')) void deleteCollection(c.id).then(() => navigate('/studio')); }}>Delete collection</button>
        </details>
      ) : c.description && <p className="muted">{c.description}</p>}

      <div className="studio-tools">
        <label className="studio-search">Search this collection<input type="search" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <button type="button" className="button secondary small" onClick={async () => {
          try {
            await navigator.clipboard.writeText(sourceList(numbered, origin));
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}>{copied ? 'Source list copied' : 'Copy source list'}</button>
        <button type="button" className="button secondary small" onClick={() =>
          download(`${c.title.replace(/[^\w -]+/g, '').trim() || 'collection'}.md`,
            collectionMarkdown(c, numbered, summaries.data ?? [], origin, new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })))}>
          Export (Markdown)
        </button>
      </div>

      <section aria-labelledby="studio-sources">
        <h2 id="studio-sources">Sources ({numbered.length})</h2>
        {owner && <AddPage onAdd={async (slug) => { await addSource(c.id, slug, numbered.length + 1); sources.reload(); }} />}
        {numbered.length === 0 && <p className="muted">No sources yet.{owner ? ' Add pages you want to study together.' : ''}</p>}
        {byTopic(found.sources).map((g) => (
          <div key={g.topic || '—'} className="studio-topic">
            <h3>{g.topic || 'No topic'}</h3>
            <ol className="studio-sources">
              {g.sources.map((s) => (
                <li key={s.id} value={s.n} className="panel" data-testid="studio-source">
                  <p className="studio-source-title">
                    <span className="badge">[{s.n}]</span>{' '}
                    {s.page ? <Link to={`/wiki/${s.page.slug}`}>{s.page.title}</Link> : <span className="muted">{UNAVAILABLE}</span>}
                  </p>
                  {s.page && s.excerpt && <blockquote className="studio-excerpt">{s.excerpt}<footer>From <Link to={`/wiki/${s.page.slug}`}>{s.page.title}</Link></footer></blockquote>}
                  {s.annotation && <p className="studio-note">{s.annotation}</p>}
                  {owner && (
                    <details>
                      <summary>Topic, quote and note</summary>
                      <form className="form-grid" onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void updateSource(s.id, { topic: String(f.get('topic')), excerpt: String(f.get('excerpt')), annotation: String(f.get('annotation')) }).then(sources.reload);
                      }}>
                        <label>Topic<input name="topic" defaultValue={s.topic} maxLength={60} /></label>
                        <label>Quote from the page<textarea name="excerpt" defaultValue={s.excerpt} maxLength={4000} rows={3} /></label>
                        <label>Your note<textarea name="annotation" defaultValue={s.annotation} maxLength={4000} rows={3} /></label>
                        <button type="submit" className="button small">Save</button>
                      </form>
                      <button type="button" className="link-button" onClick={() => void removeSource(s.id).then(sources.reload)}>Remove from collection</button>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>

      <section aria-labelledby="studio-summaries">
        <h2 id="studio-summaries">Research summaries</h2>
        {found.summaries.map((s) => <SummaryEditor key={`${s.id}-${s.version}`} s={s} editable={owner} onChanged={reloadAll} />)}
        {owner && (
          <form className="studio-new" onSubmit={(e) => { e.preventDefault(); void addSummary(c.id, newSummary).then(() => { setNewSummary(''); summaries.reload(); }); }}>
            <label>New summary<input value={newSummary} onChange={(e) => setNewSummary(e.target.value)} maxLength={120} required placeholder="e.g. What we know so far" /></label>
            <button type="submit" className="button small">Add</button>
          </form>
        )}
      </section>

      {(related.data?.length ?? 0) > 0 && (
        <section aria-labelledby="studio-related">
          <h2 id="studio-related">Related pages</h2>
          <p className="fine-print">Connected to your sources, and not in this collection yet.</p>
          <ul className="badges-row">
            {related.data!.map((p) => <li key={p.slug}><Link className="chip" to={`/wiki/${p.slug}`}>{p.title}</Link></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
