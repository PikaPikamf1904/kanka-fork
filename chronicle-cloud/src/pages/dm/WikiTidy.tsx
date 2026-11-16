import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { StatusBadge, VisibilityBadge } from '../../components/Badges.tsx';
import { loadWikiTidyData } from '../../lib/api.ts';
import { computeWikiTidy, onlyPlayerVisible, tidyTotal, titleFromSlug, type TidyPage } from '../../lib/wikiTidy.ts';
import { useLoad } from '../../lib/useLoad.ts';

function PageLinks({ page }: { page: TidyPage }) {
  return (
    <>
      <Link to={`/wiki/${page.slug}`}>{page.title}</Link>
      <span className="badges-row">
        <VisibilityBadge visibility={page.visibility} />
        <StatusBadge status={page.status} />
      </span>
    </>
  );
}

function Section({ id, title, hint, count, children }: { id: string; title: string; hint: string; count: number; children: React.ReactNode }) {
  return (
    <details className="panel tidy-section" data-testid={`tidy-${id}`}>
      <summary>
        <span className="tidy-title">{title}</span>
        <span className="badge badge-ok tidy-count" aria-label={`${count} found`}>{count}</span>
      </summary>
      <p className="fine-print">{hint}</p>
      {count === 0 ? <p className="muted">Nothing to tidy.</p> : <ul className="tidy-list">{children}</ul>}
    </details>
  );
}

function PlainRows({ pages }: { pages: TidyPage[] }) {
  return (
    <>
      {pages.map((p) => (
        <li key={p.id}>
          <PageLinks page={p} />
          <Link className="button secondary small" to={`/dm/edit/${p.slug}`} aria-label={`Edit ${p.title}`}>Edit</Link>
        </li>
      ))}
    </>
  );
}

export function WikiTidy() {
  const data = useLoad(loadWikiTidyData, []);
  const [playersOnly, setPlayersOnly] = useState(false);
  const report = useMemo(() => {
    if (!data.data) return null;
    const full = computeWikiTidy(data.data);
    return playersOnly ? onlyPlayerVisible(full) : full;
  }, [data.data, playersOnly]);

  return (
    <div>
      <h1 className="page-title">Tidy up the wiki</h1>
      <p className="muted">Suggestions only: nothing here is changed for you. News stories are not checked.</p>
      <div className="chip-cloud">
        <button type="button" className={playersOnly ? 'chip chip-on tidy-filter' : 'chip tidy-filter'} aria-pressed={playersOnly} onClick={() => setPlayersOnly((v) => !v)}>
          Only pages players can see
        </button>
      </div>
      {data.loading && <p className="muted" role="status">Checking the wiki…</p>}
      {data.error && (
        <div className="notice" role="alert">
          <p>Could not check the wiki: {data.error}</p>
          <button type="button" className="button secondary small" onClick={data.reload}>Try again</button>
        </div>
      )}
      {report && (
        <>
          {tidyTotal(report) === 0 && <p className="panel" data-testid="tidy-all-clear">Nothing to tidy{playersOnly ? ' on pages players can see' : ''}.</p>}
          <Section id="broken" title="Broken links" count={report.brokenLinks.length} hint="Links to a page that does not exist and has no redirect.">
            {report.brokenLinks.map((b) => (
              <li key={`${b.page.id}|${b.target}`}>
                <span className="tidy-main">
                  <Link to={`/wiki/${b.page.slug}`}>{b.page.title}</Link> → <code>[[{b.target}]]</code>
                </span>
                <span className="badges-row">
                  <VisibilityBadge visibility={b.page.visibility} />
                  <StatusBadge status={b.page.status} />
                </span>
                <Link className="button secondary small" to={`/dm/edit/${b.page.slug}`} aria-label={`Edit ${b.page.title}`}>Edit</Link>
                <Link className="button small" to={`/dm/new?slug=${encodeURIComponent(b.target)}&title=${encodeURIComponent(titleFromSlug(b.target))}`}>Create this page</Link>
              </li>
            ))}
          </Section>
          <Section id="orphans" title="Pages nothing links to" count={report.orphans.length} hint="No other page links here (directly or through a redirect) and the page has no connections. Session journals are not counted.">
            <PlainRows pages={report.orphans} />
          </Section>
          <Section id="summary" title="Missing summary" count={report.missingSummary.length} hint="The summary is empty, so cards and search results show nothing.">
            <PlainRows pages={report.missingSummary} />
          </Section>
          <Section id="picture" title="Missing picture" count={report.missingPicture.length} hint="Characters, locations and factions without a main picture.">
            <PlainRows pages={report.missingPicture} />
          </Section>
          <Section id="empty" title="Empty pages" count={report.emptyPages.length} hint="No section has any text.">
            <PlainRows pages={report.emptyPages} />
          </Section>
        </>
      )}
    </div>
  );
}
