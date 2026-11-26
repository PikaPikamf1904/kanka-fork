// DM controls for the Living World: pick a publication time for an approved Gazette story or letter,
// and set the campaign's time zone. Times are read in the campaign zone and stored as exact
// instants; the database releases a story on its own clock.
import { useState } from 'react';
import { ChronicleError } from '../../lib/changeSetTypes.ts';
import { scheduleStory, setCampaignZone } from '../../lib/api.ts';
import { formatInZone, safeZone, utcToZoned, zonedToUtc } from '../../lib/schedule.ts';

/** Tomorrow at 09:00 in the campaign zone, as a datetime-local value. */
function suggested(zone: string): string {
  const tomorrow = new Date(Date.now() + 86_400_000);
  return `${utcToZoned(tomorrow.toISOString(), zone).slice(0, 10)}T09:00`;
}

export function ScheduleControl({ id, version, scheduledAt, zone, disabled, onDone, compact = false }: {
  id: string; version: number; scheduledAt: string | null; zone: string; disabled?: boolean; onDone: (message: string) => void; compact?: boolean;
}) {
  const [value, setValue] = useState(() => (scheduledAt ? utcToZoned(scheduledAt, zone) : suggested(zone)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(at: Date | null, done: string) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await scheduleStory(id, at, version);
      onDone(done);
    } catch (e) {
      setError(e instanceof ChronicleError && e.code === 'CONFLICT' ? 'This story changed somewhere else. Reload and try again.' : e instanceof Error ? e.message : 'Could not change the schedule.');
    } finally {
      setBusy(false);
    }
  }
  const at = zonedToUtc(value, zone);
  return (
    <div className={compact ? 'gz-schedule gz-schedule-compact' : 'gz-schedule'}>
      {scheduledAt && <p className="gz-scheduled" role="status"><span className="badge badge-ok">Scheduled</span> {formatInZone(scheduledAt, zone)}. Players cannot see it until then.</p>}
      <label className="gz-schedule-field">
        <span className="fine-print">{scheduledAt ? 'Move it to' : 'Release on'} ({zone})</span>
        <input type="datetime-local" value={value} step={300} onChange={(ev) => setValue(ev.target.value)} />
      </label>
      <span className="gz-actions">
        <button type="button" className="button small" disabled={disabled || busy || !at}
          onClick={() => {
            if (!at) return;
            if (at.getTime() <= Date.now()) { setError('Choose a time in the future, or print the story now.'); return; }
            void run(at, `Scheduled for ${formatInZone(at.toISOString(), zone)}.`);
          }}>
          {scheduledAt ? 'Reschedule' : 'Schedule'}
        </button>
        {scheduledAt && <button type="button" className="button small secondary" disabled={disabled || busy} onClick={() => void run(null, 'Schedule cancelled. The story is approved and waiting.')}>Cancel schedule</button>}
      </span>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

/** Saves on its own (not part of the settings form). Players never see it. */
export function TimezoneField({ zone, onSaved }: { zone: string; onSaved: (z: string) => void }) {
  const [value, setValue] = useState(zone);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = safeZone(value) === value;
  return (
    <section className="panel" aria-labelledby="tz-title">
      <h2 id="tz-title">Publication time zone</h2>
      <p className="fine-print">Scheduled stories and letters are read in this zone, and “today” for Daily Discovery changes at midnight in it. Use a place name such as America/Chicago or Europe/London.</p>
      <form className="gz-tz" onSubmit={(ev) => {
        ev.preventDefault();
        setMsg(null);
        void setCampaignZone(value).then(() => { onSaved(value); setMsg({ ok: true, text: 'Saved.' }); }, (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' }));
      }}>
        <label>Time zone<input value={value} onChange={(ev) => setValue(ev.target.value.trim())} maxLength={64} list="tz-list" spellCheck={false} /></label>
        <datalist id="tz-list">
          {['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Australia/Sydney'].map((z) => <option key={z} value={z} />)}
        </datalist>
        <button type="submit" className="button small" disabled={!valid || value === zone}>Save time zone</button>
        {!valid && <span className="form-error">Not a recognised zone.</span>}
        {msg && <span className={msg.ok ? 'form-ok' : 'form-error'} role="status">{msg.text}</span>}
      </form>
    </section>
  );
}
