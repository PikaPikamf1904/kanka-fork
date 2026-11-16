import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { StatusBadge, VisibilityBadge } from '../../components/Badges.tsx';
import { loadWikiTidyData } from '../../lib/api.ts';
import { TEMPLATES, TYPE_ORDER } from '../../lib/templates.ts';
import type { ArticleType } from '../../lib/types.ts';
import { computeWikiTidy, onlyPlayerVisible, onlyType, sortPages, TIDY_SORTS, tidyTotal, titleFromSlug, type TidyPage, type TidySectionId, type TidySort } from '../../lib/wikiTidy.ts';
import { useLoad } from '../../lib/useLoad.ts';

function PageLinks({ page }: { page: TidyPage }) {
  return (
    <>
      <Link to={`/wiki/${page.slug}`}>{page.title}</Link>
      <span className="badges-row">
        <VisibilityBadge visibility={page.visibility} />
        <StatusBadge status={page.status} />
      </span>
      <NotesLink page={page} />
    </>
  );
}

/** "To do" / "DM notes" marker with a link to the notes on the page's editor. Notes are the DM's existing private notes. */
function NotesLink({ page }: { page: TidyPage }) {
  if (page.notes.count === 0) return null;
  return (
    <Link className={page.notes.todo ? 'tidy-notes tidy-notes-todo' : 'tidy-notes'} to={`/dm/edit/${page.slug}#dm-notes`} aria-label={`${page.notes.todo ? 'To do. ' : ''}${page.notes.count} DM ${page.notes.count === 1 ? 'note' : 'notes'} on ${page.title}`}>
      {page.notes.todo ? 'To do · ' : ''}{page.notes.count} DM {page.notes.count === 1 ? 'note' : 'notes'}
    </Link>
  );
}

