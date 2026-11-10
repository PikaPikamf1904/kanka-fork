import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { getSettings } from '../lib/api.ts';
import { useIsDm, useSession } from '../lib/session.tsx';
import { TEMPLATES } from '../lib/templates.ts';
import type { ArticleType } from '../lib/types.ts';
import { useLoad } from '../lib/useLoad.ts';
import { prefetchMarkdown } from './Markdown.tsx';
import { SearchBox } from './SearchBox.tsx';

const BROWSE: ArticleType[] = ['character', 'location', 'faction', 'item', 'quest', 'session'];

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('chronicle-theme') ?? 'auto';
    } catch {
      return 'auto';
    }
  });
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('chronicle-theme', theme);
    } catch {
      // Private mode: the choice just isn't remembered.
    }
  }, [theme]);
  const next = () => setTheme((t) => (t === 'auto' ? 'dark' : t === 'dark' ? 'light' : 'auto'));
  return [theme, next];
}

export function Layout() {
  const { state, playerPreview, setPlayerPreview, signOut } = useSession();
  const isDm = useIsDm();
  const realDm = state.kind === 'member' && state.role === 'dm';
  const settings = useLoad(getSettings, []);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [theme, nextTheme] = useTheme();
  const location = useLocation();
  const menuOpen = menuPath === location.pathname;
  const setMenuOpen = (open: boolean | ((o: boolean) => boolean)) =>
    setMenuPath((typeof open === 'function' ? open(menuOpen) : open) ? location.pathname : null);
  useEffect(() => {
    const title = settings.data?.title ?? 'Chronicle';
    if (!document.title.includes(title)) document.title = title;
  }, [settings.data]);

  const title = settings.data?.title || 'Chronicle';

  useEffect(prefetchMarkdown, []);

  return (
    <div className={playerPreview ? 'app preview-mode' : 'app'}>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="site-header-inner">
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="site-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span aria-hidden="true">☰</span>
            <span className="visually-hidden">Menu</span>
          </button>
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">✶</span>
            <span className="brand-name">{title}</span>
          </Link>
          <div className="header-search">
            <SearchBox />
          </div>
          <div className="header-actions">
            <button type="button" className="icon-button" onClick={nextTheme} title={`Theme: ${theme}`}>
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" className="theme-icon">
                <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                {theme === 'dark' && <circle cx="10" cy="10" r="7.5" fill="currentColor" />}
                {theme === 'auto' && <path d="M10 2.5 A7.5 7.5 0 0 1 10 17.5 Z" fill="currentColor" />}
              </svg>
              <span className="visually-hidden">Change theme (now {theme})</span>
            </button>
          </div>
        </div>
        {playerPreview && (
          <div className="preview-banner" role="status">
            Viewing as a player. Article pages show exactly what players receive.
            <button type="button" onClick={() => setPlayerPreview(false)}>Back to DM view</button>
          </div>
        )}
      </header>

      <div className="shell">
        <nav id="site-nav" className={menuOpen ? 'sidebar open' : 'sidebar'} aria-label="Wiki">
          <div className="sidebar-search">
            <SearchBox onDone={() => setMenuOpen(false)} />
          </div>
          <div className="nav-group">
            <NavLink to="/" end>Main page</NavLink>
            {BROWSE.map((type) => (
              <NavLink key={type} to={`/browse/${type}`}>
                <span className="nav-glyph" aria-hidden="true">{TEMPLATES[type].glyph}</span>
                {TEMPLATES[type].plural}
              </NavLink>
            ))}
          </div>
          <div className="nav-group">
            <NavLink to="/maps"><span className="nav-glyph" aria-hidden="true">⌘</span>Maps</NavLink>
            <NavLink to="/timeline"><span className="nav-glyph" aria-hidden="true">⧗</span>Timeline</NavLink>
            <NavLink to="/connections"><span className="nav-glyph" aria-hidden="true">⚭</span>Connections</NavLink>
            <NavLink to="/categories"><span className="nav-glyph" aria-hidden="true">❖</span>Categories</NavLink>
            <NavLink to="/browse/lore"><span className="nav-glyph" aria-hidden="true">❦</span>Lore</NavLink>
          </div>
          {isDm && (
            <div className="nav-group nav-dm">
              <div className="nav-heading">Dungeon Master</div>
              <NavLink to="/dm" end>DM desk</NavLink>
              <NavLink to="/dm/new">New article</NavLink>
              <NavLink to="/dm/import">Import lore</NavLink>
              <NavLink to="/browse/dossier">Dossiers</NavLink>
              <NavLink to="/dm/notes">Private notes</NavLink>
              <NavLink to="/dm/access">Player access</NavLink>
              <NavLink to="/dm/settings">Wiki settings</NavLink>
            </div>
          )}
          <div className="nav-group nav-account">
            {state.kind === 'member' && <div className="signed-in">Signed in as {state.displayName}</div>}
            {realDm && !playerPreview && (
              <button type="button" className="link-button" onClick={() => setPlayerPreview(true)}>View as a player</button>
            )}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                if (window.confirm(realDm ? 'Sign out?' : 'Leave Chronicle on this device? You will need the access code to come back.')) {
                  void signOut();
                }
              }}
            >
              {realDm ? 'Sign out' : 'Leave on this device'}
            </button>
          </div>
        </nav>
        {menuOpen && <button type="button" className="scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <footer className="site-footer">
        {title} · a private campaign wiki · unofficial fan content for a home game
      </footer>
    </div>
  );
}
