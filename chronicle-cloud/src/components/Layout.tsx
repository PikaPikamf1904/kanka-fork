import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { getSettings } from '../lib/api.ts';
import { savedAccounts } from '../lib/accounts.ts';
import { useIsDm, useSession } from '../lib/session.tsx';
import { TEMPLATES } from '../lib/templates.ts';
import type { ArticleType } from '../lib/types.ts';
import { useLoad } from '../lib/useLoad.ts';
import { prefetchMarkdown } from './Markdown.tsx';
import { CommandPalette } from './CommandPalette.tsx';
import { MaintenanceNotice } from './MaintenanceNotice.tsx';
import { SearchBox } from './SearchBox.tsx';

const BROWSE: ArticleType[] = ['character', 'location', 'faction', 'item', 'quest', 'session'];

type Theme = 'auto' | 'light' | 'dark';
const THEMES: { value: Theme; label: string }[] = [
  { value: 'auto', label: 'Theme: match device' },
  { value: 'light', label: 'Theme: light' },
  { value: 'dark', label: 'Theme: dark' },
];

type Reading = 'standard' | 'large' | 'plain';
const READINGS: { value: Reading; label: string }[] = [
  { value: 'standard', label: 'Reading: standard' },
  { value: 'large', label: 'Reading: larger text' },
  { value: 'plain', label: 'Reading: larger text, plain font' },
];

/** Reading comfort, remembered per browser and applied to the whole page. */
function useReading(): [Reading, (r: Reading) => void] {
  const [reading, setReading] = useState<Reading>(() => {
    try {
      const saved = localStorage.getItem('chronicle-reading');
      return saved === 'large' || saved === 'plain' ? saved : 'standard';
    } catch {
      return 'standard';
    }
  });
  useEffect(() => {
    if (reading === 'standard') document.documentElement.removeAttribute('data-reading');
    else document.documentElement.setAttribute('data-reading', reading);
    try {
      localStorage.setItem('chronicle-reading', reading);
    } catch {
      // Private mode: not remembered.
    }
  }, [reading]);
  return [reading, setReading];
}

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('chronicle-theme');
      return saved === 'light' || saved === 'dark' ? saved : 'auto';
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
  return [theme, setTheme];
}

