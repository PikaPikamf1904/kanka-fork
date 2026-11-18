import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { DmPasscode } from '../components/DmPasscode.tsx';
import { useDmGate } from '../lib/dmGate.ts';
import { supabase } from '../lib/supabase.ts';
import { useSession } from '../lib/session.tsx';

/** Where to go after signing in: a same-site path only, never another site. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') && !next.startsWith('/sign-in') ? next : '/';
}

/**
 * Sign-in for the DM: the DM passcode alone (checked on the server, which then opens the DM
 * account's session), then a TOTP step only if two-step sign-in is turned on for that account.
 */
export function SignInPage() {
  const { state, refresh } = useSession();
  const gate = useDmGate();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  // Shown in place (two-step sign-in) the page keeps its own address; from /sign-in, ?next= says
  // where to return, so a sign-in started by an assistant's consent request ends back on it.
  const next = location.pathname === '/sign-in' ? safeNext(params.get('next')) : safeNext(location.pathname + location.search);
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Only a signed-in DM is sent on; a player who opens the DM screen is shown its sign-in.
    if (state.kind === 'member' && state.role === 'dm' && location.pathname === '/sign-in') navigate(next, { replace: true });
  }, [state, navigate, next, location.pathname]);

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const factors = await supabase.auth.mfa.listFactors();
      const factor = factors.data?.totp.find((f) => f.status === 'verified');
      if (!factor) throw new Error('No authenticator is set up for this account.');
      const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp });
      if (err) throw new Error('That code was not accepted.');
      setTotp('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code was not accepted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="access-page">
      <div className="access-card">
        <h1>Dungeon Master</h1>
        {state.kind === 'needs-mfa' ? (
          <form onSubmit={verify} className="access-form">
            <label>
              Code from your authenticator app
              <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={totp} onChange={(e) => setTotp(e.target.value)} required />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" className="button" disabled={busy}>Verify</button>
          </form>
        ) : (
          // The passcode is the whole sign-in: there is no email or password step.
          <DmPasscode
            status={gate.status === 'open' ? 'locked' : gate.status}
            onOpen={async () => {
              await gate.check();
              await refresh();
            }}
          />
        )}
        <p className="account-link"><Link to="/table">Back to who’s at the table</Link></p>
      </div>
    </div>
  );
}
