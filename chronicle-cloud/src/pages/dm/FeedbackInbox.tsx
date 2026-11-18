import { useMemo, useState } from 'react';
import {
  CATEGORIES, categoryLabel, deleteFeedback, inbox, STATUS_LABELS, triage, type FeedbackPriority, type FeedbackStatus, type InboxItem,
} from '../../lib/feedback.ts';
import { useLoad } from '../../lib/useLoad.ts';

const PRIORITIES: FeedbackPriority[] = ['none', 'low', 'normal', 'high'];

function Item({ f, onChanged }: { f: InboxItem; onChanged: () => void }) {
  const [note, setNote] = useState(f.dm_note);
  const [reply, setReply] = useState(f.reply);
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: Parameters<typeof triage>[1]) => {
    setError(null);
    try {
      await triage(f.id, patch);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  };
  return (
    <li className="feedback-item" data-testid="feedback-item">
      <div className="badges-row">
        <span className="badge">{categoryLabel(f.category)}</span>
        <span className="muted">{f.mode === 'anonymous' ? 'Anonymous' : `From ${f.author_name ?? 'a player'}`} · {new Date(f.submitted_on).toLocaleDateString()}</span>
      </div>
      <p className="feedback-body">{f.body}</p>
      <div className="feedback-controls">
        <label>Status
          <select value={f.status} onChange={(e) => void save({ status: e.target.value as FeedbackStatus })}>
            {(Object.keys(STATUS_LABELS) as FeedbackStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </label>
        <label>Priority
          <select value={f.priority} onChange={(e) => void save({ priority: e.target.value as FeedbackPriority })}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p === 'none' ? 'Not set' : p[0]!.toUpperCase() + p.slice(1)}</option>)}
          </select>
        </label>
      </div>
      <details>
        <summary>Notes{f.mode === 'named' ? ' and reply' : ''}</summary>
        <label>Private note (only you see this)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={5000} />
        </label>
        <button type="button" className="button secondary small" onClick={() => void save({ dm_note: note })}>Save note</button>
        {f.mode === 'named' && (
          <>
            <label>Reply to {f.author_name ?? 'the player'} (they see it on their Feedback page)
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={5000} />
            </label>
            <button type="button" className="button small" onClick={() => void save({ reply })}>Send reply</button>
          </>
        )}
        <button type="button" className="link-button" onClick={() => { if (window.confirm('Delete this feedback for good?')) void deleteFeedback(f.id).then(onChanged, (e: unknown) => setError(e instanceof Error ? e.message : 'Could not delete.')); }}>Delete</button>
      </details>
      {error && <p className="form-error" role="alert">{error}</p>}
    </li>
  );
}

/** DM inbox. Comfort and boundaries reports are listed first and apart from everything else. */
export function FeedbackInbox() {
  const data = useLoad(inbox, []);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const shown = useMemo(() => (data.data ?? []).filter((f) =>
    (!category || f.category === category)
    && (status === 'all' || (status === 'open' ? !['done', 'closed'].includes(f.status) : f.status === status))
    && (!q.trim() || f.body.toLowerCase().includes(q.trim().toLowerCase()))), [data.data, category, status, q]);
  if (data.data === null) return <p className="muted">The Feedback Center is not installed on this database yet.</p>;
  const comfort = shown.filter((f) => f.category === 'comfort');
  const rest = shown.filter((f) => f.category !== 'comfort');

  return (
    <div>
      <h1 className="page-title">Player feedback</h1>
      <p className="muted">Only you can read this. Nothing here is shared, searched or shown to players, and nothing is sent to any outside service.</p>
      <div className="filter feedback-filters">
        <label>Kind
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All kinds</option>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label>Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Open</option>
            <option value="all">All</option>
            {(Object.keys(STATUS_LABELS) as FeedbackStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </label>
        <label>Search<input type="search" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      {data.loading && <p className="muted" role="status">Loading…</p>}
      {data.error && <p className="form-error" role="alert">Could not load feedback: {data.error}</p>}
      <section className="panel" aria-labelledby="fb-comfort">
        <h2 id="fb-comfort">Boundaries and discomfort ({comfort.length})</h2>
        {comfort.length === 0 ? <p className="muted">None.</p> : <ul className="feedback-list">{comfort.map((f) => <Item key={f.id} f={f} onChanged={data.reload} />)}</ul>}
      </section>
      <section className="panel" aria-labelledby="fb-rest">
        <h2 id="fb-rest">Everything else ({rest.length})</h2>
        {rest.length === 0 ? <p className="muted">Nothing here.</p> : <ul className="feedback-list">{rest.map((f) => <Item key={f.id} f={f} onChanged={data.reload} />)}</ul>}
      </section>
    </div>
  );
}
