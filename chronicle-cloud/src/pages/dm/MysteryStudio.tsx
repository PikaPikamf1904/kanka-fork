import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Markdown } from '../../components/Markdown.tsx';
import { articlesBySlugs, listMaps, listMembers, suggest } from '../../lib/api.ts';
import { BOARD_COLOURS, colourLabel } from '../../lib/boardLogic.ts';
import {
  CLUE_KINDS, fromLocalInput, kindLabel, MYSTERY_STATUS, pendingReleases, releaseState, releaseText, sortClues, statusName, toLocalInput,
  type MysteryStatus,
} from '../../lib/clues.ts';
import {
  allDiscoveries, attachNames, deleteClue, deleteHint, deleteMystery, listClues, listMysteries, previewClues, saveClue, saveHint, saveMystery,
  type Clue, type Hint, type Mystery,
} from '../../lib/mysteryData.ts';
import type { ArticleRef } from '../../lib/types.ts';
import { useLoad } from '../../lib/useLoad.ts';

type ClueRow = Clue & { clue_hints: Hint[] };
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const failure = (e: unknown) => (e instanceof Error ? e.message : 'That did not work. Try again.');

/** Small panel for the DM desk: how many releases are waiting, and when the next one is due. */
export function MysteriesPanel() {
  const clues = useLoad(() => listClues(), []);
  if (clues.error || !clues.data) return null;
  const pending = pendingReleases(clues.data);
  return (
    <section className="panel" aria-labelledby="mysteries-panel-h">
      <h2 id="mysteries-panel-h">Mysteries</h2>
      <p data-testid="mysteries-pending">
        {pending.length === 0 ? 'No clues are scheduled for release.' : `${pending.length} ${pending.length === 1 ? 'clue is' : 'clues are'} waiting to be released. The next one is due ${when(pending[0]!.release_at!)}.`}
      </p>
      <p><Link className="button secondary small" to="/dm/mysteries">Open the Mystery Studio</Link></p>
    </section>
  );
}

