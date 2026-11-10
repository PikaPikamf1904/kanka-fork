import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { approvePreview, ChronicleError, type Diff, type Preview } from '../../lib/changeSets.ts';
import { supabase } from '../../lib/supabase.ts';
import { useLoad } from '../../lib/useLoad.ts';

interface StoredPreview { id: string; client_id: string; label: string; result: Preview; created_at: string; expires_at: string; approved_at: string | null; consumed_at: string | null }

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '(nothing)';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.body === 'string') return `${typeof o.heading === 'string' && o.heading ? `${o.heading}: ` : ''}${o.body}`;
    if (typeof o.kind === 'string') return `${o.kind}${typeof o.target_slug === 'string' ? ` → ${o.target_slug}` : ''}${typeof o.label === 'string' && o.label ? ` (${o.label})` : ''}`;
    return JSON.stringify(v);
  }
  return String(v);
};
const VERB: Record<Diff['operation'], string> = { create: 'Add', patch: 'Change', remove: 'Remove', restore: 'Restore' };

/**
 * Where the DM reads and approves changes proposed by a connected assistant. Approving here is
 * the only way such changes can be saved; the assistant cannot approve for itself.
 */
export function ChangeReviewPage() {
  const { previewId = '' } = useParams();
  const preview = useLoad(async () => {
    const { data, error } = await supabase.from('change_previews').select('id, client_id, label, result, created_at, expires_at, approved_at, consumed_at').eq('id', previewId).maybeSingle();
    if (error) throw new Error('Could not load this review.');
    const row = data as StoredPreview | null;
    return row ? { ...row, expired: new Date(row.expires_at).getTime() <= Date.now() } : null;
  }, [previewId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (preview.loading) return <p className="muted">Loading…</p>;
  const p = preview.data;
  if (!p) return (<div><h1 className="page-title">Review not found</h1><p>This review does not exist, has expired, or was proposed for a different account.</p><p><Link to="/dm">Back to the DM desk</Link></p></div>);
  const expired = p.expired;
  const r = p.result;
  const targets = [...new Set(r.diffs.map((d) => d.target))];

  async function approve() {
    setBusy(true); setError('');
    try {
      await approvePreview(p!.id);
      preview.reload();
    } catch (err) {
      setError(err instanceof ChronicleError ? err.message : 'Could not approve.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="muted"><Link to="/dm">DM desk</Link> › Review proposed changes</p>
      <h1 className="page-title">{p.label || 'Proposed changes'}</h1>
      <section className="panel">
        <p>
          A connected assistant proposes the changes below. <strong>Nothing has been saved.</strong> If you approve, the assistant may save exactly these changes,
          all together, as private drafts. Nothing is published, and you can undo each page from its history.
        </p>
        <p className="muted" data-testid="review-status">
          {p.consumed_at ? 'These changes have been saved.' : p.approved_at ? 'Approved. Waiting for the assistant to save them.' : expired ? 'This review has expired. Ask the assistant to propose the changes again.' : `Waiting for your decision · expires ${new Date(p.expires_at).toLocaleTimeString()}`}
        </p>
        {r.warnings.length > 0 && (
          <ul className="fine-print">{r.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        )}
      </section>

      {targets.map((slug) => (
        <section className="panel" key={slug}>
          <h2>{r.created.includes(slug) ? 'New page: ' : 'Page: '}<code>{slug}</code></h2>
          <div className="table-scroll">
            <table className="table review-table">
              <thead><tr><th scope="col">Change</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
              <tbody>
                {r.diffs.filter((d) => d.target === slug).map((d, i) => (
                  <tr key={i}>
                    <td>{VERB[d.operation]} {d.field}</td>
                    <td className="review-cell">{show(d.before)}</td>
                    <td className="review-cell">{show(d.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {r.skipped.length > 0 && <p className="fine-print">Left alone because they already exist: {[...new Set(r.skipped)].join(', ')}.</p>}

      {error && <p className="form-error" role="alert">{error}</p>}
      {!p.approved_at && !p.consumed_at && !expired && (
        <p>
          <button type="button" className="button" disabled={busy} onClick={() => void approve()}>{busy ? 'Approving…' : 'Approve these changes'}</button>{' '}
          <span className="muted">To refuse, simply leave this page. The proposal expires by itself.</span>
        </p>
      )}
    </div>
  );
}

/**
 * Consent screen for the Supabase Auth OAuth server: shown when an assistant (an MCP client)
 * asks to connect to Chronicle as the signed-in DM.
 */
export function OAuthConsentPage() {
  const [params] = useSearchParams();
  const authorizationId = params.get('authorization_id') ?? '';
  const details = useLoad(async () => {
    if (!authorizationId) return null;
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error) throw new Error('This connection request is not valid or has expired.');
    if (data && 'redirect_url' in data) {
      window.location.assign(data.redirect_url);
      return null;
    }
    return data;
  }, [authorizationId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function decide(allow: boolean) {
    setBusy(true); setError('');
    const { data, error: err } = allow
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (err || !data) {
      setError('Could not complete the request. Start the connection again from the assistant.');
      setBusy(false);
      return;
    }
    window.location.assign(data.redirect_url);
  }

  if (!authorizationId) return <p role="alert">This page is opened by an assistant asking to connect. There is nothing to approve right now.</p>;
  if (details.loading) return <p className="muted">Loading…</p>;
  if (details.error || !details.data) return <p className="form-error" role="alert">{details.error ?? 'This connection request is not valid or has expired.'}</p>;
  const d = details.data;
  return (
    <div>
      <h1 className="page-title">Connect an assistant to Chronicle</h1>
      <section className="panel">
        <p><strong>{d.client.name}</strong> is asking to connect to this wiki as you.</p>
        <p>If you allow it, it can:</p>
        <ul>
          <li>read everything you can read, including DM-only pages and notes;</li>
          <li>propose new private drafts and edits, which are saved only after you approve each proposal here in Chronicle.</li>
        </ul>
        <p>It cannot publish, delete pages, change player access, or see your password.</p>
        <p className="fine-print">It will be sent back to: <code>{d.redirect_uri}</code>. Only allow this if you started the connection yourself.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <p>
          <button type="button" className="button" disabled={busy} onClick={() => void decide(true)}>Allow</button>{' '}
          <button type="button" className="button secondary" disabled={busy} onClick={() => void decide(false)}>Refuse</button>
        </p>
      </section>
    </div>
  );
}
