import { useMemo, useState } from 'react';
import { Markdown } from '../../components/Markdown.tsx';
import { dayLabel, filterEntries, JOURNAL_TAGS, sortEntries, type JournalEntry } from '../../lib/characterJournal.ts';
import { loadAllJournals, memberNames, resolvePages } from '../../lib/readerNotes.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { LinkedPages, TagChips } from '../JournalPage.tsx';

/** The DM's read-only view of every player's journal entries. Nothing here can change an entry. */
export function PlayerJournals() {
  const data = useLoad(async () => {
    const [entries, names] = await Promise.all([loadAllJournals(), memberNames()]);
    const pages = await resolvePages(entries.flatMap((e) => e.article_ids));
    return { entries, names, pages };
  }, []);
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const people = useMemo(() => {
    if (!data.data) return [];
    const byUser = new Map<string, JournalEntry[]>();
    for (const e of filterEntries(data.data.entries, query, tag)) byUser.set(e.user_id, [...(byUser.get(e.user_id) ?? []), e]);
    return [...byUser.entries()]
      .map(([userId, entries]) => ({ userId, name: data.data!.names.get(userId) ?? 'Former player', entries: sortEntries(entries) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data.data, tag, query]);

  return (
    <div className="journal-page">
      <h1 className="page-title">Player journals</h1>
      <p className="muted">Entries your players have written, newest first. This page is read-only.</p>
      {data.loading && !data.data && <p className="muted" role="status">Opening the journals…</p>}
      {data.error && (
        <div className="notice" role="alert">
          <p>Could not load the journals: {data.error}</p>
          <button type="button" className="button secondary small" onClick={data.reload}>Try again</button>
        </div>
      )}
      {data.data && data.data.entries.length === 0 && <p className="panel">No journal entries yet.</p>}
      {data.data && data.data.entries.length > 0 && (
        <div className="journal-filters">
          <label htmlFor="dm-journal-search">Search the journals</label>
          <input id="dm-journal-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A word from the title or text" />
          <p className="chip-cloud" role="group" aria-label="Filter by tag">
            <button type="button" className={tag ? 'chip' : 'chip chip-on'} aria-pressed={!tag} onClick={() => setTag(null)}>All entries</button>
            {JOURNAL_TAGS.map((t) => (
              <button key={t.value} type="button" className={tag === t.value ? 'chip chip-on' : 'chip'} aria-pressed={tag === t.value} onClick={() => setTag(tag === t.value ? null : t.value)}>{t.label}</button>
            ))}
          </p>
        </div>
      )}
      {data.data && data.data.entries.length > 0 && people.length === 0 && <p className="panel">No entries match.</p>}
      {people.map((p) => (
        <section key={p.userId} className="panel journal-player" aria-labelledby={`player-${p.userId}`}>
          <h2 id={`player-${p.userId}`}>{p.name} <span className="muted">({p.entries.length})</span></h2>
          <ol className="journal-timeline">
            {p.entries.map((e) => (
              <li key={e.id} className="journal-entry" data-testid="player-journal-entry">
                <p className="journal-date">{dayLabel(e.entry_date)} <TagChips tags={e.tags} /></p>
                <h3>{e.title}</h3>
                {e.body && <Markdown text={e.body} />}
                <LinkedPages ids={e.article_ids} pages={data.data!.pages} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