export function Layout() {
  const { state, playerPreview, setPlayerPreview, signOut } = useSession();
  const isDm = useIsDm();
  const realDm = state.kind === 'member' && state.role === 'dm';
  const settings = useLoad(getSettings, []);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [theme, setTheme] = useTheme();
  const [reading, setReading] = useReading();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const focusSearch = useRef(false);
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

  // The phone menu behaves like a dialog: focus moves into it, Escape closes it, focus returns to
  // the menu button, and the page behind it is inert (see `inert` below) while it is open.
  // Set by the explicit ways of closing (Escape, the scrim, the menu button), not by following a link.
  const returnFocus = useRef(false);
  const openedOn = useRef<string | null>(null);
  useEffect(() => {
    if (menuOpen) {
      const target = focusSearch.current
        ? navRef.current?.querySelector<HTMLInputElement>('.sidebar-search input')
        : navRef.current?.querySelector<HTMLElement>('input, a[href], button');
      focusSearch.current = false;
      requestAnimationFrame(() => target?.focus());
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          returnFocus.current = true;
          setMenuPath(null);
        }
      };
      document.addEventListener('keydown', onKey);
      openedOn.current = location.pathname;
      return () => document.removeEventListener('keydown', onKey);
    }
    if (openedOn.current !== null) {
      // Closed with Escape, the scrim or the menu button: focus goes back to the menu button.
      // Closed by following a link or a search: the new page keeps the focus.
      if (returnFocus.current) toggleRef.current?.focus();
      returnFocus.current = false;
      openedOn.current = null;
    }
  }, [menuOpen, location.pathname]);

  return (
    <div className={playerPreview ? 'app preview-mode' : 'app'}>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="site-header-inner">
          <button
            ref={toggleRef}
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="site-nav"
            onClick={() => {
              returnFocus.current = menuOpen;
              setMenuOpen((o) => !o);
            }}
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
            <button
              type="button"
              className="icon-button search-toggle"
              aria-label="Open search"
              onClick={() => {
                focusSearch.current = true;
                setMenuOpen(true);
              }}
            >
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20">
                <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M12.5 12.5 L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <label className="theme-picker">
              <span className="visually-hidden">Colour theme</span>
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" className="theme-icon">
                <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                {theme === 'dark' && <circle cx="10" cy="10" r="7.5" fill="currentColor" />}
                {theme === 'auto' && <path d="M10 2.5 A7.5 7.5 0 0 1 10 17.5 Z" fill="currentColor" />}
              </svg>
              <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} aria-label="Colour theme">
                {THEMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="theme-picker reading-picker">
              <span className="visually-hidden">Reading comfort</span>
              <span aria-hidden="true" className="reading-icon">Aa</span>
              <select value={reading} onChange={(e) => setReading(e.target.value as Reading)} aria-label="Reading comfort">
                {READINGS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
          </div>
        </div>
        <MaintenanceNotice />
        {playerPreview && (
          <div className="preview-banner" role="status">
            Viewing as a player. Article pages show exactly what players receive.
            <button type="button" onClick={() => setPlayerPreview(false)}>Back to DM view</button>
          </div>
        )}
      </header>

      <div className="shell">
        <nav id="site-nav" ref={navRef} className={menuOpen ? 'sidebar open' : 'sidebar'} aria-label="Wiki">
          <button
            type="button"
            className="palette-open"
            onClick={() => {
              setMenuOpen(false);
              document.dispatchEvent(new Event('chronicle:open-palette'));
            }}
          >
            Jump to… <kbd>Ctrl K</kbd>
          </button>
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
            <NavLink to="/news" className={({ isActive }) => (isActive ? 'nav-gazette active' : 'nav-gazette')}><span className="nav-glyph" aria-hidden="true">✒</span>The Goblin Gazette</NavLink>
            <NavLink to="/a-z"><span className="nav-glyph" aria-hidden="true">≡</span>A–Z index</NavLink>
            <NavLink to="/recent"><span className="nav-glyph" aria-hidden="true">↻</span>Recently updated</NavLink>
            <NavLink to="/saved"><span className="nav-glyph" aria-hidden="true">★</span>Saved pages</NavLink>
            <NavLink to="/journal"><span className="nav-glyph" aria-hidden="true">✎</span>Journal</NavLink>
            <NavLink to="/scratchpad"><span className="nav-glyph" aria-hidden="true">✐</span>My scratchpad</NavLink>
            <NavLink to="/wander"><span className="nav-glyph" aria-hidden="true">⚐</span>Wander</NavLink>
            <NavLink to="/maps"><span className="nav-glyph" aria-hidden="true">⌘</span>Maps</NavLink>
            <NavLink to="/timeline"><span className="nav-glyph" aria-hidden="true">⧗</span>Timeline</NavLink>
            <NavLink to="/graph"><span className="nav-glyph" aria-hidden="true">✺</span>Knowledge graph</NavLink>
            <NavLink to="/connections"><span className="nav-glyph" aria-hidden="true">⚭</span>Connections</NavLink>
            <NavLink to="/categories"><span className="nav-glyph" aria-hidden="true">❖</span>Categories</NavLink>
            <NavLink to="/browse/lore"><span className="nav-glyph" aria-hidden="true">❦</span>Lore</NavLink>
          </div>
          {isDm && (
            <div className="nav-group nav-dm">
              <div className="nav-heading">Dungeon Master</div>
              <NavLink to="/dm" end>DM desk</NavLink>
              <NavLink to="/dm/new">New article</NavLink>
              <NavLink to="/dm/news">News desk</NavLink>
              <NavLink to="/dm/media">Media library</NavLink>
              <NavLink to="/dm/tidy">Tidy up the wiki</NavLink>
              <NavLink to="/dm/visibility">What players can see</NavLink>
              <NavLink to="/dm/import">Import lore</NavLink>
              <NavLink to="/browse/dossier">Dossiers</NavLink>
              <NavLink to="/dm/notes">Private notes</NavLink>
              <NavLink to="/dm/journals">Player journals</NavLink>
              <NavLink to="/dm/access">Player access</NavLink>
              <NavLink to="/dm/feedback">Player feedback</NavLink>
              <NavLink to="/dm/settings">Wiki settings</NavLink>
            </div>
          )}
          <div className="nav-group nav-account">
            <NavLink to="/feedback">Feedback for the DM</NavLink>
            {state.kind === 'member' && <div className="signed-in">Signed in as {state.displayName}</div>}
            {state.kind === 'member' && <AccountSwitcher currentUserId={state.userId} onDone={() => setMenuOpen(false)} />}
            {realDm && !playerPreview && (
              <button type="button" className="link-button" onClick={() => setPlayerPreview(true)}>View as a player</button>
            )}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                if (window.confirm(realDm ? 'Sign out?' : 'Leave Chronicle on this device? Your other devices stay signed in. To come back here you will need a new invitation link.')) {
                  void signOut();
                }
              }}
            >
              {realDm ? 'Sign out' : 'Leave on this device'}
            </button>
          </div>
        </nav>
        {menuOpen && (
          <button type="button" className="scrim" aria-label="Close menu" onClick={() => {
            returnFocus.current = true;
            setMenuOpen(false);
          }} />
        )}
        <main id="main" className="content" tabIndex={-1} inert={menuOpen || undefined}>
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <footer className="site-footer">
        {title} · a private campaign wiki · unofficial fan content for a home game
      </footer>
    </div>
  );
}

/** Other players who joined on this shared device; switching needs no code, only their own earlier sign-in here. */
function AccountSwitcher({ currentUserId, onDone }: { currentUserId: string; onDone: () => void }) {
  const { switchAccount } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const others = savedAccounts().filter((a) => a.userId !== currentUserId);
  if (others.length === 0 && !error) return null;
  return (
    <div className="account-switch" role="group" aria-label="Switch player on this device">
      {others.map((a) => (
        <button
          key={a.userId}
          type="button"
          className="link-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await switchAccount(a.userId);
              onDone();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not switch.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Switch to {a.name}
        </button>
      ))}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
