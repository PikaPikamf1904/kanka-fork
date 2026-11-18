import { useMemo } from 'react';
import { Link } from 'react-router';
import { listMembers } from '../../lib/api.ts';
import { buildInsights, type InsightEntry, type InsightTheory, type PageInfo } from '../../lib/insights.ts';
import { loadAllJournals } from '../../lib/readerNotes.ts';
import { supabase } from '../../lib/supabase.ts';
import { useLoad } from '../../lib/useLoad.ts';

async function loadInsightData() {
  const [entries, members, theoriesRes] = await Promise.all([
    loadAllJournals(),
    listMembers(),
    supabase.from('board_items').select('id, title, body, theory_status, author_name, updated_at').eq('kind', 'theory'),
  ]);
  const theories = (theoriesRes.error ? [] : theoriesRes.data) as InsightTheory[];
  const ids = [...new Set(entries.flatMap((e) => e.article_ids))];
  const pages: PageInfo[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const r = await supabase.from('articles').select('id, slug, title, type').in('id', ids.slice(i, i + 150));
    if (r.error) throw new Error(r.error.message);
    pages.push(...(r.data as PageInfo[]));
  }
  const players = members.filter((m) => m.role === 'player' && !m.revoked_at);
  return { entries: entries as InsightEntry[], theories, players, pages };
}

const Entry = ({ e }: { e: InsightEntry & { player: string } }) => (
  <li><strong>{e.player}</strong> <span className="muted">· {e.entry_date}</span> — {e.title}</li>
);

/** DM only: what the players are wondering about, from their journals and the board. */
export function PlayerInsights() {
  const data = useLoad(loadInsightData, []);
  const today = new Date().toISOString().slice(0, 10);
  const ins = useMemo(() => (data.data ? buildInsights(data.data.entries, data.data.theories, data.data.players, data.data.pages, today) : null), [data.data, today]);

  return (
    <div className="insights">
      <h1 className="page-title">Player insights</h1>
      <p className="notice">
        Everything here is what players wrote or guessed: their goals, questions, suspicions and theories. None of it is campaign fact.
        Private scratchpads, saved pages, private research and feedback are never included.
      </p>
      <p className="muted">Read the full entries in <Link to="/dm/journals">Player journals</Link> and the board in <Link to="/dm/theories">Party theories</Link>.</p>
      {data.loading && <p className="muted" role="status">Gathering…</p>}
      {data.error && <p className="form-error" role="alert">Could not load: {data.error}</p>}
      {ins && (
        <div className="insights-grid">
          <section className="panel" aria-labelledby="ins-goals"><h2 id="ins-goals">Character goals</h2>
            {ins.byTag.goal.length ? <ul>{ins.byTag.goal.slice(0, 15).map((e) => <Entry key={e.id} e={e} />)}</ul> : <p className="muted">None written yet.</p>}
          </section>
          <section className="panel" aria-labelledby="ins-questions"><h2 id="ins-questions">Unanswered questions</h2>
            {ins.byTag.question.length ? <ul>{ins.byTag.question.slice(0, 15).map((e) => <Entry key={e.id} e={e} />)}</ul> : <p className="muted">None written yet.</p>}
          </section>
          <section className="panel" aria-labelledby="ins-suspicions"><h2 id="ins-suspicions">Suspicions (who players think is behind it)</h2>
            {ins.byTag.suspicion.length ? <ul>{ins.byTag.suspicion.slice(0, 15).map((e) => <Entry key={e.id} e={e} />)}</ul> : <p className="muted">None written yet.</p>}
          </section>
          <section className="panel" aria-labelledby="ins-theories"><h2 id="ins-theories">Theories</h2>
            {ins.byTag.theory.length === 0 && ins.openTheories.length === 0 && <p className="muted">None yet.</p>}
            {ins.byTag.theory.length > 0 && <><h3>In journals</h3><ul>{ins.byTag.theory.slice(0, 10).map((e) => <Entry key={e.id} e={e} />)}</ul></>}
            {ins.openTheories.length > 0 && (
              <><h3>Open on the party board</h3><ul>{ins.openTheories.slice(0, 10).map((t) => <li key={t.id}><strong>{t.author_name || 'A player'}</strong> — {t.title}</li>)}</ul></>
            )}
          </section>
          <section className="panel" aria-labelledby="ins-npcs"><h2 id="ins-npcs">Characters players keep writing about</h2>
            {ins.frequentCharacters.length ? (
              <ul>{ins.frequentCharacters.map((m) => <li key={m.page.id}><Link to={`/wiki/${m.page.slug}`}>{m.page.title}</Link> <span className="muted">· {m.count} entries · {m.players.join(', ')}</span></li>)}</ul>
            ) : <p className="muted">No linked characters yet.</p>}
          </section>
          <section className="panel" aria-labelledby="ins-places"><h2 id="ins-places">Places mentioned recently</h2>
            {ins.recentPlaces.length ? (
              <ul>{ins.recentPlaces.map((m) => <li key={m.page.id}><Link to={`/wiki/${m.page.slug}`}>{m.page.title}</Link> <span className="muted">· last {m.lastDate} · {m.players.join(', ')}</span></li>)}</ul>
            ) : <p className="muted">No linked places yet.</p>}
          </section>
          <section className="panel" aria-labelledby="ins-threads"><h2 id="ins-threads">Most-discussed pages (open threads)</h2>
            {ins.mentionedPages.length ? (
              <ul>{ins.mentionedPages.slice(0, 10).map((m) => <li key={m.page.id}><Link to={`/wiki/${m.page.slug}`}>{m.page.title}</Link> <span className="muted">· {m.count} entries</span></li>)}</ul>
            ) : <p className="muted">Nothing yet.</p>}
          </section>
          <section className="panel" aria-labelledby="ins-activity"><h2 id="ins-activity">Journal activity</h2>
            <table className="table">
              <thead><tr><th>Player</th><th>Entries</th><th>Last 30 days</th><th>Latest</th></tr></thead>
              <tbody>{ins.activity.map((a) => <tr key={a.player}><td>{a.player}</td><td>{a.entries}</td><td>{a.last30}</td><td>{a.last ?? '—'}</td></tr>)}</tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
