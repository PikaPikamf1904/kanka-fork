import { useEffect } from 'react';
import { useBlocker } from 'react-router';

/**
 * Asks before leaving a page with unsaved changes: in-app navigation to another page, and closing
 * or reloading the tab. Pass false while a save is in flight so the save's own redirect is not
 * blocked.
 */
export function useUnsavedGuard(active: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => active && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('You have unsaved changes. Leave without saving?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    if (!active) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [active]);
}
