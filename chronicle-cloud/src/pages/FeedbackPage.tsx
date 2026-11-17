import { useState, type FormEvent } from 'react';
import { CATEGORIES, categoryLabel, myFeedback, sendFeedback, STATUS_LABELS, type FeedbackCategory } from '../lib/feedback.ts';
import { useSession } from '../lib/session.tsx';
import { useLoad } from '../lib/useLoad.ts';

/** Feedback Center: honest feedback to the DM, signed or anonymous. */
export function FeedbackPage() {
  const { state } = useSession();
  const userId = state.kind === 'member' ? state.userId : '';
  const mine = useLoad(() => (userId ? myFeedback(userId) : Promise.resolve([])), [userId]);
  const [category, setCategory] = useState<FeedbackCategory | ''>('');
  const [body, setBody] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (mine.data === null) {
    return (
      <div>
        <h1 className="page-title">Feedback</h1>
        <p className="muted">Feedback is not available on this site yet.</p>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!category) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      await sendFeedback(category, body, anonymous);
      setBody('');
      setSent(anonymous ? 'Sent anonymously. Thank you for telling the DM.' : 'Sent. Thank you! You can see it, and any reply, below.');
      if (!anonymous) mine.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send it. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const hint = CATEGORIES.find((c) => c.value === category)?.hint;

  return (
    <div className="feedback-page">
      <h1 className="page-title">Feedback</h1>
      <p className="muted">
        Tell the DM what is working, what isn’t, and anything you would like to change, about the campaign or this website. There are no wrong
        answers. Only the DM reads feedback; it never appears anywhere else on the site.
      </p>

      <form className="panel feedback-form" onSubmit={submit}>
        <label>
          What is it about?
          <select value={category} onChange={(e) => setCategory(e.target.value as FeedbackCategory)} required>
            <option value="" disabled>Choose one…</option>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        {hint && <p className="fine-print">{hint}</p>}
        {category === 'comfort' && (
          <p className="notice">Thank you for raising it. You don’t need to explain or justify anything; a few words are enough.</p>
        )}
        <label>
          Your message
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={5000} required />
        </label>
        <fieldset className="feedback-mode">
          <legend>How would you like to send it?</legend>
          <label className="radio">
            <input type="radio" name="mode" checked={!anonymous} onChange={() => setAnonymous(false)} />
            <span><strong>With my name</strong> — the DM knows it is from you and can reply here.</span>
          </label>
          <label className="radio">
            <input type="radio" name="mode" checked={anonymous} onChange={() => setAnonymous(true)} />
            <span><strong>Anonymously</strong> — no name, and no reply is possible.</span>
          </label>
        </fieldset>
        {anonymous && (
          <p className="fine-print" data-testid="anonymity-note">
            Chronicle does not attach your name or account and does not store who sent this or the time (only the date). Please know the limits:
            your writing style or the details you mention may still give you away, and the hosting providers keep ordinary request logs, so
            complete anonymity cannot be promised.
          </p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        {sent && <p className="form-ok" role="status">{sent}</p>}
        <button type="submit" className="button" disabled={busy || !category || !body.trim()}>{busy ? 'Sending…' : 'Send to the DM'}</button>
      </form>

      <section className="panel" aria-labelledby="my-feedback">
        <h2 id="my-feedback">Feedback you signed</h2>
        {mine.loading && <p className="muted" role="status">Loading…</p>}
        {mine.data && mine.data.length === 0 && <p className="muted">Nothing yet. Anonymous feedback is not listed here.</p>}
        {mine.data && mine.data.length > 0 && (
          <ul className="feedback-list">
            {mine.data.map((f) => (
              <li key={f.id}>
                <div className="badges-row">
                  <span className="badge">{categoryLabel(f.category)}</span>
                  <span className="muted">{new Date(f.submitted_on).toLocaleDateString()} · {STATUS_LABELS[f.status]}</span>
                </div>
                <p className="feedback-body">{f.body}</p>
                {f.reply && <p className="feedback-reply"><strong>DM’s reply:</strong> {f.reply}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
