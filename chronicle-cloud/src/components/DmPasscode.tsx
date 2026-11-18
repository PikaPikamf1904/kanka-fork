import { useState, type FormEvent } from 'react';
import { unlockDmGate, type GateStatus } from '../lib/dmGate.ts';

/** The DM screen lock: a passcode, checked on the server. It sits in front of the DM sign-in. */
export function DmPasscode({ status, onOpen }: { status: GateStatus; onOpen: () => void | Promise<void> }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unlockDmGate(code);
      setCode('');
      await onOpen();
    } catch (err) {
      setCode('');
      setError(err instanceof Error ? err.message : 'That passcode was not accepted.');
    } finally {
      setBusy(false);
    }
  }

  if (status === 'loading') return <p className="access-lede" role="status">Checking the DM screen…</p>;
  if (status === 'unconfigured') {
    return <p className="form-error" role="alert">The DM screen is not set up on this site yet, so the DM cannot sign in here.</p>;
  }
  if (status === 'error') {
    return (
      <div role="alert">
        <p className="form-error">Could not reach the site to check the DM screen.</p>
        <button type="button" className="button secondary" onClick={() => void onOpen()}>Try again</button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="access-form">
      <p className="access-lede">Enter the Dungeon Master passcode.</p>
      <label>
        DM passcode
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          maxLength={64}
        />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="button" disabled={busy}>{busy ? 'Checking…' : 'Open the DM screen'}</button>
    </form>
  );
}