/** Mystery Studio: plan mysteries, write clues, schedule their release, and see who has found what. */
export function MysteryStudio() {
  const mysteries = useLoad(listMysteries, []);
  const clues = useLoad(() => listClues(), []);
  const members = useLoad(listMembers, []);
  const discoveries = useLoad(allDiscoveries, []);
  const [filter, setFilter] = useState<MysteryStatus | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Mystery | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reloadAll = () => { mysteries.reload(); clues.reload(); discoveries.reload(); };

  const shown = (mysteries.data ?? []).filter((m) => filter === 'all' || m.status === filter);
  const names = new Map((members.data ?? []).map((m) => [m.user_id, m.display_name]));
  const allClues = clues.data ?? [];
  const pending = pendingReleases(allClues);
  const released = allClues.filter((c) => releaseState(c) === 'released');
  const open = (mysteries.data ?? []).find((m) => m.id === openId) ?? null;

  async function setStatus(m: Mystery, status: MysteryStatus) {
    setError(null);
    try { await saveMystery({ id: m.id, title: m.title, status }); reloadAll(); } catch (e) { setError(failure(e)); }
  }
  async function remove(m: Mystery) {
    if (!window.confirm(`Delete the mystery “${m.title}” and all of its clues? This cannot be undone. To keep it, archive it instead.`)) return;
    try { await deleteMystery(m.id); if (openId === m.id) setOpenId(null); reloadAll(); } catch (e) { setError(failure(e)); }
  }

  return (
    <div className="studio-page">
      <h1 className="page-title">Mystery Studio</h1>
      <p className="muted">Plan mysteries and write the clues players will find. Nothing is shown to players until you release it, and drafts and archived mysteries show nothing at all.</p>
      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="panel" aria-labelledby="studio-overview-h">
        <h2 id="studio-overview-h">Overview</h2>
        <p data-testid="studio-counts">{pending.length} scheduled · {released.length} released · {allClues.length} {allClues.length === 1 ? 'clue' : 'clues'} in all</p>
        {pending.length > 0 && (
          <>
            <h3>Waiting to be released</h3>
            <ul className="plain-list">{pending.map((c) => <li key={c.id}>{c.title} <span className="muted">· {when(c.release_at!)}</span></li>)}</ul>
          </>
        )}
        <h3>What players have found</h3>
        {(discoveries.data ?? []).length === 0 ? <p className="muted">No one has found a clue yet.</p> : (
          <ul className="plain-list" data-testid="studio-discoveries">
            {(discoveries.data ?? []).map((d) => (
              <li key={`${d.clue_id}-${d.user_id}`}>{names.get(d.user_id) ?? 'A former player'} found <strong>{allClues.find((c) => c.id === d.clue_id)?.title ?? 'a clue'}</strong> <span className="muted">· {when(d.discovered_at)}</span></li>
            ))}
          </ul>
        )}
        <PreviewAsPlayer players={(members.data ?? []).filter((m) => m.role === 'player' && !m.revoked_at)} />
      </section>

      <p className="button-row">
        <button type="button" className="button" onClick={() => setEditing('new')}>New mystery</button>
      </p>
      {editing && (
        <MysteryForm
          key={editing === 'new' ? 'new' : editing.id}
          mystery={editing === 'new' ? null : editing}
          onDone={(saved) => { setEditing(null); if (saved) reloadAll(); }}
        />
      )}

      <div className="chip-cloud" role="group" aria-label="Filter by status">
        <button type="button" className={filter === 'all' ? 'chip chip-on' : 'chip'} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
        {MYSTERY_STATUS.map((s) => <button key={s} type="button" className={filter === s ? 'chip chip-on' : 'chip'} aria-pressed={filter === s} onClick={() => setFilter(s)}>{statusName(s)}</button>)}
      </div>
      {mysteries.data && shown.length === 0 && <p className="panel">{filter === 'all' ? 'No mysteries yet. Choose “New mystery” to start one.' : 'No mysteries with that status.'}</p>}
      {shown.map((m) => (
        <section key={m.id} className={`panel mystery-card mystery-${m.colour}`} aria-labelledby={`sm-${m.id}`} data-testid="studio-mystery">
          <h2 id={`sm-${m.id}`}>{m.title} <span className="badge">{statusName(m.status)}</span></h2>
          <p className="fine-print">Players see: {m.player_title ? `“${m.player_title}”` : 'an unnamed mystery'} · {allClues.filter((c) => c.mystery_id === m.id).length} clues</p>
          <div className="button-row">
            <button type="button" className="button small" aria-expanded={openId === m.id} aria-label={`${openId === m.id ? 'Close' : 'Open'} ${m.title}`} onClick={() => setOpenId(openId === m.id ? null : m.id)}>{openId === m.id ? 'Close' : 'Open'}</button>
            <button type="button" className="button small secondary" aria-label={`Edit ${m.title}`} onClick={() => setEditing(m)}>Edit</button>
            {m.status !== 'archived'
              ? <button type="button" className="button small secondary" aria-label={`Archive ${m.title}`} onClick={() => void setStatus(m, 'archived')}>Archive</button>
              : <button type="button" className="button small secondary" aria-label={`Restore ${m.title} as a draft`} onClick={() => void setStatus(m, 'draft')}>Restore</button>}
            <button type="button" className="button small danger" aria-label={`Delete ${m.title}`} onClick={() => void remove(m)}>Delete</button>
          </div>
        </section>
      ))}
      {open && <CluesEditor key={open.id} mystery={open} onChanged={reloadAll} />}
    </div>
  );
}

function MysteryForm({ mystery, onDone }: { mystery: Mystery | null; onDone(saved: boolean): void }) {
  const [f, setF] = useState({
    title: mystery?.title ?? '', player_title: mystery?.player_title ?? '', summary: mystery?.summary ?? '', dm_notes: mystery?.dm_notes ?? '',
    colour: mystery?.colour ?? 'amber', status: (mystery?.status ?? 'draft') as MysteryStatus,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="panel form-grid"
      aria-label={mystery ? 'Edit mystery' : 'New mystery'}
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        saveMystery({ id: mystery?.id, ...f, title: f.title.trim() }).then(() => onDone(true), (er: unknown) => { setError(failure(er)); setBusy(false); });
      }}
    >
      <h2>{mystery ? 'Edit mystery' : 'New mystery'}</h2>
      <label>Working title (only you see this)<input value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label>Title players see<input value={f.player_title} maxLength={120} onChange={(e) => setF({ ...f, player_title: e.target.value })} placeholder="Leave blank to show “An unnamed mystery”" /></label>
      <label>Summary<textarea rows={3} maxLength={5000} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></label>
      <label>DM notes (only you see these)<textarea rows={4} maxLength={20000} value={f.dm_notes} onChange={(e) => setF({ ...f, dm_notes: e.target.value })} /></label>
      <div className="journal-editor-row">
        <label>Colour<select aria-label="Colour" value={f.colour} onChange={(e) => setF({ ...f, colour: e.target.value })}>{BOARD_COLOURS.map((c) => <option key={c} value={c}>{colourLabel(c)}</option>)}</select></label>
        <label>Status
          <select aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as MysteryStatus })}>{MYSTERY_STATUS.map((s) => <option key={s} value={s}>{statusName(s)}</option>)}</select>
        </label>
      </div>
      <p className="fine-print">Players only see a mystery once it is Active or Concluded and has a clue they can see.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="button-row">
        <button type="submit" className="button" disabled={busy || !f.title.trim()}>{busy ? 'Saving…' : 'Save mystery'}</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => onDone(false)}>Cancel</button>
      </div>
    </form>
  );
}

