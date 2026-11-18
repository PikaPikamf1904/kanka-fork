import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Markdown } from '../components/Markdown.tsx';
import { articlesBySlugs, suggest } from '../lib/api.ts';
import { ChronicleError } from '../lib/changeSetTypes.ts';
import { dayLabel, filterEntries, groupByMonth, JOURNAL_TAGS, localDate, tagLabel, type JournalEntry } from '../lib/characterJournal.ts';
import { deleteJournalEntry, loadMyJournal, noteErrorMessage, resolvePages, saveJournalEntry, type PageRef } from '../lib/readerNotes.ts';
import { useSession } from '../lib/session.tsx';
import { TEMPLATES } from '../lib/templates.ts';
import type { ArticleRef } from '../lib/types.ts';
import { useLoad } from '../lib/useLoad.ts';
import { useUnsavedGuard } from '../lib/useUnsavedGuard.ts';

const CONFLICT = 'This entry was changed on another device. Copy your text, reload, and try again.';

/** Linked pages as chips. Pages that no longer come back (hidden or removed) are left out. */
export function LinkedPages({ ids, pages }: { ids: string[]; pages: Map<string, PageRef> }) {
  const shown = ids.flatMap((id) => (pages.has(id) ? [pages.get(id)!] : []));
  if (shown.length === 0) return null;
  return (
    <p className="chip-cloud journal-links" aria-label="Linked pages">
      {shown.map((p) => <Link key={p.id} to={`/wiki/${p.slug}`} className="chip">{p.title}</Link>)}
    </p>
  );
}

export function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="journal-tags">
      {tags.map((t) => <span key={t} className="badge">{tagLabel(t)}</span>)}
    </span>
  );
}

