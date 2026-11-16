import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { BannerArt } from '../components/Banner.tsx';
import { enrollWithCode, useSession } from '../lib/session.tsx';

export function AccessPage() {
  const { state, refresh, signOut } = useSession();
  const location = useLocation();
  const here = location.pathname + location.search;
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await enrollWithCode(code, name);
      setCode('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That access code was not accepted.');
    } finally {
      setBusy(false);
    }
  }

  const revoked = state.kind === 'no-access';

  return (
    <div className="access-page">
      <BannerArt className="access-art" />
      <div className="access-card">
        <div className="brand-mark big" aria-hidden="true">✶</div>
        <h1>Chronicle</h1>
        <p className="access-lede">A private campaign wiki. Enter the access code your Dungeon Master gave you.</p>
        {revoked ? (
          <div className="notice" role="alert">
            {state.reason === 'revoked'
              ? 'This device no longer has access. Ask your DM for the current code.'
              : 'This account does not have access to the wiki.'}
            <button type="button" className="button secondary" onClick={() => void signOut()}>Use a code instead</button>
          </div>
        ) : (
          <form onSubmit={submit} className="access-form">
            <label>
              Access code
              <input
                type="password"
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                maxLength={200}
              />
            </label>
            <label>
              Your name at the table
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoComplete="nickname" />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" className="button" disabled={busy}>{busy ? 'Checking…' : 'Enter Chronicle'}</button>
            <p className="fine-print">This device will stay signed in until you leave or the DM removes it.</p>
          </form>
        )}
        <p className="account-link"><Link to={here === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(here)}`}>Sign in with an account</Link></p>
      </div>
    </div>
  );
}