function PreviewAsPlayer({ players }: { players: { user_id: string; display_name: string }[] }) {
  const [who, setWho] = useState('');
  const [result, setResult] = useState<{ id: string; title: string; discovered: boolean }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!who) return;
    let live = true;
    previewClues(who).then((r) => { if (live) { setResult(r); setError(null); } }, (e: unknown) => { if (live) setError(failure(e)); });
    return () => { live = false; };
  }, [who]);
  return (
    <div className="studio-preview">
      <h3>Preview as a player</h3>
      <label>Player
        <select aria-label="Player" value={who} onChange={(e) => { setWho(e.target.value); setResult(null); }}>
          <option value="">Choose a player…</option>
          {players.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}
        </select>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {who && result && (result.length === 0 ? <p className="muted" data-testid="preview-empty">This player can see no clues right now.</p> : (
        <ul className="plain-list" data-testid="preview-list">
          {result.map((c) => <li key={c.id}>{c.title} <span className="muted">· {c.discovered ? 'found' : 'not found yet'}</span></li>)}
        </ul>
      ))}
    </div>
  );
}

// ---------- clues of one mystery ----------

function CluesEditor({ mystery, onChanged }: { mystery: Mystery; onChanged(): void }) {
  const data = useLoad(() => listClues(mystery.id), [mystery.id]);
  const [editing, setEditing] = useState<ClueRow | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clues = sortClues(data.data ?? []);
  const names = useLoad(() => attachNames(clues.flatMap((c) => (c.attach_article_id ? [c.attach_article_id] : [])), clues.flatMap((c) => (c.attach_map_id ? [c.attach_map_id] : []))), [clues.map((c) => c.attach_article_id ?? c.attach_map_id ?? '').join(',')]);
  const refresh = () => { data.reload(); onChanged(); };

  async function release(c: ClueRow, state: 'now' | 'withdraw') {
    setError(null);
    try {
      await saveClue(state === 'now' ? { id: c.id, mystery_id: c.mystery_id, title: c.title, released_at: new Date().toISOString() } : { id: c.id, mystery_id: c.mystery_id, title: c.title, released_at: null, release_at: null });
      refresh();
    } catch (e) { setError(failure(e)); }
  }
  async function remove(c: ClueRow) {
    if (!window.confirm(`Delete the clue “${c.title}”? Players who found it lose it too.`)) return;
    try { await deleteClue(c.id); refresh(); } catch (e) { setError(failure(e)); }
  }

  return (
    <section className="panel" aria-label={`Clues for ${mystery.title}`}>
      <h2>Clues for {mystery.title}</h2>
      {error && <p className="form-error" role="alert">{error}</p>}
      {mystery.status === 'draft' && <p className="fine-print">This mystery is a draft, so players see none of its clues yet. Set it to Active when you are ready.</p>}
      <p><button type="button" className="button small" onClick={() => setEditing('new')}>Add a clue</button></p>
      {editing && (
        <ClueForm
          key={editing === 'new' ? 'new' : editing.id}
          mysteryId={mystery.id}
          clue={editing === 'new' ? null : editing}
          siblings={clues}
          onDone={(saved) => { setEditing(null); if (saved) refresh(); }}
        />
      )}
      {data.data && clues.length === 0 && <p className="muted">No clues yet.</p>}
      <ul className="plain-list">
        {clues.map((c) => {
          const attached = c.attach_article_id ?? c.attach_map_id;
          const state = releaseState(c);
          return (
            <li key={c.id} className="studio-clue" data-testid="studio-clue">
              <strong>{c.title}</strong> <span className="badge">{kindLabel(c.kind)}</span>{' '}
              <span className={state === 'released' ? 'chip chip-on' : 'chip'}>{releaseText(c)}</span>
              <span className="fine-print"> · {attached ? `On ${names.data?.get(attached)?.title ?? 'a page or map'}` : 'Not attached to a page'}{c.requires_clue_id ? ` · needs “${clues.find((x) => x.id === c.requires_clue_id)?.title ?? 'another clue'}” first` : ''}</span>
              <div className="button-row">
                {state !== 'released' && <button type="button" className="button small" aria-label={`Release ${c.title} now`} onClick={() => void release(c, 'now')}>Release now</button>}
                {state !== 'hidden' && <button type="button" className="button small secondary" aria-label={`Withdraw ${c.title}`} onClick={() => void release(c, 'withdraw')}>Withdraw</button>}
                <button type="button" className="button small secondary" aria-label={`Edit ${c.title}`} onClick={() => setEditing(c)}>Edit</button>
                <button type="button" className="button small danger" aria-label={`Delete ${c.title}`} onClick={() => void remove(c)}>Delete</button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ClueForm({ mysteryId, clue, siblings, onDone }: { mysteryId: string; clue: ClueRow | null; siblings: ClueRow[]; onDone(saved: boolean): void }) {
  const [f, setF] = useState({
    kind: clue?.kind ?? 'note', title: clue?.title ?? '', body: clue?.body ?? '', source_line: clue?.source_line ?? '',
    requires: clue?.requires_clue_id ?? '', position: clue?.position ?? siblings.length + 1, at: toLocalInput(clue?.release_at ?? null),
  });
  const [attach, setAttach] = useState<{ kind: 'none' | 'page' | 'map'; id: string | null; label: string }>({
    kind: clue?.attach_article_id ? 'page' : clue?.attach_map_id ? 'map' : 'none', id: clue?.attach_article_id ?? clue?.attach_map_id ?? null, label: '',
  });
  const [q, setQ] = useState('');
  const [found, setFound] = useState<ArticleRef[]>([]);
  const maps = useLoad(listMaps, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hintText, setHintText] = useState('');
  const hints = useLoad(async () => (clue ? listClues(mysteryId).then((all) => all.find((c) => c.id === clue.id)?.clue_hints ?? []) : []), [clue?.id]);

  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      if (q.trim().length < 2) { setFound([]); return; }
      suggest(q.trim()).then((r) => { if (live) setFound(r); }, () => { if (live) setFound([]); });
    }, 200);
    return () => { live = false; window.clearTimeout(t); };
  }, [q]);

  const attachedName = useLoad(() => (attach.id && !attach.label ? attachNames(attach.kind === 'page' ? [attach.id] : [], attach.kind === 'map' ? [attach.id] : []).then((m) => m.get(attach.id!)?.title ?? '') : Promise.resolve(attach.label)), [attach.id, attach.kind, attach.label]);

  async function pick(ref: ArticleRef) {
    const [page] = await articlesBySlugs([ref.slug]);
    if (page) { setAttach({ kind: 'page', id: page.id, label: page.title }); setQ(''); setFound([]); }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await saveClue({
        id: clue?.id, mystery_id: mysteryId, title: f.title.trim(), kind: f.kind, body: f.body, source_line: f.source_line, position: Number(f.position) || 0,
        attach_article_id: attach.kind === 'page' ? attach.id : null, attach_map_id: attach.kind === 'map' ? attach.id : null,
        requires_clue_id: f.requires || null, release_at: fromLocalInput(f.at),
      });
      onDone(true);
    } catch (e) { setError(failure(e)); setBusy(false); }
  }

  async function hintAction(h: Hint | null, patch: Partial<Hint>) {
    setError(null);
    try {
      await saveHint({ id: h?.id, clue_id: clue!.id, body: h?.body ?? hintText.trim(), ...patch });
      if (!h) setHintText('');
      hints.reload();
    } catch (e) { setError(failure(e)); }
  }

  return (
    <form className="panel form-grid" aria-label={clue ? 'Edit clue' : 'New clue'} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h3>{clue ? 'Edit clue' : 'New clue'}</h3>
      <div className="journal-editor-row">
        <label>Kind<select aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{CLUE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
        <label>Clue title<input value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      </div>
      <label>Text (Markdown)<textarea rows={6} maxLength={20000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
      <label>Source line (optional)<input value={f.source_line} maxLength={160} onChange={(e) => setF({ ...f, source_line: e.target.value })} placeholder="For example: Sealed with the mark of the Blue Wing" /></label>
      {f.body && (
        <div aria-label="Preview of the document">
          <p className="fine-print">Preview</p>
          <article className={`clue-document clue-kind-${f.kind}`}><h4>{f.title || 'Untitled'}</h4><Markdown text={f.body} />{f.source_line && <p className="clue-source">{f.source_line}</p>}</article>
        </div>
      )}

      <fieldset>
        <legend>Where players find it</legend>
        <label className="check-row"><input type="radio" name="attach" checked={attach.kind === 'none'} onChange={() => setAttach({ kind: 'none', id: null, label: '' })} />Nowhere in particular (listed under Mysteries)</label>
        <label className="check-row"><input type="radio" name="attach" checked={attach.kind === 'page'} onChange={() => setAttach({ kind: 'page', id: null, label: '' })} />On a page</label>
        <label className="check-row"><input type="radio" name="attach" checked={attach.kind === 'map'} onChange={() => setAttach({ kind: 'map', id: null, label: '' })} />On a map</label>
        {attach.kind === 'page' && (
          <div>
            <label htmlFor="clue-page-q">Find the page</label>
            <input id="clue-page-q" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" placeholder="Start typing a page name" />
            {found.length > 0 && <ul className="plain-list" aria-label="Matching pages">{found.map((r) => <li key={r.slug}><button type="button" className="button secondary small" onClick={() => void pick(r)}>Attach to {r.title}</button></li>)}</ul>}
          </div>
        )}
        {attach.kind === 'map' && (
          <label>Map<select aria-label="Map" value={attach.id ?? ''} onChange={(e) => setAttach({ kind: 'map', id: e.target.value || null, label: '' })}><option value="">Choose a map…</option>{(maps.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
        )}
        {attach.id && <p className="fine-print">Attached to: <strong>{attachedName.data || attach.label || '…'}</strong>. Players only see it if they can read that {attach.kind}.</p>}
      </fieldset>

      <div className="journal-editor-row">
        <label>Needs this clue found first
          <select aria-label="Needs this clue found first" value={f.requires} onChange={(e) => setF({ ...f, requires: e.target.value })}>
            <option value="">Nothing</option>
            {siblings.filter((s) => s.id !== clue?.id).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
        <label>Order<input type="number" value={f.position} onChange={(e) => setF({ ...f, position: Number(e.target.value) })} /></label>
      </div>
      <label>Release at a set time (optional)<input type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></label>
      <p className="fine-print">Leave the time empty and use “Release now” on the list when you are ready. Clearing the time and pressing “Withdraw” hides it again.</p>

      {clue && (
        <section aria-label="Hints">
          <h4>Hints</h4>
          {(hints.data ?? []).map((h) => (
            <div key={h.id} className="studio-hint">
              <p>{h.body} <span className="chip">{releaseText(h)}</span></p>
              <div className="button-row">
                {releaseState(h) !== 'released' && <button type="button" className="button small" onClick={() => void hintAction(h, { released_at: new Date().toISOString() })}>Release hint now</button>}
                {releaseState(h) !== 'hidden' && <button type="button" className="button small secondary" onClick={() => void hintAction(h, { released_at: null, release_at: null })}>Withdraw hint</button>}
                <label className="studio-hint-time">Release at<input type="datetime-local" defaultValue={toLocalInput(h.release_at)} onBlur={(e) => { const v = fromLocalInput(e.target.value); if (v !== h.release_at && e.target.value) void hintAction(h, { release_at: v }); }} /></label>
                <button type="button" className="button small danger" onClick={async () => {
                  setError(null);
                  try { await deleteHint(h.id); hints.reload(); } catch (e) { setError(failure(e)); }
                }}>Delete hint</button>
              </div>
            </div>
          ))}
          <label>New hint<textarea rows={2} maxLength={2000} value={hintText} onChange={(e) => setHintText(e.target.value)} /></label>
          <button type="button" className="button small secondary" disabled={!hintText.trim()} onClick={() => void hintAction(null, {})}>Add hint</button>
        </section>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="button-row">
        <button type="submit" className="button" disabled={busy || !f.title.trim()}>{busy ? 'Saving…' : 'Save clue'}</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => onDone(false)}>Cancel</button>
      </div>
    </form>
  );
}
