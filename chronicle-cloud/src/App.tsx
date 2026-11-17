import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { Layout } from './components/Layout.tsx';
import { SessionProvider, useIsDm, useSession } from './lib/session.tsx';
import { DmPasscode } from './components/DmPasscode.tsx';
import { useDmGate } from './lib/dmGate.ts';
import { TablePage } from './pages/AccessPage.tsx';
import { ArticlePage } from './pages/ArticlePage.tsx';
import { BrowsePage, CategoriesPage, CategoryPage, ConnectionsPage, SearchPage, TimelinePage } from './pages/BrowsePages.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { IndexPage } from './pages/IndexPage.tsx';
import { JoinPage } from './pages/JoinPage.tsx';
import { NotFound } from './pages/NotFound.tsx';
import { SignInPage } from './pages/SignInPage.tsx';
import { WanderPage } from './pages/WanderPage.tsx';

// Maps (Leaflet) and DM tools load on demand, so players' first page load stays small.
const MapsPage = lazy(() => import('./pages/MapPages.tsx').then((m) => ({ default: m.MapsPage })));
const MapPage = lazy(() => import('./pages/MapPages.tsx').then((m) => ({ default: m.MapPage })));
const RecentPage = lazy(() => import('./pages/RecentPage.tsx').then((m) => ({ default: m.RecentPage })));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage.tsx').then((m) => ({ default: m.FeedbackPage })));
const FeedbackInbox = lazy(() => import('./pages/dm/FeedbackInbox.tsx').then((m) => ({ default: m.FeedbackInbox })));
const StudioIndex = lazy(() => import('./pages/StudioPages.tsx').then((m) => ({ default: m.StudioIndex })));
const StudioCollection = lazy(() => import('./pages/StudioPages.tsx').then((m) => ({ default: m.StudioCollection })));
const PlayerInsights = lazy(() => import('./pages/dm/PlayerInsights.tsx').then((m) => ({ default: m.PlayerInsights })));
const GraphPage = lazy(() => import('./pages/GraphPage.tsx').then((m) => ({ default: m.GraphPage })));
const FactsPage = lazy(() => import('./pages/FactsPage.tsx').then((m) => ({ default: m.FactsPage })));
const SavedPage = lazy(() => import('./pages/SavedPage.tsx').then((m) => ({ default: m.SavedPage })));
const ScratchpadPage = lazy(() => import('./pages/ScratchpadPage.tsx').then((m) => ({ default: m.ScratchpadPage })));
const JournalPage = lazy(() => import('./pages/JournalPage.tsx').then((m) => ({ default: m.JournalPage })));
const PlayerJournals = lazy(() => import('./pages/dm/PlayerJournals.tsx').then((m) => ({ default: m.PlayerJournals })));
const BoardPage = lazy(() => import('./pages/BoardPage.tsx').then((m) => ({ default: m.BoardPage })));
const MysteriesPage = lazy(() => import('./pages/MysteriesPage.tsx').then((m) => ({ default: m.MysteriesPage })));
const Theories = lazy(() => import('./pages/dm/Theories.tsx').then((m) => ({ default: m.Theories })));
const MysteryStudio = lazy(() => import('./pages/dm/MysteryStudio.tsx').then((m) => ({ default: m.MysteryStudio })));
const FamilyPage = lazy(() => import('./pages/FamilyPage.tsx').then((m) => ({ default: m.FamilyPage })));
const ArticleEditor = lazy(() => import('./pages/dm/ArticleEditor.tsx').then((m) => ({ default: m.ArticleEditor })));
const dm = (name: 'DmDesk' | 'NotesPage' | 'AccessAdmin' | 'SettingsPage' | 'TimelineEditor' | 'MapEditor') =>
  lazy(() => import('./pages/dm/DmPages.tsx').then((m) => ({ default: m[name] })));
const DmDesk = dm('DmDesk');
const ChangeReviewPage = lazy(() => import('./pages/dm/McpPages.tsx').then((m) => ({ default: m.ChangeReviewPage })));
const OAuthConsentPage = lazy(() => import('./pages/dm/McpPages.tsx').then((m) => ({ default: m.OAuthConsentPage })));
const WikiTidy = lazy(() => import('./pages/dm/WikiTidy.tsx').then((m) => ({ default: m.WikiTidy })));
const VisibilityAudit = lazy(() => import('./pages/dm/VisibilityAudit.tsx').then((m) => ({ default: m.VisibilityAudit })));
const MediaLibrary = lazy(() => import('./pages/dm/MediaLibrary.tsx').then((m) => ({ default: m.MediaLibrary })));
const BulkLoreImport = lazy(() => import('./pages/dm/BulkLoreImport.tsx').then((m) => ({ default: m.BulkLoreImport })));
const ImportBatchesPage = lazy(() => import('./pages/dm/ImportPages.tsx').then((m) => ({ default: m.ImportBatchesPage })));
const ImportReviewPage = lazy(() => import('./pages/dm/ImportPages.tsx').then((m) => ({ default: m.ImportReviewPage })));
const gazette = (name: 'GazetteFront' | 'GazetteArchive' | 'GazetteArticle' | 'GazetteDesk' | 'GazetteEditor') =>
  lazy(() => import('./pages/GazettePages.tsx').then((m) => ({ default: m[name] })));
