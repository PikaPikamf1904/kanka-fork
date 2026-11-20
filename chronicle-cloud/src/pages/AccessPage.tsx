import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { BannerArt } from '../components/Banner.tsx';
import { MaintenanceNotice } from '../components/MaintenanceNotice.tsx';
import { savedAccounts } from '../lib/accounts.ts';
import { enrollWithCode, useSession } from '../lib/session.tsx';
import { SEATS, accountForSeat, accountMatchesSeat, type Seat } from '../lib/table.ts';

type Choice = { kind: 'none' } | { kind: 'seat'; seat: Seat } | { kind: 'other' };

/**
 * The first screen: who's at the table? Choosing a seat never signs anyone in by itself. A player
 * continues from their own earlier sign-in on this device, or proves themselves with the table
 * code (or their invitation link). The DM goes on to the DM passcode and the DM's own account.
 * Also reachable as /table to switch players on a shared device.
 */
export function TablePage() {
  const { state, refresh, signOut, switchAccount } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  // After the DM signs in, return to where the visitor was going (an assistant's consent request, say).
  const here = location.pathname === '/table' ? '/' : location.pathname + location.search;
  const accounts = savedAccounts();
  const [choice, setChoice] = useState<Choice>({ kind: 'none' });
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Saved sign-ins that match no seat (a guest, or a name spelled differently) stay reachable.
  const others = accounts.filter((a) => !SEATS.some((seat) => accountMatchesSeat(a, seat)));
  const signedIn = state.kind === 'member' ? state : null;
  const revoked = state.kind === 'no-access';

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not continue.');
    } finally {
      setBusy(false);
    }
  }

  const pickSeat = (seat: Seat) => {
    setError(null);
    const saved = accountForSeat(accounts, seat);
    if (saved) {
      if (signedIn?.userId === saved.userId) { navigate('/'); return; }
      void run(async () => {
        await switchAccount(saved.userId);
        navigate('/');
      });
    } else {
      setChoice({ kind: 'seat', seat });
    }
  };

  async function submit(e: FormEvent, displayName: string) {
    e.preventDefault();
    await run(async () => {
      await enrollWithCode(code, displayName);
      setCode('');
      await refresh();
      navigate('/');
    });
  }

  return (
    <div className="access-page">
      <BannerArt className="access-art" />
      <div className="access-notice"><MaintenanceNotice memberSwitch={false} /></div>
      <main className="access-card table-card-wrap">
        <div className="brand-mark big" aria-hidden="true">✶</div>
        <h1 className="table-title">Who’s at the table?</h1>
        {signedIn && <p className="access-lede">Signed in as {signedIn.displayName}. Choose someone to switch.</p>}
        {!signedIn && <p className="access-lede">Pick your name to continue. Your DM’s invitation link also works.</p>}

        <ul className="table-seats" aria-label="Seats at the table">
          {SEATS.map((seat) => {
            const saved = accountForSeat(accounts, seat);
            const current = !!saved && signedIn?.userId === saved.userId;
            return (
              <li key={seat.id}>
                <button
                  type="button"
                  className={`table-seat${current ? ' current' : ''}`}
                  aria-label={`${seat.player}, playing ${seat.character}`}
                  aria-pressed={choice.kind === 'seat' && choice.seat.id === seat.id}
                  disabled={busy}
                  onClick={() => pickSeat(seat)}
                >
                  <span className="seat-name">{seat.player}</span>
                  <span className="seat-character">{seat.character}</span>
                  <span className="seat-note">{current ? 'This is you' : saved ? 'Signed in on this device' : 'Tap to join'}</span>
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              className="table-seat dm"
              aria-label="Dungeon Master"
              disabled={busy}
              onClick={() => navigate(signedIn?.role === 'dm' ? '/' : `/sign-in?next=${encodeURIComponent(here)}`)}
            >
              <span className="seat-name">Dungeon Master</span>
              <span className="seat-character">The DM screen</span>
              <span className="seat-note">Passcode and sign-in</span>
            </button>
          </li>
        </ul>

        {others.length > 0 && (
          <div className="account-switch" role="group" aria-label="Others on this device">
            {others.map((a) => (
              <button
                key={a.userId}
                type="button"
                className="button secondary"
                disabled={busy || signedIn?.userId === a.userId}
                onClick={() => void run(async () => { await switchAccount(a.userId); navigate('/'); })}
              >
                Continue as {a.name}
              </button>
            ))}
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        {revoked && (
          <div className="notice" role="alert">
            {state.kind === 'no-access' && state.reason === 'revoked'
              ? 'This device no longer has access. Ask your DM for a new invitation link.'
              : 'This account does not have access to the wiki.'}
            <button type="button" className="button secondary" onClick={() => void signOut()}>Start again</button>
          </div>
        )}

        {choice.kind === 'seat' && (
          <form className="access-form table-join" onSubmit={(e) => void submit(e, choice.seat.player)} aria-label={`Join as ${choice.seat.player}`}>
            <h2>Join as {choice.seat.player}</h2>
            <p className="fine-print">
              {choice.seat.player} is not signed in on this device yet. Open the invitation link your DM sent
              you, or enter the table code.
            </p>
            <label>
              Table code
              <input type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={200} />
            </label>
            <button type="submit" className="button" disabled={busy}>{busy ? 'Checking…' : `Enter as ${choice.seat.player}`}</button>
            <p className="fine-print">This device will stay signed in until you leave or the DM removes it.</p>
          </form>
        )}

        {choice.kind === 'other' && (
          <form className="access-form table-join" onSubmit={(e) => void submit(e, name)} aria-label="Join under another name">
            <h2>Someone else</h2>
            <label>
              Access code
              <input type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={200} />
            </label>
            <label>
              Your name at the table
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoComplete="nickname" />
            </label>
            <button type="submit" className="button" disabled={busy}>{busy ? 'Checking…' : 'Enter Chronicle'}</button>
          </form>
        )}

        {choice.kind !== 'other' && !revoked && (
          <p className="account-link">
            <button type="button" className="link-button" onClick={() => { setError(null); setChoice({ kind: 'other' }); }}>
              Someone else? Use an access code
            </button>
          </p>
        )}
      </main>
    </div>
  );
}
