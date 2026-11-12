import { Link } from 'react-router';
import { ArticleCard } from '../components/ArticleCard.tsx';
import { BannerArt } from '../components/Banner.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { MediaImage } from '../components/MediaImage.tsx';
import { SearchBox } from '../components/SearchBox.tsx';
import { getSettings, listArticles, listCharacterFacts, listMaps, listNews, listSessions } from '../lib/api.ts';
import { longDate } from '../lib/dates.ts';
import { GAZETTE, reporter, sectionLabel } from '../lib/gazette.ts';
import { latestDatedSession } from '../lib/home.ts';
import { useIsDm } from '../lib/session.tsx';
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
  { to: '/news', label: 'The Gazette', glyph: '✒' },
];

export function HomePage() {
  const isDm = useIsDm();
  const home = useLoad(async () => {
    const [settings, featured, recent, party, sessions, quests, maps, news] = await Promise.all([
      getSettings(),
      listArticles({ featured: true, order: 'importance', limit: 6 }),
      listArticles({ order: 'updated', limit: 8 }),
      listArticles({ party: true, order: 'title', limit: 8 }),
      listSessions(),
      listArticles({ type: 'quest', order: 'updated', limit: 6 }),
      listMaps(),
      listNews(),
    ]);
    const facts = await listCharacterFacts(party.map((p) => p.id));
    const latestSession = latestDatedSession(sessions);
    const headline = news.find((s) => s.status === 'published' && s.visibility === 'players') ?? null;
    return { settings, featured, hasContent: recent.length > 0, recent: recent.filter((a) => a.type !== 'news'), party, facts, latestSession, quests, maps, headline };
  }, [isDm]);

  if (home.error) return <p className="form-error">{home.error}</p>;
  const d = home.data;
  const title = d?.settings?.title || 'Chronicle';
  const intro = d?.settings?.overview ? firstParagraph(d.settings.overview) : '';
  // Nothing this reader can see yet: say so plainly instead of showing a row of empty panels.
  const empty = d !== undefined && d !== null && !d.hasContent;
  const where = d?.settings?.current_location ?? null;
  const status = d?.settings?.current_status ?? '';

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

          <div className="now-row">
            <section className="now-card now-where" aria-labelledby="now-where">
              <h2 id="now-where">Where things stand</h2>
              {where ? <p className="now-big"><Link to={`/wiki/${where.slug}`}>{where.title}</Link></p> : <p className="now-big muted">Somewhere on Krynn</p>}
              {status ? <p>{status}</p> : isDm && <p className="fine-print">Set the party’s location and a line about how things stand in <Link to="/dm/settings">wiki settings</Link>.</p>}
            </section>
            {d.latestSession && (
              <section className="now-card now-session" aria-labelledby="now-session">
                <h2 id="now-session">Latest dated session</h2>
                <p className="now-big"><Link to={`/wiki/${d.latestSession.slug}`}>{d.latestSession.title}</Link></p>
                {longDate(d.latestSession.session_date) && <p className="muted">Played {longDate(d.latestSession.session_date)}</p>}
                {d.latestSession.summary && <p className="now-summary">{plain(d.latestSession.summary)}</p>}
                {isDm && (d.latestSession.status !== 'published' || d.latestSession.visibility !== 'players') && <p className="fine-print dm-note">Not published: players do not see this card yet.</p>}
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
            </section>
          </div>

          {d.party.length > 0 && (
            <section className="company" aria-labelledby="the-company">
              <h2 id="the-company">The company</h2>
              <div className="company-grid character-grid">
                {d.party.map((a) => {
                  const f = d.facts.get(a.id);
                  return <ArticleCard key={a.id} article={a} portrait showState={isDm} meta={[f?.race, f?.class].filter(Boolean).join(' · ')} />;
                })}
              </div>
            </section>
          )}

          <div className="home-grid">
            <div className="home-main">
              {d.quests.length > 0 && (
                <section className="panel">
                  <h2>Recently updated quests</h2>
                  <ul className="thread-list">
                    {d.quests.map((a) => (
                      <li key={a.id}>
                        <Link to={`/wiki/${a.slug}`}>{a.title}</Link>
                        {a.summary && <span className="muted"> {plain(a.summary)}</span>}
                      </li>
                    ))}
                  </ul>
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
                <h2>Recently updated</h2>
                <ul className="recent-list">
                  {d.recent.map((a) => (
                    <li key={a.id}>
                      <Link to={`/wiki/${a.slug}`}>{a.title}</Link>
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
