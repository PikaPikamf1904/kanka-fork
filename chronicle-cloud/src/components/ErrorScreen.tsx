import { Component, useEffect, useState, type ReactNode } from 'react';
import { useRouteError } from 'react-router';
import { isChunkLoadError, recoverFromStaleBuild, reloadNow } from '../lib/chunkRecovery.ts';

/**
 * Shown instead of a page that failed to load or crashed. For an out-of-date copy of the app (the
 * reader had Chronicle open during a release) it first tries to load the current copy by itself,
 * once; only when that is not possible does the reader see the message and its buttons. It never
 * shows a stack trace, and it looks the same for the DM and for players.
 */
export function ErrorScreen({ error }: { error: unknown }) {
  const stale = isChunkLoadError(error);
  const [state, setState] = useState<'checking' | 'failed'>(stale ? 'checking' : 'failed');

  useEffect(() => {
    if (!stale) {
      console.error(error);
      return;
    }
    let live = true;
    void recoverFromStaleBuild().then((r) => { if (live && r === 'gave-up') setState('failed'); });
    return () => { live = false; };
  }, [stale, error]);

  if (state === 'checking') {
    return (
      <div className="error-screen" role="status">
        <p className="error-screen-title">Updating Chronicle…</p>
        <p className="muted">A newer version is available. This takes a moment.</p>
      </div>
    );
  }
  return (
    <div className="error-screen" role="alert" data-testid="error-screen">
      <h1 className="page-title">{stale ? 'This page could not be loaded' : 'Something went wrong'}</h1>
      <p>
        {stale
          ? 'Chronicle may have just been updated, or your connection dropped. Reloading usually fixes it.'
          : 'This page ran into a problem. Reloading usually fixes it.'}
        {' '}Nothing you saved has been lost.
      </p>
      <p className="error-screen-actions">
        <button type="button" className="button" onClick={reloadNow}>Reload the page</button>
        {/* A normal link would stay inside this out-of-date copy; a full page load fetches the current one. */}
        <a className="button secondary" href="/">Go to the main page</a>
      </p>
      {stale && error instanceof Error && (
        <details className="error-screen-details">
          <summary>Technical details</summary>
          <code>{error.message.slice(0, 300)}</code>
        </details>
      )}
    </div>
  );
}

/** The router's error page: a page that failed to load or crashed while rendering. */
export function RouteError() {
  return <ErrorScreen error={useRouteError()} />;
}

/** Last resort around the whole app, for a crash outside any page. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: unknown; failed: boolean }> {
  override state = { error: null as unknown, failed: false };
  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }
  override render() {
    return this.state.failed ? <ErrorScreen error={this.state.error} /> : this.props.children;
  }
}
