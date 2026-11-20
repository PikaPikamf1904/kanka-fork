import { useEffect, useState } from 'react';
import { MAINTENANCE_CHANGED, MAINTENANCE_NOTICE, maintenanceUntil } from '../lib/maintenance.ts';

/**
 * Shows the maintenance notice while /api/status says so (Pages switch, deploys) or the DM's own
 * website switch is on. Silent when neither can be read. The DM's switch is only readable by
 * members, so the first screen (signed out) passes `memberSwitch={false}` and asks /api/status only.
 * Open pages re-check every 2 minutes, when the tab becomes visible again, and at once on the DM's
 * own page when the DM flips the switch.
 */
export function MaintenanceNotice({ memberSwitch = true }: { memberSwitch?: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const check = () => {
      // A hidden tab shows nothing, so it asks nothing; it checks again when it becomes visible.
      if (document.visibilityState === 'hidden') return;
      const server = fetch('/api/status', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((s: { notice?: boolean; message?: string | null } | null) => (s?.notice && s.message ? s.message : null))
        .catch(() => null);
      const dmSwitch = memberSwitch ? maintenanceUntil().then((until) => (until ? MAINTENANCE_NOTICE : null)).catch(() => null) : Promise.resolve(null);
      void Promise.all([server, dmSwitch]).then(([a, b]) => {
        if (live) setMessage(a ?? b);
      });
    };
    check();
    const timer = window.setInterval(check, 120_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(MAINTENANCE_CHANGED, check);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(MAINTENANCE_CHANGED, check);
    };
  }, [memberSwitch]);
  if (!message) return null;
  return (
    <div className="maintenance-notice" role="status" data-testid="maintenance-notice">
      <span aria-hidden="true">⚒</span> {message}
    </div>
  );
}
