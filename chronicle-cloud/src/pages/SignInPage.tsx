import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { supabase } from '../lib/supabase.ts';
import { useSession } from '../lib/session.tsx';

/** Where to go after signing in: a same-site path only, never another site. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') && !next.startsWith('/sign-in') ? next : '/';
}

/** Email and password sign-in for named accounts (the DM), with a TOTP step when MFA is enrolled. */
export function SignInPage() {
  const { state, refresh } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  // Shown in place (two-step sign-in) the page keeps its own address; from /sign-in, ?next= says
  // where to return, so a sign-in started by an assistant's consent request ends back on it.
  const next = location.pathname === '/sign-in' ? safeNext(params.get('next')) : safeNext(location.pathname + location.search);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.kind === 'member' && location.pathname === '/sign-in') navigate(next, { replace: true });
  }, [state, navigate, next, location.pathname]);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setPassword('');
    setBusy(false);
    if (err) setError('Those details were not accepted.');
    else await refresh();
  }

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
        <h1>Sign in</h1>
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
          <form onSubmit={signIn} className="access-form">
            <label>
              Email
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" className="button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        )}
        <p className="account-link"><Link to="/">Use an access code instead</Link></p>
      </div>
    </div>
  );
}
