import { useEffect, useState } from 'react';

/** Shows the maintenance notice while /api/status says so. Silent when the status cannot be read. */
export function MaintenanceNotice() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const check = () => {
      fetch('/api/status', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((s: { notice?: boolean; message?: string | null } | null) => {
          if (live) setMessage(s?.notice && s.message ? s.message : null);
        })
        .catch(() => undefined);
    };
    check();
    const timer = window.setInterval(check, 120_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  if (!message) return null;
  return (
    <div className="maintenance-notice" role="status" data-testid="maintenance-notice">
      <span aria-hidden="true">⚒</span> {message}
    </div>
  );
}
