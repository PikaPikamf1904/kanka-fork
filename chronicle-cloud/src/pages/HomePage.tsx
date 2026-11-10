import { Link } from 'react-router';
import { ArticleCard } from '../components/ArticleCard.tsx';
import { BannerArt } from '../components/Banner.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { MediaImage } from '../components/MediaImage.tsx';
import { SearchBox } from '../components/SearchBox.tsx';
import { getSettings, listArticles, listMaps } from '../lib/api.ts';
import { longDate } from '../lib/dates.ts';
import { useIsDm } from '../lib/session.tsx';
import { TEMPLATES } from '../lib/templates.ts';
import { useLoad } from '../lib/useLoad.ts';

export function HomePage() {
  const isDm = useIsDm();
  const home = useLoad(async () => {
    const [settings, featured, recent, party, characters, locations, sessions, quests, maps] = await Promise.all([
      getSettings(),
      listArticles({ featured: true, order: 'importance', limit: 6 }),
      listArticles({ order: 'updated', limit: 8 }),
      listArticles({ party: true, order: 'title', limit: 8 }),
      listArticles({ type: 'character', order: 'importance', limit: 6 }),
      listArticles({ type: 'location', order: 'importance', limit: 6 }),
      listArticles({ type: 'session', order: 'session', limit: 1 }),
      listArticles({ type: 'quest', order: 'updated', limit: 5 }),
      listMaps(),
    ]);
    return { settings, featured, recent, party, characters, locations, latestSession: sessions[0], quests, maps };
  }, [isDm]);

  if (home.error) return <p className="form-error">{home.error}</p>;
  const d = home.data;
  const title = d?.settings?.title || 'Chronicle';
  // Nothing this reader can see yet: say so plainly instead of showing a row of empty panels.
  const empty = d !== undefined && d !== null && d.recent.length === 0;

  return (
    <div className="home">
      <section className="hero">
        {d?.settings?.banner_media_id ? <MediaImage id={d.settings.banner_media_id} alt="" className="hero-art" /> : <BannerArt className="hero-art" />}
        <div className="hero-text">
          <h1>{title}</h1>
          {d?.settings?.tagline && <p className="hero-tagline">{d.settings.tagline}</p>}
          <div className="hero-search"><SearchBox /></div>
        </div>
      </section>

      <div className="home-grid">
        <div className="home-main">
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

          {d?.settings?.overview && (
            <section className="panel">
              <h2>About this campaign</h2>
              <Markdown text={d.settings.overview} />
            </section>
          )}

          {d?.latestSession && (
            <section className="panel latest-session">
              <h2>Latest session</h2>
              <Link to={`/wiki/${d.latestSession.slug}`} className="latest-session-link">
                <span className="latest-session-title">{d.latestSession.title}</span>
                {longDate(d.latestSession.session_date) && <span className="muted"> · {longDate(d.latestSession.session_date)}</span>}
              </Link>
              {d.latestSession.summary && <p>{d.latestSession.summary}</p>}
            </section>
          )}

          {(d?.featured.length ?? 0) > 0 && (
            <section className="panel">
              <h2>Featured articles</h2>
              <div className="card-grid">{d!.featured.map((a) => <ArticleCard key={a.id} article={a} showState={isDm} />)}</div>
            </section>
          )}

          {(d?.quests.length ?? 0) > 0 && (
            <section className="panel">
              <h2>Quests</h2>
              <ul className="recent-list">
                {d!.quests.map((a) => (
                  <li key={a.id}>
                    <Link to={`/wiki/${a.slug}`}>{a.title}</Link>
                    {a.summary && <span className="muted"> · {a.summary}</span>}
                  </li>
                ))}
              </ul>
              <Link to="/browse/quest" className="more-link">All quests →</Link>
            </section>
          )}

          {(d?.characters.length ?? 0) > 0 && (
            <section className="panel">
              <h2>Important characters</h2>
              <div className="card-grid">{d!.characters.map((a) => <ArticleCard key={a.id} article={a} showState={isDm} />)}</div>
              <Link to="/browse/character" className="more-link">All characters →</Link>
            </section>
          )}

          {(d?.locations.length ?? 0) > 0 && (
            <section className="panel">
              <h2>Important places</h2>
              <div className="card-grid">{d!.locations.map((a) => <ArticleCard key={a.id} article={a} showState={isDm} />)}</div>
              <Link to="/browse/location" className="more-link">All locations →</Link>
            </section>
          )}
        </div>

        <aside className="home-side">
          {(d?.party.length ?? 0) > 0 && (
            <section className="panel">
              <h2>The party</h2>
              <div className="stack">{d!.party.map((a) => <ArticleCard key={a.id} article={a} compact />)}</div>
            </section>
          )}
          <section className="panel">
            <h2>Explore</h2>
            <ul className="explore-list">
              <li><Link to="/maps">Maps{d ? ` (${d.maps.length})` : ''}</Link></li>
              <li><Link to="/browse/quest">{TEMPLATES.quest.plural}</Link></li>
              <li><Link to="/browse/session">{TEMPLATES.session.plural}</Link></li>
              <li><Link to="/timeline">Timeline</Link></li>
              <li><Link to="/connections">Connections</Link></li>
              <li><Link to="/categories">Categories</Link></li>
            </ul>
          </section>
          {!empty && <section className="panel">
            <h2>Recently updated</h2>
            <ul className="recent-list">
              {d?.recent.map((a) => (
                <li key={a.id}>
                  <Link to={`/wiki/${a.slug}`}>{a.title}</Link>
                  <span className="muted"> · {longDate(a.updated_at)}</span>
                </li>
              ))}
            </ul>
          </section>}
        </aside>
      </div>
    </div>
  );
}
