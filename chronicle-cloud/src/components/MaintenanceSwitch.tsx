import { useState } from 'react';
import { maintenanceUntil, setMaintenance } from '../lib/maintenance.ts';
import { useLoad } from '../lib/useLoad.ts';

const CHOICES = [
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 480, label: '8 hours' },
];

/** DM: show the maintenance notice to everyone for a while. It always switches itself off. */
export function MaintenanceSwitch() {
  const state = useLoad(maintenanceUntil, []);
  const [error, setError] = useState<string | null>(null);
  const until = state.data;
  const set = async (minutes: number) => {
    setError(null);
    try {
      await setMaintenance(minutes);
      state.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change it.');
    }
  };
  return (
    <section className="panel" aria-labelledby="maint-title" data-testid="maintenance-switch">
      <h2 id="maint-title">Maintenance notice</h2>
      <p className="fine-print">
        Shows everyone the maintenance message at the top of every page. It turns itself off after the time you choose. Deploys and the
        Cloudflare setting can also show it; see MAINTENANCE-NOTICE.md.
      </p>
      <p role="status">{until ? `On until ${until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : 'Off.'}</p>
      <p className="badges-row">
        {CHOICES.map((c) => <button key={c.minutes} type="button" className="button secondary small" onClick={() => void set(c.minutes)}>Show for {c.label}</button>)}
        {until && <button type="button" className="button small" onClick={() => void set(0)}>Turn off now</button>}
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