function Section({ id, title, hint, count, sort, onSort, children }: { id: TidySectionId; title: string; hint: string; count: number; sort: TidySort; onSort: (s: TidySort) => void; children: React.ReactNode }) {
  return (
    <details className="panel tidy-section" id={`tidy-${id}`} data-testid={`tidy-${id}`}>
      <summary>
        <span className="tidy-title">{title}</span>
        <span className="badge badge-ok tidy-count" aria-label={`${count} found`}>{count}</span>
      </summary>
      <p className="fine-print">{hint}</p>
      {count > 1 && (
        <label className="tidy-sort">
          <span>Sort by</span>
          <select value={sort} onChange={(e) => onSort(e.target.value as TidySort)} aria-label={`Sort ${title.toLowerCase()} by`}>
            {TIDY_SORTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
      )}
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

const SECTION_INFO: { id: TidySectionId; title: string; hint: string }[] = [
  { id: 'broken', title: 'Broken links', hint: 'Links to a page that does not exist and has no redirect.' },
  { id: 'orphans', title: 'Pages nothing links to', hint: 'No other page links here (directly or through a redirect) and the page has no connections. Session journals are not counted.' },
  { id: 'summary', title: 'Missing summary', hint: 'The summary is empty, so cards and search results show nothing.' },
  { id: 'picture', title: 'Missing picture', hint: 'Characters, locations and factions without a main picture.' },
  { id: 'empty', title: 'Empty pages', hint: 'No section has any text.' },
  { id: 'stubs', title: 'Stubs', hint: 'Some text, but little: no section of 300 characters or more, and fewer than three of 100 or more. Empty pages are listed separately.' },
];

export function WikiTidy() {
  const data = useLoad(loadWikiTidyData, []);
  // The filters and sort orders live in the address, so a view can be bookmarked or shared.
  const [params, setParams] = useSearchParams();
  const playersOnly = params.get('players') === '1';
  const askedType = params.get('type');
  const type = (TYPE_ORDER as string[]).includes(askedType ?? '') ? (askedType as ArticleType) : null;
  const sortOf = (id: TidySectionId): TidySort => {
    const v = params.get(`sort-${id}`);
    return TIDY_SORTS.some((o) => o.key === v) ? (v as TidySort) : 'title';
  };
  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const report = useMemo(() => {
    if (!data.data) return null;
    const full = computeWikiTidy(data.data);
    return onlyType(playersOnly ? onlyPlayerVisible(full) : full, type);
  }, [data.data, playersOnly, type]);

  const counts: Record<TidySectionId, number> | null = report && {
    broken: report.brokenLinks.length, orphans: report.orphans.length, summary: report.missingSummary.length,
    picture: report.missingPicture.length, empty: report.emptyPages.length, stubs: report.stubs.length,
  };
  const filtered = playersOnly || type;

  return (
    <div>
      <h1 className="page-title">Tidy up the wiki</h1>
      <p className="muted">Suggestions only: nothing here is changed for you. News stories are not checked. To keep a to-do for a page, add a private note titled “To do …” in its editor; pages with notes are marked below. To check for hidden names showing through, open <Link to="/dm/visibility">What players can see</Link>.</p>
      <div className="chip-cloud tidy-filters">
        <button type="button" className={playersOnly ? 'chip chip-on tidy-filter' : 'chip tidy-filter'} aria-pressed={playersOnly} onClick={() => update('players', playersOnly ? null : '1')}>
          Only pages players can see
        </button>
        <label className="tidy-type">
          <span>Kind of page</span>
          <select value={type ?? ''} onChange={(e) => update('type', e.target.value || null)}>
            <option value="">All kinds</option>
            {TYPE_ORDER.map((t) => <option key={t} value={t}>{TEMPLATES[t].plural}</option>)}
          </select>
        </label>
      </div>
      {data.loading && <p className="muted" role="status">Checking the wiki…</p>}
      {data.error && (
        <div className="notice" role="alert">
          <p>Could not check the wiki: {data.error}</p>
          <button type="button" className="button secondary small" onClick={data.reload}>Try again</button>
        </div>
      )}
      {report && counts && (
        <>
          <nav className="tidy-summary" aria-label="Summary of what to tidy" data-testid="tidy-strip">
            {SECTION_INFO.map((o) => (
              <a
                key={o.id}
                href={`#tidy-${o.id}`}
                className={counts[o.id] > 0 ? 'tidy-summary-link' : 'tidy-summary-link tidy-summary-zero'}
                onClick={() => {
                  const el = document.getElementById(`tidy-${o.id}`);
                  if (el instanceof HTMLDetailsElement) el.open = true;
                }}
              >
                <span className="tidy-summary-count">{counts[o.id]}</span>
                <span>{o.title}</span>
              </a>
            ))}
          </nav>
          {tidyTotal(report) === 0 && <p className="panel" data-testid="tidy-all-clear">Nothing to tidy{filtered ? ' with these filters' : ''}.</p>}
          {SECTION_INFO.map((o) => {
            const sort = sortOf(o.id);
            const common = { id: o.id, title: o.title, hint: o.hint, count: counts[o.id], sort, onSort: (v: TidySort) => update(`sort-${o.id}`, v === 'title' ? null : v) };
            if (o.id === 'broken') {
              return (
                <Section key={o.id} {...common}>
                  {sortPages(report.brokenLinks, sort).map((b) => (
                    <li key={`${b.page.id}|${b.target}`}>
                      <span className="tidy-main">
                        <Link to={`/wiki/${b.page.slug}`}>{b.page.title}</Link> → <code>[[{b.target}]]</code>
                      </span>
                      <span className="badges-row">
                        <VisibilityBadge visibility={b.page.visibility} />
                        <StatusBadge status={b.page.status} />
                      </span>
                      <NotesLink page={b.page} />
                      <Link className="button secondary small" to={`/dm/edit/${b.page.slug}`} aria-label={`Edit ${b.page.title}`}>Edit</Link>
                      <Link className="button small" to={`/dm/new?slug=${encodeURIComponent(b.target)}&title=${encodeURIComponent(titleFromSlug(b.target))}`}>Create this page</Link>
                    </li>
                  ))}
                </Section>
              );
            }
            const pages = { orphans: report.orphans, summary: report.missingSummary, picture: report.missingPicture, empty: report.emptyPages, stubs: report.stubs }[o.id];
            return <Section key={o.id} {...common}><PlainRows pages={sortPages(pages, sort)} /></Section>;
          })}
        </>
      )}
    </div>
  );
}
