import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArticleCard } from '../../components/ArticleCard.tsx';
import { StatusBadge, VisibilityBadge } from '../../components/Badges.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { MediaImage } from '../../components/MediaImage.tsx';
import {
  createAccessCode, deleteNote, deleteTimelineEvent, getMap, getSettings, listAccessCodes, listAllArticleRefs, listDrafts,
  listMaps, listMembers, listNotes, renameMember, revokeAccessCode, revokeAllPlayers, revokeMember, saveMap, saveNote,
  saveTimelineEvent, setMediaVisibility, timeline, updateSettings, uploadMedia,
} from '../../lib/api.ts';
import { MAX_MAP_IMAGE, prepareImage } from '../../lib/image.ts';
import { slugify } from '../../lib/slug.ts';
import { TEMPLATES, TYPE_ORDER } from '../../lib/templates.ts';
import type { PublishStatus, TimelineEvent, Visibility, WikiMap } from '../../lib/types.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { NotFound } from '../NotFound.tsx';
import { supabase } from '../../lib/supabase.ts';

export function DmDesk() {
  const drafts = useLoad(listDrafts, []);
  const notes = useLoad(listNotes, []);
  return (
    <div>
      <h1 className="page-title">DM desk</h1>
      <section className="panel">
        <h2>Create</h2>
        <div className="chip-cloud">
          {TYPE_ORDER.map((t) => (
            <Link key={t} className="chip" to={`/dm/new?type=${t}`}><span aria-hidden="true">{TEMPLATES[t].glyph} </span>New {TEMPLATES[t].label.toLowerCase()}</Link>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Drafts and DM-only pages</h2>
        <p className="fine-print">Players cannot see anything in this list.</p>
        {drafts.data?.length === 0 && <p className="muted">Everything is published.</p>}
        <div className="card-grid">{drafts.data?.map((a) => <ArticleCard key={a.id} article={a} showState />)}</div>
      </section>
      <section className="panel">
        <h2>Recent private notes</h2>
        <ul>
          {notes.data?.slice(0, 8).map((n) => (
            <li key={n.id}>{n.title || 'Untitled'}{n.article && <> · <Link to={`/dm/edit/${n.article.slug}`}>{n.article.title}</Link></>}</li>
          ))}
        </ul>
        <Link to="/dm/notes" className="more-link">All notes →</Link>
      </section>
    </div>
  );
}

export function NotesPage() {
  const notes = useLoad(listNotes, []);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  return (
    <div>
      <h1 className="page-title">Private notes <VisibilityBadge visibility="dm" /></h1>
      <section className="panel form-grid">
        <h2>New note</h2>
        <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="span-2">Note<textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></label>
        <button type="button" className="button small" disabled={!body.trim()} onClick={async () => { await saveNote({ article_id: null, title, body }); setTitle(''); setBody(''); notes.reload(); }}>Save note</button>
      </section>
      {notes.data?.map((n) => (
        <section key={n.id} className="panel dm-panel">
          <h2>{n.title || 'Untitled note'}</h2>
          {n.article && <p className="muted">About <Link to={`/wiki/${n.article.slug}`}>{n.article.title}</Link></p>}
          <Markdown text={n.body} />
          <button type="button" className="link-button" onClick={async () => { if (window.confirm('Delete this note?')) { await deleteNote(n.id); notes.reload(); } }}>Delete</button>
        </section>
      ))}
    </div>
  );
}

/** A readable random code: four words from a small list plus a number. */
function suggestCode(): string {
  const words = ['ember', 'lantern', 'harbor', 'falcon', 'silver', 'raven', 'thorn', 'comet', 'anvil', 'willow', 'beacon', 'griffin', 'marsh', 'quartz', 'tundra', 'citadel', 'moonlit', 'drake', 'vessel', 'cinder'];
  const pick = () => {
    const n = new Uint32Array(1);
    crypto.getRandomValues(n);
    return words[n[0]! % words.length]!;
  };
  const num = new Uint32Array(1);
  crypto.getRandomValues(num);
  return `${pick()}-${pick()}-${pick()}-${pick()}-${num[0]! % 100}`;
}

export function AccessAdmin() {
  const codes = useLoad(listAccessCodes, []);
  const members = useLoad(listMembers, []);
  const [code, setCode] = useState(suggestCode);
  const [label, setLabel] = useState('Table code');
  const [rotate, setRotate] = useState(true);
  const [shown, setShown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createAccessCode(code, label, rotate);
      setShown(code);
      setCode(suggestCode());
      codes.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the code.');
    }
  }

  return (
    <div>
      <h1 className="page-title">Player access</h1>
      <section className="panel">
        <h2>Access codes</h2>
        <p className="fine-print">
          Codes are stored only as a hash, so they cannot be shown again. Each device that enters a code becomes its own player and can be
          removed below. Rotating revokes every older code; devices already in keep access until you remove them.
        </p>
        <form className="form-grid" onSubmit={create}>
          <label>New code<input value={code} onChange={(e) => setCode(e.target.value)} minLength={10} maxLength={200} required /></label>
          <label>Label<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} /></label>
          <label className="checkbox"><input type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} /> Revoke all older codes</label>
          <button type="submit" className="button small">Create code</button>
        </form>
        {shown && <p className="form-ok" role="status">New code: <code>{shown}</code>. Share it with your players now; it will not be shown again.</p>}
        {error && <p className="form-error">{error}</p>}
        <table className="table">
          <thead><tr><th>Label</th><th>Created</th><th>Uses</th><th>Status</th><th /></tr></thead>
          <tbody>
            {codes.data?.map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td>{new Date(c.created_at).toLocaleDateString()}</td>
                <td>{c.use_count}{c.max_uses ? ` / ${c.max_uses}` : ''}</td>
                <td>{c.revoked_at ? 'Revoked' : c.expires_at && new Date(c.expires_at) < new Date() ? 'Expired' : 'Active'}</td>
                <td>{!c.revoked_at && <button type="button" className="link-button" onClick={async () => { if (window.confirm('Revoke this code?')) { await revokeAccessCode(c.id); codes.reload(); } }}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h2>Devices and members</h2>
        <table className="table">
          <thead><tr><th>Name</th><th>Role</th><th>Joined</th><th>Last seen</th><th>Status</th><th /></tr></thead>
          <tbody>
            {members.data?.map((m) => (
              <tr key={m.user_id}>
                <td>{m.display_name}</td>
                <td>{m.role === 'dm' ? 'DM' : 'Player'}</td>
                <td>{new Date(m.created_at).toLocaleDateString()}</td>
                <td>{m.last_seen_at ? new Date(m.last_seen_at).toLocaleDateString() : '—'}</td>
                <td>{m.revoked_at ? 'Removed' : 'Active'}</td>
                <td>
                  {m.role === 'player' && !m.revoked_at && (
                    <>
                      <button type="button" className="link-button" onClick={async () => { const n = window.prompt('New display name', m.display_name); if (n) { await renameMember(m.user_id, n); members.reload(); } }}>Rename</button>{' · '}
                      <button type="button" className="link-button" onClick={async () => { if (window.confirm(`Remove ${m.display_name}'s access? Their device is signed out of the wiki immediately.`)) { await revokeMember(m.user_id); members.reload(); } }}>Remove</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className="button danger small"
          onClick={async () => {
            if (window.confirm('Remove EVERY player device? Everyone will need a new code.')) {
              const n = await revokeAllPlayers();
              members.reload();
              window.alert(`${n} device(s) removed.`);
            }
          }}
        >
          Remove all player devices
        </button>
      </section>
    </div>
  );
}

/** TOTP two-step sign-in for the DM account (free on Supabase). Once verified, the database
 * refuses DM content to any session of this account that has not passed the second step. */
function TwoStepPanel() {
  const factors = useLoad(async () => (await supabase.auth.mfa.listFactors()).data?.totp ?? [], []);
  const [pending, setPending] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const verified = (factors.data ?? []).filter((f) => f.status === 'verified');
  return (
    <section className="panel">
      <h2>Two-step sign-in</h2>
      <p className="fine-print">
        Protects the DM account with an authenticator app. Once it is on, DM content is only available after entering a code, even
        to someone who knows your password.
      </p>
      {verified.length > 0 ? (
        <>
          <p className="form-ok">Two-step sign-in is on.</p>
          <button
            type="button"
            className="button secondary small"
            onClick={async () => {
              if (!window.confirm('Turn off two-step sign-in?')) return;
              for (const f of verified) await supabase.auth.mfa.unenroll({ factorId: f.id });
              factors.reload();
            }}
          >
            Turn off
          </button>
        </>
      ) : pending ? (
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: pending.id, code });
            if (err) setError('That code was not accepted.');
            else {
              setPending(null);
              setCode('');
              setMsg('Two-step sign-in is on.');
              factors.reload();
            }
          }}
        >
          <img src={pending.qr} alt="QR code for your authenticator app" width={180} height={180} />
          <p className="fine-print">Scan the code, or enter this key in your app: <code>{pending.secret}</code></p>
          <label>Code from the app<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required /></label>
          <button type="submit" className="button small">Verify and turn on</button>
          {error && <p className="form-error">{error}</p>}
        </form>
      ) : (
        <button
          type="button"
          className="button small"
          onClick={async () => {
            setError(null);
            // Clear any half-finished setup first.
            for (const f of factors.data ?? []) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
            const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Chronicle ${new Date().toISOString().slice(0, 10)}` });
            if (err || !data) setError(err?.message ?? 'Could not start setup.');
            else setPending({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
          }}
        >
          Set up two-step sign-in
        </button>
      )}
      {msg && <p className="form-ok">{msg}</p>}
      {error && !pending && <p className="form-error">{error}</p>}
    </section>
  );
}

export function SettingsPage() {
  const settings = useLoad(getSettings, []);
  const [form, setForm] = useState({ title: '', tagline: '', overview: '', banner_media_id: null as string | null });
  const [msg, setMsg] = useState<string | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<unknown>(null);
  if (settings.data && settings.data !== loadedFrom) {
    setLoadedFrom(settings.data);
    setForm(settings.data);
  }
  return (
    <>
    <form
      className="panel form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        await updateSettings(form);
        setMsg('Saved.');
      }}
    >
      <h1 className="page-title span-2">Wiki settings</h1>
      <p className="fine-print span-2">The title, tagline and overview are shown to every player on the main page.</p>
      <label>Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={80} /></label>
      <label>Tagline<input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} maxLength={160} /></label>
      <label className="span-2">Campaign overview<textarea rows={6} value={form.overview} onChange={(e) => setForm({ ...form, overview: e.target.value })} /></label>
      <div className="span-2 hero-upload">
        {form.banner_media_id && <MediaImage id={form.banner_media_id} alt="" className="hero-thumb" />}
        <label>
          Banner image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const p = await prepareImage(file, 2400);
              const media = await uploadMedia(p.blob, { alt: 'Banner', width: p.width, height: p.height, visibility: 'players' });
              setForm({ ...form, banner_media_id: media.id });
            }}
          />
        </label>
        {form.banner_media_id && <button type="button" className="button secondary small" onClick={() => setForm({ ...form, banner_media_id: null })}>Use the built-in banner</button>}
      </div>
      <button type="submit" className="button">Save settings</button>
      {msg && <p className="form-ok">{msg}</p>}
    </form>
    <TwoStepPanel />
    </>
  );
}

export function TimelineEditor() {
  const events = useLoad(timeline, []);
  const articles = useLoad(listAllArticleRefs, []);
  const empty: Omit<TimelineEvent, 'id'> & { id?: string } = { title: '', date_label: '', sort_key: 0, body: '', article_id: null, visibility: 'dm', status: 'draft' };
  const [form, setForm] = useState(empty);
  return (
    <div>
      <h1 className="page-title">Edit timeline</h1>
      <form
        className="panel form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          await saveTimelineEvent(form);
          setForm(empty);
          events.reload();
        }}
      >
        <h2 className="span-2">{form.id ? 'Edit event' : 'New event'}</h2>
        <label>Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
        <label>Date as shown<input value={form.date_label} onChange={(e) => setForm({ ...form, date_label: e.target.value })} placeholder="e.g. Year 352, early spring" /></label>
        <label>Sort order<input type="number" step="any" value={form.sort_key} onChange={(e) => setForm({ ...form, sort_key: Number(e.target.value) })} /></label>
        <label>
          Linked article
          <select value={form.article_id ?? ''} onChange={(e) => setForm({ ...form, article_id: e.target.value || null })}>
            <option value="">None</option>
            {articles.data?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </label>
        <label>Who can see it
          <select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as Visibility })}>
            <option value="dm">DM only</option><option value="players">Players</option>
          </select>
        </label>
        <label>Status
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PublishStatus })}>
            <option value="draft">Draft</option><option value="published">Published</option>
          </select>
        </label>
        <label className="span-2">Description<textarea rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
        <div className="form-actions span-2">
          <button type="submit" className="button small">Save event</button>
          {form.id && <button type="button" className="button secondary small" onClick={() => setForm(empty)}>Cancel</button>}
        </div>
      </form>
      <ol className="timeline">
        {events.data?.map((ev) => (
          <li key={ev.id} className={ev.visibility === 'dm' || ev.status === 'draft' ? 'dm-only' : undefined}>
            <div className="timeline-date">{ev.date_label}</div>
            <div className="timeline-card">
              <h2>{ev.title} <VisibilityBadge visibility={ev.visibility} /> <StatusBadge status={ev.status} /></h2>
              <button type="button" className="link-button" onClick={() => setForm({ ...ev })}>Edit</button>{' · '}
              <button type="button" className="link-button" onClick={async () => { if (window.confirm(`Delete “${ev.title}”?`)) { await deleteTimelineEvent(ev.id); events.reload(); } }}>Delete</button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function MapEditor() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const existing = useLoad(() => (slug ? getMap(slug) : Promise.resolve(null)), [slug]);
  const maps = useLoad(listMaps, []);
  const articles = useLoad(listAllArticleRefs, []);
  const [form, setForm] = useState<Omit<WikiMap, 'id'> & { id?: string }>({
    slug: '', title: '', description: '', media_id: null, width: 2000, height: 1500, parent_map_id: null, article_id: null, visibility: 'dm', status: 'draft',
  });
  const [error, setError] = useState<string | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<unknown>(null);
  if (existing.data && existing.data !== loadedFrom) {
    setLoadedFrom(existing.data);
    setForm(existing.data.map);
  }
  if (slug && !existing.loading && !existing.data) return <NotFound what="map" />;

  return (
    <form
      className="panel form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          const saved = await saveMap({ ...form, slug: form.slug || slugify(form.title) });
          if (saved.media_id) await setMediaVisibility(saved.media_id, saved.visibility === 'players' && saved.status === 'published' ? 'players' : 'dm');
          navigate(`/maps/${saved.slug}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not save the map.');
        }
      }}
    >
      <h1 className="page-title span-2">{slug ? 'Map settings' : 'New map'}</h1>
      <label>Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value, slug: slug ? form.slug : slugify(e.target.value) })} required /></label>
      <label>Address<input value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} required /></label>
      <label className="span-2">Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      <label>
        Inside map
        <select value={form.parent_map_id ?? ''} onChange={(e) => setForm({ ...form, parent_map_id: e.target.value || null })}>
          <option value="">None (top level)</option>
          {maps.data?.filter((m) => m.id !== form.id).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
      </label>
      <label>
        Linked article
        <select value={form.article_id ?? ''} onChange={(e) => setForm({ ...form, article_id: e.target.value || null })}>
          <option value="">None</option>
          {articles.data?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
        </select>
      </label>
      <label>Who can see it
        <select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as Visibility })}>
          <option value="dm">DM only</option><option value="players">Players</option>
        </select>
      </label>
      <label>Status
        <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PublishStatus })}>
          <option value="draft">Draft</option><option value="published">Published</option>
        </select>
      </label>
      <div className="span-2 hero-upload">
        {form.media_id && <MediaImage id={form.media_id} alt="" className="hero-thumb" />}
        <label>
          Map image (resized to at most {MAX_MAP_IMAGE} px)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const p = await prepareImage(file, MAX_MAP_IMAGE, 0.85);
                const media = await uploadMedia(p.blob, { alt: form.title, width: p.width, height: p.height, visibility: 'dm' });
                setForm({ ...form, media_id: media.id, width: p.width, height: p.height });
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Upload failed.');
              }
            }}
          />
        </label>
      </div>
      <p className="fine-print span-2">The map image becomes visible to players only when the map is published for players.</p>
      {error && <p className="form-error span-2">{error}</p>}
      <button type="submit" className="button">Save map</button>
    </form>
  );
}
