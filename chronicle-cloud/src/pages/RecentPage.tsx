import { useMemo } from 'react';
import { Link } from 'react-router';
import { loadRecentChanges } from '../lib/api.ts';
import { longDate } from '../lib/dates.ts';
import { groupByDay, recentChanges } from '../lib/recentChanges.ts';
import { useIsDm, useSession } from '../lib/session.tsx';
import { TEMPLATES } from '../lib/templates.ts';
import { useLoad } from '../lib/useLoad.ts';

/** "Recently updated": pages whose readable text changed or that were published lately. */
export function RecentPage() {
  const { playerPreview } = useSession();
  const isDm = useIsDm();
  const data = useLoad(() => loadRecentChanges(playerPreview), [playerPreview, isDm]);
  const days = useMemo(
    () => (data.data ? groupByDay(recentChanges(data.data.pages, data.data.sections), new Date(), (d) => longDate(d.toISOString())) : []),
    [data.data],
  );
  return (
    <div className="recent-page">
      <h1 className="page-title">Recently updated</h1>
      <p className="muted">
        {isDm && !playerPreview
          ? 'Everything you changed lately, including DM-only text. Use “View as a player” to see the list players get.'
          : 'Pages that were published or had text added or changed lately. Gazette stories are on the news page.'}
      </p>
      {data.loading && <p className="muted" role="status">Looking for changes…</p>}
      {data.error && (
        <div className="notice" role="alert">
          <p>Could not load recent changes: {data.error}</p>
          <button type="button" className="button secondary small" onClick={data.reload}>Try again</button>
        </div>
      )}
      {data.data && days.length === 0 && <p className="panel">Nothing has changed recently.</p>}
      {days.map((d) => (
        <section key={d.day} className="recent-day" aria-labelledby={`recent-${d.day.replace(/\W+/g, '-')}`}>
          <h2 id={`recent-${d.day.replace(/\W+/g, '-')}`}>{d.day}</h2>
          <ul className="recent-list">
            {d.entries.map((e) => (
              <li key={e.page.id} data-testid="recent-entry">
                <Link to={`/wiki/${e.page.slug}`} className="recent-title">{e.page.title}</Link>
                <span className="badge recent-kind">{TEMPLATES[e.page.type].label}</span>
                <span className={e.isNew ? 'recent-what recent-new' : 'recent-what'}>
                  {e.isNew ? 'New page' : e.headings.length ? `Updated: ${e.headings.join(', ')}` : 'Updated'}
                </span>
                <time className="recent-time" dateTime={e.at}>{new Date(e.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
