import { useState } from 'react';
import { Link } from 'react-router';
import { ArticleCard } from '../components/ArticleCard.tsx';
import { BannerArt } from '../components/Banner.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { MediaImage } from '../components/MediaImage.tsx';
import { SearchBox } from '../components/SearchBox.tsx';
import { dailyDiscovery, getCampaignZone, getSettings, latestHeadline, latestSession, listArticles, listCharacterFacts, listLetters, listMaps, releaseDueStories } from '../lib/api.ts';
import { questState } from '../lib/questState.ts';
import { campaignDay } from '../lib/schedule.ts';
import { parsePlayDate, sessionKeys } from '../lib/sessionOrder.ts';
import { longDate } from '../lib/dates.ts';
import { GAZETTE, reporter, sectionLabel } from '../lib/gazette.ts';
import { useIsDm, useSession } from '../lib/session.tsx';
import { isNewSince, touchVisit } from '../lib/lastVisit.ts';
import { TEMPLATES } from '../lib/templates.ts';
import { useLoad } from '../lib/useLoad.ts';

/** First paragraph of the campaign overview, as the hero's introduction. */
const firstParagraph = (md: string) => md.split(/\n\s*\n/)[0]?.trim() ?? '';
const plain = (md: string) => md.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/[*_`#>]/g, '');

const QUICK: { to: string; label: string; glyph: string }[] = [
  { to: '/browse/character', label: 'Characters', glyph: TEMPLATES.character.glyph },
  { to: '/browse/session', label: 'Sessions', glyph: TEMPLATES.session.glyph },
  { to: '/browse/location', label: 'Places', glyph: TEMPLATES.location.glyph },
  { to: '/browse/quest', label: 'Quests', glyph: TEMPLATES.quest.glyph },
  { to: '/maps', label: 'Maps', glyph: '⌘' },
  { to: '/wander', label: 'Wander', glyph: '⚐' },
  { to: '/news', label: 'The Gazette', glyph: '✒' },
];

/** Give up waiting for the scheduled-story release after this long; the page does not depend on it. */
const RELEASE_WAIT_MS = 1500;

export function HomePage() {
  const isDm = useIsDm();
  const { state } = useSession();
  const userId = state.kind === 'member' ? state.userId : '';
  // When this reader's previous visit began (this browser only); read once per page load.
  const [previousVisit] = useState(() => (userId ? touchVisit(userId) : null));
  const home = useLoad(async () => {
    // Print anything scheduled whose time has come (the database clock decides), but never let that
    // hold the page up: releaseDueStories never throws, and we stop waiting for it after a moment.
    await Promise.race([releaseDueStories(), new Promise((resolve) => setTimeout(resolve, RELEASE_WAIT_MS))]);
    // Only the list of recent pages is essential. Every other part may fail on its own: its card is
    // left out and the page says so, instead of the whole page turning into an error.
    const failed: string[] = [];
    const soft = async <T,>(name: string, load: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await load();
      } catch {
        failed.push(name);
        return fallback;
      }
    };
    const recent = await listArticles({ order: 'updated', limit: 8 });
    const zone = await soft('the date', getCampaignZone, 'UTC');
    const [settings, featured, party, latest, quests, maps, headline, letters, discovery] = await Promise.all([
      soft('the campaign details', getSettings, null),
      soft('featured pages', () => listArticles({ featured: true, order: 'importance', limit: 6 }), []),
      soft('the company', () => listArticles({ party: true, order: 'title', limit: 8 }), []),
      soft('the latest session', latestSession, null),
      soft('the quests', () => listArticles({ type: 'quest', order: 'updated', limit: 12 }), []),
      soft('the maps', listMaps, []),
      soft('the Gazette headline', latestHeadline, null),
      soft('the latest letter', () => listLetters(1), []),
      soft('the daily archive page', () => dailyDiscovery(campaignDay(new Date(), zone)), null),
    ]);
    const facts = await soft('status details', () => listCharacterFacts([...party, ...quests].map((p) => p.id)), new Map());
    return { settings, featured, hasContent: recent.length > 0, recent: recent.filter((a) => a.type !== 'news'), party, facts, latest, quests, maps, headline, letter: letters[0] ?? null, discovery, failed };
  }, [isDm]);

  if (home.error) {
    return (
      <div className="notice" role="alert">
        <p>The home page could not load: {home.error}</p>
        <button type="button" className="button secondary small" onClick={home.reload}>Try again</button>
      </div>
    );
  }
  const d = home.data;
  const title = d?.settings?.title || 'Chronicle';
  const intro = d?.settings?.overview ? firstParagraph(d.settings.overview) : '';
  // Nothing this reader can see yet: say so plainly instead of showing a row of empty panels.
  const empty = d !== undefined && d !== null && !d.hasContent;
  const where = d?.settings?.current_location ?? null;
  const status = d?.settings?.current_status ?? '';
  // Quests: open ones first (the threads still hanging), then those with no status; finished ones are
  // not listed one by one, only counted.
  const questRows = (d?.quests ?? []).map((q) => ({ q, status: d?.facts.get(q.id)?.status ?? '', state: questState(d?.facts.get(q.id)?.status) }));
  const openQuests = questRows.filter((r) => r.state === 'open');
  const otherQuests = questRows.filter((r) => r.state === 'unknown');
  const doneCount = questRows.filter((r) => r.state === 'done').length;
  const shownQuests = [...openQuests, ...otherQuests].slice(0, 6);
  const sessionDate = d?.latest ? parsePlayDate(sessionKeys(d.latest.session).date) : null;

  return (
    <div className="home">
      <section className="hero">
        {d?.settings?.banner_media_id ? <MediaImage id={d.settings.banner_media_id} alt="" className="hero-art" /> : <BannerArt className="hero-art" />}
        <div className="hero-text">
          <h1>{title}</h1>
          {d?.settings?.tagline && <p className="hero-tagline">{d.settings.tagline}</p>}
          {intro && <div className="hero-intro"><Markdown text={intro} /></div>}
          <div className="hero-search"><SearchBox /></div>
        </div>
      </section>

      {empty && isDm && (
        <section className="panel" data-testid="home-empty-dm">
          <h2>An empty chronicle</h2>
          <p>Nothing has been written here yet. A good first hour:</p>
          <ol>
            <li><Link to="/dm/settings">Name the campaign</Link> and write a few lines about it for this page.</li>
            <li><Link to="/dm/new?type=session">Write up the last session</Link> while it is fresh, or <Link to="/dm/import">import a lore package</Link> you have prepared.</li>
            <li>Add the party: <Link to="/dm/new?type=character">a page for each character</Link>, marked as a party member.</li>
            <li>Publish a page when you are happy with it, then <Link to="/dm/access">give your players the access code</Link>.</li>
          </ol>
          <p className="fine-print">Everything starts as a private draft. Players see nothing until you publish it.</p>
        </section>
      )}
      {empty && !isDm && (
        <section className="panel" data-testid="home-empty-player">
          <h2>The first page is still being written</h2>
          <p>Nothing has been published yet. Come back after the next session.</p>
        </section>
      )}

      {!empty && d && (
        <>
          <nav className="quick-bar" aria-label="Quick access">
            {QUICK.map((q) => (
              <Link key={q.to} to={q.to} className="quick-link"><span className="quick-glyph" aria-hidden="true">{q.glyph}</span>{q.label}</Link>
            ))}
          </nav>

          {d.failed.length > 0 && (
            <div className="notice" role="status" data-testid="home-partial">
              <p>Some parts of this page could not load ({d.failed.join(', ')}).</p>
              <button type="button" className="button secondary small" onClick={home.reload}>Try again</button>
            </div>
          )}

          <div className="now-row">
            {(where || status || isDm) && (
              <section className="now-card now-where" aria-labelledby="now-where">
                <h2 id="now-where">Where things stand</h2>
                {where ? <p className="now-big"><Link to={`/wiki/${where.slug}`}>{where.title}</Link></p> : isDm && <p className="now-big muted">Somewhere on Krynn</p>}
                {status ? <p>{status}</p> : isDm && <p className="fine-print">Set the party’s location and a line about how things stand in <Link to="/dm/settings">wiki settings</Link>.</p>}
              </section>
            )}
            {d.latest && (
              <section className="now-card now-session" aria-labelledby="now-session">
                <h2 id="now-session">{d.latest.orderKnown ? 'Latest session' : 'From the session journals'}</h2>
                <p className="now-big"><Link to={`/wiki/${d.latest.session.slug}`}>{d.latest.session.title}</Link></p>
                {longDate(sessionDate) && <p className="muted">Played {longDate(sessionDate)}</p>}
                {d.latest.session.summary && <p className="now-summary">{plain(d.latest.session.summary)}</p>}
                <p className="now-more"><Link to={`/wiki/${d.latest.session.slug}`}>Read the session journal →</Link></p>
                {isDm && (d.latest.session.status !== 'published' || d.latest.session.visibility !== 'players') && <p className="fine-print dm-note">Not published: players do not see this card yet.</p>}
              </section>
            )}
            <section className="now-card now-gazette" aria-labelledby="now-gazette">
              <h2 id="now-gazette"><Link to="/news">{GAZETTE.name}</Link></h2>
              {d.headline ? (
                <>
                  <p className="now-kicker">{sectionLabel(d.headline.news?.section)} · {reporter(d.headline.news?.reporter).name}</p>
                  <p className="now-big now-headline"><Link to={`/news/${d.headline.slug}`}>{d.headline.title}</Link></p>
                </>
              ) : <p className="muted">{GAZETTE.tagline} Nothing printed yet.</p>}
              {d.letter && (
                <p className="now-letter"><span className="now-kicker">Latest letter</span> <Link to={`/news/${d.letter.slug}`}>{d.letter.title}</Link>{d.letter.news?.letter_from ? <span className="muted"> · from {d.letter.news.letter_from}</span> : null}</p>
              )}
            </section>
            {d.discovery && (
              <section className="now-card now-discovery" aria-labelledby="now-discovery">
                <h2 id="now-discovery">From the archive today</h2>
                <p className="now-kicker">{d.discovery.news ? GAZETTE.name : TEMPLATES[d.discovery.type]?.label ?? d.discovery.type}</p>
                <p className="now-big"><Link to={d.discovery.news ? `/news/${d.discovery.slug}` : `/wiki/${d.discovery.slug}`}>{d.discovery.title}</Link></p>
                {d.discovery.summary && <p className="now-summary">{plain(d.discovery.summary)}</p>}
              </section>
            )}
          </div>

          {d.party.length > 0 && (
            <section className="company" aria-labelledby="the-company">
              <h2 id="the-company">The company</h2>
              <div className="company-grid character-grid">
                {d.party.map((a) => {
                  const f = d.facts.get(a.id);
                  return <ArticleCard key={a.id} article={a} portrait showState={isDm} meta={[f?.race, f?.class].filter(Boolean).join(' · ')} status={f?.status} />;
                })}
              </div>
            </section>
          )}

          <div className="home-grid">
            <div className="home-main">
              {(shownQuests.length > 0 || doneCount > 0) && (
                <section className="panel">
                  <h2>{openQuests.length > 0 ? 'Open threads' : 'Quests'}</h2>
                  <ul className="thread-list">
                    {shownQuests.map(({ q, status: st }) => (
                      <li key={q.id}>
                        <Link to={`/wiki/${q.slug}`}>{q.title}</Link>
                        {st && <span className="thread-status"> {st}</span>}
                        {q.summary && <span className="muted"> {plain(q.summary)}</span>}
                      </li>
                    ))}
                  </ul>
                  {doneCount > 0 && <p className="fine-print">{doneCount} finished {doneCount === 1 ? 'quest' : 'quests'} not listed here.</p>}
                  <Link to="/browse/quest" className="more-link">All quests →</Link>
                </section>
              )}
              {d.featured.length > 0 && (
                <section className="panel">
                  <h2>Featured</h2>
                  <div className="card-grid">{d.featured.map((a) => <ArticleCard key={a.id} article={a} showState={isDm} />)}</div>
                </section>
              )}
              {d.settings?.overview && (
                <section className="panel">
                  <h2>About this campaign</h2>
                  <Markdown text={d.settings.overview} />
                </section>
              )}
            </div>
            <aside className="home-side">
              {d.recent.length > 0 && <section className="panel">
                <h2>{d.recent.some((a) => isNewSince(a.published_at, previousVisit)) ? 'New and recently updated' : 'Recently updated'}</h2>
                <ul className="recent-list">
                  {d.recent.map((a) => (
                    <li key={a.id}>
                      <Link to={`/wiki/${a.slug}`}>{a.title}</Link>
                      {isNewSince(a.published_at, previousVisit) && <span className="badge badge-ok">New since your last visit</span>}
                      <span className="muted"> · {TEMPLATES[a.type].label} · {longDate(a.updated_at)}</span>
                    </li>
                  ))}
                </ul>
              </section>}
              <section className="panel">
                <h2>Explore</h2>
                <ul className="explore-list">
                  <li><Link to="/maps">Maps{` (${d.maps.length})`}</Link></li>
                  <li><Link to="/timeline">Timeline</Link></li>
                  <li><Link to="/connections">Connections</Link></li>
                  <li><Link to="/categories">Categories</Link></li>
                  <li><Link to="/browse/faction">{TEMPLATES.faction.plural}</Link></li>
                  <li><Link to="/browse/item">{TEMPLATES.item.plural}</Link></li>
                </ul>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
