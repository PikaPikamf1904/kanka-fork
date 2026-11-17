import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BannerArt } from '../components/Banner.tsx';
import { acceptInvitation, previewInvitation } from '../lib/invitations.ts';
import { useSession } from '../lib/session.tsx';

type Step =
  | { kind: 'checking' }
  | { kind: 'welcome'; name: string; returning: boolean }
  | { kind: 'joining'; name: string }
  | { kind: 'not-me' }
  | { kind: 'failed'; message: string };

/**
 * Read the token from the address and take it out of the address bar and history. Cached, so a
 * second render (React StrictMode) still sees it after the address was cleaned.
 */
let taken: string | null = null;
function takeToken(): string {
  const fromHash = window.location.hash.replace(/^#/, '').trim().toLowerCase();
  if (fromHash) {
    taken = fromHash;
    window.history.replaceState(null, '', window.location.pathname);
  }
  const token = taken ?? '';
  return /^[0-9a-f]{64}$/.test(token) ? token : '';
}

/** /join#<token>: the personal invitation link from the DM. */
export function JoinPage() {
  const { state, refresh } = useSession();
  const navigate = useNavigate();
  const [token] = useState(takeToken);
  const [step, setStep] = useState<Step>(() => (token ? { kind: 'checking' } : { kind: 'failed', message: 'This link is incomplete. Open the whole link your DM sent you.' }));

  useEffect(() => {
    if (!token) return;
    let live = true;
    previewInvitation(token)
      .then((p) => { if (live) setStep({ kind: 'welcome', name: p.displayName, returning: p.returning }); })
      .catch((err: unknown) => { if (live) setStep({ kind: 'failed', message: err instanceof Error ? err.message : 'This invitation link cannot be used.' }); });
    return () => { live = false; };
  }, [token]);

  async function join(name: string) {
    setStep({ kind: 'joining', name });
    try {
      await acceptInvitation(token);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setStep({ kind: 'failed', message: err instanceof Error ? err.message : 'Could not join. Please try again.' });
    }
  }

  const signedInAs = state.kind === 'member' ? state.displayName : null;

  return (
    <div className="access-page">
      <BannerArt className="access-art" />
      <main className="access-card join-card" aria-live="polite">
        <div className="brand-mark big" aria-hidden="true">✶</div>
        {step.kind === 'checking' && <p className="access-lede" role="status">Checking your invitation…</p>}
        {(step.kind === 'welcome' || step.kind === 'joining') && (
          <>
            <h1>Welcome, {step.name}</h1>
            <p className="access-lede">
              {step.kind === 'welcome' && step.returning
                ? 'This link adds this device to your place in the Chronicle.'
                : 'Your Dungeon Master has invited you to the Chronicle, the campaign’s archive.'}
            </p>
            {signedInAs && signedInAs !== step.name && (
              <p className="notice">This device is signed in as {signedInAs}. Joining adds {step.name} too; you can switch between them from the menu.</p>
            )}
            <div className="join-actions">
              <button type="button" className="button" disabled={step.kind === 'joining'} onClick={() => void join(step.name)}>
                {step.kind === 'joining' ? 'Opening the Chronicle…' : `I’m ${step.name}, let me in`}
              </button>
              <button type="button" className="button secondary" disabled={step.kind === 'joining'} onClick={() => setStep({ kind: 'not-me' })}>
                This isn’t me
              </button>
            </div>
            <p className="fine-print">No email or password is needed. This device stays signed in until you leave it or the DM signs it out.</p>
          </>
        )}
        {step.kind === 'not-me' && (
          <>
            <h1>No problem</h1>
            <p className="access-lede">This link belongs to someone else. Close this page and ask your DM for your own link.</p>
          </>
        )}
        {step.kind === 'failed' && (
          <>
            <h1>This link didn’t work</h1>
            <p className="form-error" role="alert">{step.message}</p>
            <p className="account-link"><Link to="/">Go to the Chronicle</Link></p>
          </>
        )}
      </main>
    </div>
  );
}
