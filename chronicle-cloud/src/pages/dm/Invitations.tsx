import { useState, type FormEvent } from 'react';
import { listMembers, revokeMember } from '../../lib/api.ts';
import {
  cancelInvitation, createInvitation, invitationStatus, inviteAnotherDevice, inviteLink, listDevices, listInvitations,
  regenerateInvitation, signOutDevice, type Invitation, type MemberDevice, type NewInvitation,
} from '../../lib/invitations.ts';
import { useLoad } from '../../lib/useLoad.ts';

const SUGGESTED = ['Eliza', 'Sybil', 'Charity', 'Weston'];
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function ShareLink({ made, onClose }: { made: NewInvitation; onClose: () => void }) {
  const link = inviteLink(made.token);
  const [copied, setCopied] = useState(false);
  return (
    <div className="notice" role="status" data-testid="new-invite">
      <p><strong>Link for {made.display_name}</strong>, valid until {when(made.expires_at)}. It works once and is shown only now.</p>
      <div className="invite-link">
        <input readOnly value={link} aria-label={`Invitation link for ${made.display_name}`} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="button small" onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}>{copied ? 'Copied' : 'Copy link'}</button>
        {typeof navigator.share === 'function' && (
          <button type="button" className="button secondary small" onClick={() => void navigator.share({ title: 'Chronicle invitation', url: link }).catch(() => undefined)}>Share…</button>
        )}
        <button type="button" className="link-button" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

/** DM: one personal link per player. The first link creates the player; later links add devices. */
export function InvitationsPanel() {
  const invites = useLoad(listInvitations, []);
  const devices = useLoad(listDevices, []);
  const members = useLoad(listMembers, []);
  const [name, setName] = useState('');
  const [days, setDays] = useState(7);
  const [made, setMade] = useState<NewInvitation | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (invites.data === null) return null; // the invitations migration is not installed yet

  const reload = () => { invites.reload(); devices.reload(); members.reload(); };
  async function act(what: string, work: () => Promise<NewInvitation | void>) {
    setError(null);
    try {
      const result = await work();
      if (result) setMade(result);
      reload();
    } catch (err) {
      setError(`${what} did NOT happen${err instanceof Error ? `: ${err.message}` : ''}.`);
    }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    await act('Creating the link', () => createInvitation(n, days));
    setName('');
  }

  const all: Invitation[] = invites.data ?? [];
  // Players who joined with an access code appear only in the member list below.
  const invited = new Set([...all.map((i) => i.member_user_id), ...(devices.data ?? []).map((d) => d.user_id)]);
  const everyPlayer = (members.data ?? []).filter((m) => m.role === 'player');
  const players = everyPlayer.filter((m) => invited.has(m.user_id));
  const pendingNew = all.filter((i) => !i.member_user_id && invitationStatus(i) === 'waiting');
  const devicesOf = (userId: string): MemberDevice[] => (devices.data ?? []).filter((d) => d.user_id === userId);
  const openLinkFor = (userId: string) => all.find((i) => i.member_user_id === userId && invitationStatus(i) === 'waiting');
  const missing = SUGGESTED.filter((s) => !everyPlayer.some((p) => p.display_name.toLowerCase() === s.toLowerCase()) && !pendingNew.some((i) => i.display_name.toLowerCase() === s.toLowerCase()));

  return (
    <section className="panel" aria-labelledby="invites-title">
      <h2 id="invites-title">Invite players</h2>
      <p className="fine-print">
        Each player gets a personal link: no email or password. The first link creates the player; a new link for the same player
        adds another device to the same account, so their journal and notes follow them. Links work once and expire. Only the link
        proves who someone is, never a name.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {made && <ShareLink made={made} onClose={() => setMade(null)} />}
      <form className="form-grid" onSubmit={create}>
        <label>Player name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required list="invite-names" /></label>
        <datalist id="invite-names">{missing.map((m) => <option key={m} value={m} />)}</datalist>
        <label>Link lasts
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
          </select>
        </label>
        <button type="submit" className="button small">Create invitation link</button>
      </form>
      {missing.length > 0 && (
        <p className="badges-row">
          {missing.map((m) => (
            <button key={m} type="button" className="chip" onClick={() => void act(`Inviting ${m}`, () => createInvitation(m, days))}>Invite {m}</button>
          ))}
        </p>
      )}

      <table className="table" data-testid="invite-table">
        <thead><tr><th>Player</th><th>Status</th><th>Devices</th><th /></tr></thead>
        <tbody>
          {pendingNew.map((i) => (
            <tr key={i.id}>
              <td>{i.display_name}</td>
              <td>Invited · link valid until {when(i.expires_at)}</td>
              <td>—</td>
              <td>
                <button type="button" className="link-button" onClick={() => void act('Making a new link', () => regenerateInvitation(i.id, days))}>New link</button>{' · '}
                <button type="button" className="link-button" onClick={() => { if (window.confirm(`Cancel ${i.display_name}'s link?`)) void act('Cancelling the link', () => cancelInvitation(i.id)); }}>Cancel link</button>
              </td>
            </tr>
          ))}
          {players.map((p) => {
            const ds = devicesOf(p.user_id);
            const active = ds.filter((d) => !d.revoked_at);
            const open = openLinkFor(p.user_id);
            return (
              <tr key={p.user_id}>
                <td>{p.display_name}</td>
                <td>
                  {p.revoked_at ? 'Removed' : 'Active'}
                  {open && <span className="muted"> · device link valid until {when(open.expires_at)}</span>}
                </td>
                <td>
                  {ds.length === 0 ? <span className="muted">—</span> : (
                    <ul className="device-list">
                      {ds.map((d) => (
                        <li key={d.id}>
                          <span>{d.label}</span>
                          <span className="muted">since {when(d.created_at)} · last seen {when(d.last_seen_at)}</span>
                          {d.revoked_at ? <span className="muted">signed out</span> : !p.revoked_at && (
                            <button type="button" className="link-button" onClick={() => { if (window.confirm(`Sign ${p.display_name} out on ${d.label}? Other devices stay signed in.`)) void act('Signing the device out', () => signOutDevice(d.id)); }}>
                              Sign out this device
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {active.length > 1 && <span className="muted">{active.length} devices</span>}
                </td>
                <td>
                  {!p.revoked_at && (
                    <>
                      <button type="button" className="link-button" onClick={() => void act('Making a device link', () => inviteAnotherDevice(p.user_id, days))}>
                        {open ? 'Replace device link' : 'Link for another device'}
                      </button>
                      {open && <>{' · '}<button type="button" className="link-button" onClick={() => void act('Cancelling the link', () => cancelInvitation(open.id))}>Cancel link</button></>}
                      {' · '}
                      <button type="button" className="link-button" onClick={() => { if (window.confirm(`Remove ${p.display_name} from the campaign? Every device of theirs loses access immediately.`)) void act(`Removing ${p.display_name}`, () => revokeMember(p.user_id)); }}>
                        Remove player
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {all.some((i) => invitationStatus(i) === 'expired' && !i.member_user_id) && (
        <details>
          <summary>Expired links</summary>
          <ul>{all.filter((i) => invitationStatus(i) === 'expired' && !i.member_user_id).map((i) => (
            <li key={i.id}>{i.display_name}, expired {when(i.expires_at)} <button type="button" className="link-button" onClick={() => void act('Making a new link', () => regenerateInvitation(i.id, days))}>New link</button></li>
          ))}</ul>
        </details>
      )}
    </section>
  );
}
