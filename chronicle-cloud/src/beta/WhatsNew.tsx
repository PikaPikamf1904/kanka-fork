import { useState } from 'react';
import { Link } from 'react-router';
import { longDate } from '../lib/dates.ts';
import { useSession } from '../lib/session.tsx';
import { TEMPLATES } from '../lib/templates.ts';
import { useLoad } from '../lib/useLoad.ts';
import { changedSince } from './api.ts';
import { keyFor, load, save } from './store.ts';

// "Since your last visit": each device remembers when this member last opened Chronicle. The
// first page load of a browser session moves the marker forward and keeps the previous one for
// the rest of the session, so the list stays put while the reader clicks around.

function sinceFor(userId: string): string | null {
  const sessionKey = `chronicle.beta.since.${userId}`;
  try {
    const kept = window.sessionStorage.getItem(sessionKey);
    if (kept !== null) return kept || null;
    const previous = load<string | null>(keyFor('last-visit', userId), null, (r) => (typeof r === 'string' && !Number.isNaN(Date.parse(r)) ? r : null));
    window.sessionStorage.setItem(sessionKey, previous ?? '');
    save(keyFor('last-visit', userId), new Date().toISOString());
    return previous;
  } catch {
    return null;
  }
}

function markRead(userId: string) {
  const now = new Date().toISOString();
  save(keyFor('last-visit', userId), now);
  try {
    window.sessionStorage.setItem(`chronicle.beta.since.${userId}`, now);
  } catch {
    /* ignore */
  }
  return now;
}

export function WhatsNew() {
  const { state } = useSession();
  const userId = state.kind === 'member' ? state.userId : '';
  const [since, setSince] = useState<string | null>(() => (userId ? sinceFor(userId) : null));
  const changes = useLoad(() => (since ? changedSince(since) : Promise.resolve([])), [since, userId]);
  if (!userId) return null;
  if (!since) {
    return (
      <section className="panel whats-new" aria-labelledby="whats-new-title">
        <h2 id="whats-new-title">Since your last visit</h2>
        <p className="muted">Welcome! Next time you open Chronicle on this device, pages that changed in the meantime will be listed here.</p>
      </section>
    );
  }
  const list = changes.data ?? [];
  return (
    <section className="panel whats-new" aria-labelledby="whats-new-title">
      <div className="whats-new-head">
        <h2 id="whats-new-title">Since your last visit <span className="muted">· {longDate(since)}</span></h2>
        {list.length > 0 && <button type="button" className="button secondary small" onClick={() => setSince(markRead(userId))}>Mark all as seen</button>}
      </div>
      {changes.error && <p className="form-error">{changes.error}</p>}
      {changes.data && list.length === 0 && <p className="muted">Nothing new since then.</p>}
      {list.length > 0 && (
        <ul className="whats-new-list">
          {list.map((c) => {
            const fresh = c.published_at !== null && Date.parse(c.published_at) > Date.parse(since);
            return (
              <li key={c.slug}>
                <span className={fresh ? 'badge badge-ok' : 'badge'}>{fresh ? 'New' : 'Updated'}</span>{' '}
                <Link to={c.type === 'news' ? `/news/${c.slug}` : `/wiki/${c.slug}`}>{c.title}</Link>
                <span className="muted"> · {TEMPLATES[c.type]?.label ?? c.type} · {longDate(c.updated_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
