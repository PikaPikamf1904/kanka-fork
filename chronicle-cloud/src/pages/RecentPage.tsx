import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { loadRecentChanges } from '../lib/api.ts';
import { longDate } from '../lib/dates.ts';
import { groupByDay, recentChanges } from '../lib/recentChanges.ts';
import { useIsDm, useSession } from '../lib/session.tsx';
import { TEMPLATES, TYPE_ORDER } from '../lib/templates.ts';
import type { ArticleType } from '../lib/types.ts';
import { useLoad } from '../lib/useLoad.ts';

/** "Recently updated": pages whose readable text changed or that were published lately. */
export function RecentPage() {
  const { playerPreview } = useSession();
  const isDm = useIsDm();
  const data = useLoad(() => loadRecentChanges(playerPreview), [playerPreview, isDm]);
  const [params, setParams] = useSearchParams();
  const asked = params.get('type');
  const type = (TYPE_ORDER as string[]).includes(asked ?? '') ? (asked as ArticleType) : null;
  const entries = useMemo(() => (data.data ? recentChanges(data.data.pages, data.data.sections, 200) : []), [data.data]);
  const kinds = useMemo(() => TYPE_ORDER.filter((t) => entries.some((e) => e.page.type === t)), [entries]);
  const days = useMemo(
    () => groupByDay(entries.filter((e) => !type || e.page.type === type).slice(0, 50), new Date(), (d) => longDate(d.toISOString())),
    [entries, type],
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
      {kinds.length > 1 && (
        <p className="chip-cloud" role="group" aria-label="Kind of page">
          <button type="button" className={type ? 'chip' : 'chip chip-on'} aria-pressed={!type} onClick={() => setParams({}, { replace: true })}>All</button>
          {kinds.map((t) => (
            <button key={t} type="button" className={type === t ? 'chip chip-on' : 'chip'} aria-pressed={type === t} onClick={() => setParams({ type: t }, { replace: true })}>
              {TEMPLATES[t].plural}
            </button>
          ))}
        </p>
      )}
      {data.data && days.length === 0 && <p className="panel">Nothing has changed recently{type ? ' in this kind of page' : ''}.</p>}
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