/** Your journal: entries in date order, with search, tags, and links to pages. */
export function JournalPage() {
  const { state } = useSession();
  const userId = state.kind === 'member' ? state.userId : '';
  const data = useLoad(async () => {
    const entries = await loadMyJournal(userId);
    const pages = await resolvePages(entries.flatMap((e) => e.article_ids));
    return { entries, pages };
  }, [userId]);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [editing, setEditing] = useState<JournalEntry | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => groupByMonth(filterEntries(data.data?.entries ?? [], query, tag)), [data.data, query, tag]);
  const total = data.data?.entries.length ?? 0;

  async function remove(entry: JournalEntry) {
    if (!window.confirm(`Delete the entry “${entry.title}”? This cannot be undone.`)) return;
    setError(null);
    try {
      await deleteJournalEntry(entry.id);
      data.reload();
    } catch (e) {
      setError(noteErrorMessage(e));
    }
  }

  return (
    <div className="journal-page">
      <h1 className="page-title">Your journal</h1>
      <p className="muted">Write down your theories, goals, suspicions and questions as the story goes on, and link the pages they are about.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {data.error && (
        <div className="notice" role="alert">
          <p>Could not load your journal: {data.error}</p>
          <button type="button" className="button secondary small" onClick={data.reload}>Try again</button>
        </div>
      )}

      {editing ? (
        <EntryEditor
          key={editing === 'new' ? 'new' : editing.id}
          entry={editing === 'new' ? null : editing}
          pages={data.data?.pages ?? new Map()}
          onDone={(saved) => { setEditing(null); if (saved) data.reload(); }}
        />
      ) : (
        <p><button type="button" className="button" onClick={() => setEditing('new')}>New entry</button></p>
      )}

      {data.loading && !data.data && <p className="muted" role="status">Opening your journal…</p>}
      {data.data && total === 0 && !editing && (
        <p className="panel">Your journal is empty. Choose <strong>New entry</strong> to write the first one: a theory about the harbourmaster, a goal for the next session, a question you want answered.</p>
      )}

      {total > 0 && (
        <div className="journal-filters">
          <label htmlFor="journal-search">Search your journal</label>
          <input id="journal-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A word from the title or text" />
          <p className="chip-cloud" role="group" aria-label="Filter by tag">
            <button type="button" className={tag ? 'chip' : 'chip chip-on'} aria-pressed={!tag} onClick={() => setTag(null)}>All entries</button>
            {JOURNAL_TAGS.map((t) => (
              <button key={t.value} type="button" className={tag === t.value ? 'chip chip-on' : 'chip'} aria-pressed={tag === t.value} onClick={() => setTag(tag === t.value ? null : t.value)}>{t.label}</button>
            ))}
          </p>
        </div>
      )}
      {total > 0 && groups.length === 0 && <p className="panel">No entries match.</p>}

      {groups.map((g) => (
        <section key={g.key} className="journal-month" aria-labelledby={`month-${g.key}`}>
          <h2 id={`month-${g.key}`}>{g.label}</h2>
          <ol className="journal-timeline">
            {g.entries.map((e) => (
              <li key={e.id} className="journal-entry" data-testid="journal-entry">
                <p className="journal-date">{dayLabel(e.entry_date)} <TagChips tags={e.tags} /></p>
                <h3>{e.title}</h3>
                {e.body && <Markdown text={e.body} />}
                <LinkedPages ids={e.article_ids} pages={data.data!.pages} />
                <div className="button-row">
                  <button type="button" className="button secondary small" aria-label={`Edit ${e.title}`} onClick={() => setEditing(e)}>Edit</button>
                  <button type="button" className="button danger small" aria-label={`Delete ${e.title}`} onClick={() => void remove(e)}>Delete</button>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function EntryEditor({ entry, pages, onDone }: { entry: JournalEntry | null; pages: Map<string, PageRef>; onDone: (saved: boolean) => void }) {
  const uid = useId();
  const initial = useMemo(() => ({
    title: entry?.title ?? '',
    body: entry?.body ?? '',
    date: entry?.entry_date ?? localDate(),
    tags: entry?.tags ?? [],
    // Links to pages that no longer come back are dropped when the entry is saved.
    links: (entry?.article_ids ?? []).flatMap((id) => (pages.has(id) ? [pages.get(id)!] : [])),
  }), [entry, pages]);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [date, setDate] = useState(initial.date);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [links, setLinks] = useState<PageRef[]>(initial.links);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<ArticleRef[]>([]);

  const dirty = !saved && (title !== initial.title || body !== initial.body || date !== initial.date
    || tags.join() !== initial.tags.join() || links.map((l) => l.id).join() !== initial.links.map((l) => l.id).join());
  useUnsavedGuard(dirty && !busy);

  useEffect(() => {
    const text = q.trim();
    let live = true;
    const t = window.setTimeout(() => {
      if (text.length < 2) { setFound([]); return; }
      suggest(text).then((r) => { if (live) setFound(r); }, () => { if (live) setFound([]); });
    }, 200);
    return () => { live = false; window.clearTimeout(t); };
  }, [q]);

  async function link(ref: ArticleRef) {
    setError(null);
    try {
      const [page] = await articlesBySlugs([ref.slug]);
      if (!page) throw new Error('That page could not be found.');
      setLinks((l) => (l.some((x) => x.id === page.id) || l.length >= 50 ? l : [...l, { id: page.id, slug: page.slug, title: page.title, type: page.type }]));
      setQ('');
      setFound([]);
    } catch (e) {
      setError(noteErrorMessage(e));
    }
  }

  async function save() {
    if (!title.trim()) { setError('Give the entry a title.'); return; }
    setBusy(true);
    setError(null);
    try {
      await saveJournalEntry({ id: entry?.id ?? null, title: title.trim(), body, entry_date: date || localDate(), tags, article_ids: links.map((l) => l.id), version: entry?.version ?? null });
      setSaved(true);
      onDone(true);
    } catch (e) {
      setError(e instanceof ChronicleError && e.code === 'CONFLICT' ? CONFLICT : noteErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <form className="panel journal-editor" onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label={entry ? 'Edit entry' : 'New entry'}>
      <h2>{entry ? 'Edit entry' : 'New entry'}</h2>
      <div className="journal-editor-row">
        <div className="field">
          <label htmlFor={`${uid}-title`}>Title</label>
          <input id={`${uid}-title`} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-date`}>Date</label>
          <input id={`${uid}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-body`}>Entry</label>
        <textarea id={`${uid}-body`} rows={8} value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} aria-describedby={`${uid}-md`} />
        <p id={`${uid}-md`} className="fine-print">You can use Markdown: **bold**, *italic*, lists and [[Page name]] links.</p>
      </div>
      <p className="chip-cloud" role="group" aria-label="Tags">
        {JOURNAL_TAGS.map((t) => {
          const on = tags.includes(t.value);
          return <button key={t.value} type="button" className={on ? 'chip chip-on' : 'chip'} aria-pressed={on} onClick={() => setTags(on ? tags.filter((x) => x !== t.value) : [...tags, t.value])}>{t.label}</button>;
        })}
      </p>
      <div className="field">
        <label htmlFor={`${uid}-link`}>Link a page</label>
        <input id={`${uid}-link`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing a page name" autoComplete="off" />
        {found.length > 0 && (
          <ul className="plain-list journal-suggestions" aria-label="Matching pages">
            {found.map((f) => (
              <li key={f.slug}><button type="button" className="button secondary small" onClick={() => void link(f)}>Link {f.title} <span className="muted">({TEMPLATES[f.type].label})</span></button></li>
            ))}
          </ul>
        )}
        {links.length > 0 && (
          <p className="chip-cloud" aria-label="Linked pages">
            {links.map((l) => (
              <span key={l.id} className="chip chip-on">{l.title} <button type="button" className="link-button" aria-label={`Unlink ${l.title}`} onClick={() => setLinks(links.filter((x) => x.id !== l.id))}>×</button></span>
            ))}
          </p>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="button-row">
        <button type="submit" className="button" disabled={busy}>{busy ? 'Saving…' : 'Save entry'}</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => onDone(false)}>Cancel</button>
        {dirty && <span className="muted" role="status">Unsaved changes</span>}
      </div>
    </form>
  );
}
