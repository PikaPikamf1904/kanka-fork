import { Link } from 'react-router';
import { ArticleCard } from '../components/ArticleCard.tsx';
import { BannerArt } from '../components/Banner.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { MediaImage } from '../components/MediaImage.tsx';
import { SearchBox } from '../components/SearchBox.tsx';
import { getSettings, listArticles, listMaps } from '../lib/api.ts';
import { useIsDm } from '../lib/session.tsx';
import { TEMPLATES } from '../lib/templates.ts';
import { useLoad } from '../lib/useLoad.ts';

export function HomePage() {
  const isDm = useIsDm();
  const home = useLoad(async () => {
    const [settings, featured, recent, party, characters, locations, sessions, maps] = await Promise.all([
      getSettings(),
      listArticles({ featured: true, order: 'importance', limit: 6 }),
      listArticles({ order: 'updated', limit: 8 }),
      listArticles({ party: true, order: 'title', limit: 8 }),
      listArticles({ type: 'character', order: 'importance', limit: 6 }),
      listArticles({ type: 'location', order: 'importance', limit: 6 }),
      listArticles({ type: 'session', order: 'session', limit: 1 }),
      listMaps(),
    ]);
    return { settings, featured, recent, party, characters, locations, latestSession: sessions[0], maps };
  }, [isDm]);

  if (home.error) return <p className="form-error">{home.error}</p>;
  const d = home.data;
  const title = d?.settings?.title || 'Chronicle';

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
                {d.latestSession.session_date && <span className="muted"> · {new Date(d.latestSession.session_date).toLocaleDateString()}</span>}
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

          <section className="panel">
            <h2>Important characters</h2>
            <div className="card-grid">{d?.characters.map((a) => <ArticleCard key={a.id} article={a} showState={isDm} />)}</div>
            <Link to="/browse/character" className="more-link">All characters →</Link>
          </section>

          <section className="panel">
            <h2>Important places</h2>
            <div className="card-grid">{d?.locations.map((a) => <ArticleCard key={a.id} article={a} showState={isDm} />)}</div>
            <Link to="/browse/location" className="more-link">All locations →</Link>
          </section>
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
          <section className="panel">
            <h2>Recently updated</h2>
            <ul className="recent-list">
              {d?.recent.map((a) => (
                <li key={a.id}>
                  <Link to={`/wiki/${a.slug}`}>{a.title}</Link>
                  <span className="muted"> · {new Date(a.updated_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
