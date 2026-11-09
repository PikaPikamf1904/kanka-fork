import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { Layout } from './components/Layout.tsx';
import { SessionProvider, useIsDm, useSession } from './lib/session.tsx';
import { AccessPage } from './pages/AccessPage.tsx';
import { ArticlePage } from './pages/ArticlePage.tsx';
import { BrowsePage, CategoriesPage, CategoryPage, ConnectionsPage, SearchPage, TimelinePage } from './pages/BrowsePages.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { NotFound } from './pages/NotFound.tsx';
import { SignInPage } from './pages/SignInPage.tsx';

// Maps (Leaflet) and DM tools load on demand, so players' first page load stays small.
const MapsPage = lazy(() => import('./pages/MapPages.tsx').then((m) => ({ default: m.MapsPage })));
const MapPage = lazy(() => import('./pages/MapPages.tsx').then((m) => ({ default: m.MapPage })));
const ArticleEditor = lazy(() => import('./pages/dm/ArticleEditor.tsx').then((m) => ({ default: m.ArticleEditor })));
const dm = (name: 'DmDesk' | 'NotesPage' | 'AccessAdmin' | 'SettingsPage' | 'TimelineEditor' | 'MapEditor') =>
  lazy(() => import('./pages/dm/DmPages.tsx').then((m) => ({ default: m[name] })));
const DmDesk = dm('DmDesk');
const NotesPage = dm('NotesPage');
const AccessAdmin = dm('AccessAdmin');
const SettingsPage = dm('SettingsPage');
const TimelineEditor = dm('TimelineEditor');
const MapEditor = dm('MapEditor');

function Gate() {
  const { state } = useSession();
  if (state.kind === 'loading') return <div className="boot">Opening the Chronicle…</div>;
  if (state.kind === 'needs-mfa') return <SignInPage />;
  if (state.kind !== 'member') return <AccessPage />;
  return <Layout />;
}

/** UI guard only; the database refuses DM operations for everyone else regardless. */
function DmOnly({ children }: { children: ReactNode }) {
  return useIsDm() ? <>{children}</> : <NotFound />;
}

const page = (el: ReactNode) => <Suspense fallback={<p className="muted">Loading…</p>}>{el}</Suspense>;

const router = createBrowserRouter([
  { path: '/sign-in', element: <SignInPage /> },
  {
    element: <Gate />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/wiki/:slug', element: <ArticlePage /> },
      { path: '/browse/:type', element: <BrowsePage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/categories', element: <CategoriesPage /> },
      { path: '/category/:slug', element: <CategoryPage /> },
      { path: '/timeline', element: <TimelinePage /> },
      { path: '/connections', element: <ConnectionsPage /> },
      { path: '/maps', element: page(<MapsPage />) },
      { path: '/maps/:slug', element: page(<MapPage />) },
      {
        path: '/dm',
        element: <DmOnly><Outlet /></DmOnly>,
        children: [
          { index: true, element: page(<DmDesk />) },
          { path: 'new', element: page(<ArticleEditor />) },
          { path: 'edit/:slug', element: page(<ArticleEditor />) },
          { path: 'notes', element: page(<NotesPage />) },
          { path: 'access', element: page(<AccessAdmin />) },
          { path: 'settings', element: page(<SettingsPage />) },
          { path: 'timeline', element: page(<TimelineEditor />) },
          { path: 'maps/new', element: page(<MapEditor />) },
          { path: 'maps/:slug', element: page(<MapEditor />) },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export function App() {
  return (
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  );
}