const GazetteFront = gazette('GazetteFront');
const GazetteArchive = gazette('GazetteArchive');
const GazetteArticle = gazette('GazetteArticle');
const GazetteDesk = gazette('GazetteDesk');
const GazetteEditor = gazette('GazetteEditor');
const NotesPage = dm('NotesPage');
const AccessAdmin = dm('AccessAdmin');
const SettingsPage = dm('SettingsPage');
const TimelineEditor = dm('TimelineEditor');
const MapEditor = dm('MapEditor');

function Gate() {
  const { state, refresh } = useSession();
  if (state.kind === 'loading') return <div className="boot">Opening the Chronicle…</div>;
  if (state.kind === 'error') {
    return (
      <div className="boot" role="alert">
        <div>
          <p>Could not reach the wiki. Check your connection.</p>
          <p><button type="button" className="button" onClick={() => void refresh()}>Try again</button></p>
        </div>
      </div>
    );
  }
  if (state.kind === 'needs-mfa') return <SignInPage />;
  if (state.kind !== 'member') return <TablePage />;
  // A DM session also needs this browser to have passed the DM screen (UI lock; the database
  // still refuses DM data to anyone but the DM regardless).
  if (state.role === 'dm') return <DmScreen />;
  return <Layout />;
}

function DmScreen() {
  const { signOut } = useSession();
  const gate = useDmGate();
  if (gate.status === 'open') return <Layout />;
  return (
    <div className="access-page">
      <main className="access-card">
        <div className="brand-mark big" aria-hidden="true">✶</div>
        <h1>Dungeon Master</h1>
        <DmPasscode status={gate.status} onOpen={gate.check} />
        <p className="account-link"><button type="button" className="link-button" onClick={() => void signOut()}>Sign out</button></p>
      </main>
    </div>
  );
}

/** UI guard only; the database refuses DM operations for everyone else regardless. */
function DmOnly({ children }: { children: ReactNode }) {
  return useIsDm() ? <>{children}</> : <NotFound />;
}

const page = (el: ReactNode) => <Suspense fallback={<p className="muted">Loading…</p>}>{el}</Suspense>;

const router = createBrowserRouter([
  { path: '/sign-in', element: <SignInPage /> },
  { path: '/join', element: <JoinPage /> },
  { path: '/table', element: <TablePage /> },
  {
    element: <Gate />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/wiki/:slug', element: <ArticlePage /> },
      { path: '/browse/:type', element: <BrowsePage /> },
      { path: '/a-z', element: <IndexPage /> },
      { path: '/wander', element: <WanderPage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/categories', element: <CategoriesPage /> },
      { path: '/category/:slug', element: <CategoryPage /> },
      { path: '/timeline', element: <TimelinePage /> },
      { path: '/connections', element: <ConnectionsPage /> },
      { path: '/news', element: page(<GazetteFront />) },
      { path: '/news/archive', element: page(<GazetteArchive />) },
      { path: '/news/:slug', element: page(<GazetteArticle />) },
      { path: '/maps', element: page(<MapsPage />) },
      { path: '/maps/:slug', element: page(<MapPage />) },
      { path: '/family/:slug', element: page(<FamilyPage />) },
      { path: '/recent', element: page(<RecentPage />) },
      { path: '/facts', element: page(<FactsPage />) },
      { path: '/graph', element: page(<GraphPage />) },
      { path: '/feedback', element: page(<FeedbackPage />) },
      { path: '/studio', element: page(<StudioIndex />) },
      { path: '/studio/:id', element: page(<StudioCollection />) },
      { path: '/board', element: page(<BoardPage />) },
      { path: '/mysteries', element: page(<MysteriesPage />) },
      { path: '/saved', element: page(<SavedPage />) },
      { path: '/scratchpad', element: page(<ScratchpadPage />) },
      { path: '/journal', element: page(<JournalPage />) },
      {
        path: '/dm',
        element: <DmOnly><Outlet /></DmOnly>,
        children: [
          { index: true, element: page(<DmDesk />) },
          { path: 'new', element: page(<ArticleEditor />) },
          { path: 'import', element: page(<BulkLoreImport />) },
          { path: 'import/batches', element: page(<ImportBatchesPage />) },
          { path: 'import/:batchId', element: page(<ImportReviewPage />) },
          { path: 'review/:previewId', element: page(<ChangeReviewPage />) },
          { path: 'connect', element: page(<OAuthConsentPage />) },
          { path: 'edit/:slug', element: page(<ArticleEditor />) },
          { path: 'news', element: page(<GazetteDesk />) },
          { path: 'news/new', element: page(<GazetteEditor />) },
          { path: 'news/edit/:slug', element: page(<GazetteEditor />) },
          { path: 'tidy', element: page(<WikiTidy />) },
          { path: 'visibility', element: page(<VisibilityAudit />) },
          { path: 'media', element: page(<MediaLibrary />) },
          { path: 'notes', element: page(<NotesPage />) },
          { path: 'theories', element: page(<Theories />) },
          { path: 'mysteries', element: page(<MysteryStudio />) },
          { path: 'journals', element: page(<PlayerJournals />) },
          { path: 'access', element: page(<AccessAdmin />) },
          { path: 'feedback', element: page(<FeedbackInbox />) },
          { path: 'insights', element: page(<PlayerInsights />) },
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
