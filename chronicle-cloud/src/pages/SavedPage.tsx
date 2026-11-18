import { useMemo, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import {
  createList, deleteList, loadSaved, moveBookmark, noteErrorMessage, removeBookmark, renameList, reorderBookmarks, resolvePages,
  type Bookmark, type PageRef, type ReadingList,
} from '../lib/readerNotes.ts';
import { clearRecentViews, loadRecentViews } from '../lib/recentViews.ts';
import { moveBefore, moveItem } from '../lib/savedPages.ts';
import { useSession } from '../lib/session.tsx';
import { TEMPLATES } from '../lib/templates.ts';
import { useLoad } from '../lib/useLoad.ts';

interface Item { bookmark: Bookmark; page: PageRef }

/** "Saved pages": the reader's own bookmarks and reading lists, and the pages viewed lately on this device. */
export function SavedPage() {
  const { state } = useSession();
  const userId = state.kind === 'member' ? state.userId : '';
  const data = useLoad(async () => {
    const saved = await loadSaved();
    const pages = await resolvePages(saved.bookmarks.map((b) => b.article_id));
    return { ...saved, pages };
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [recent, setRecent] = useState(() => loadRecentViews(userId));
  const recentPages = useLoad(() => resolvePages(recent.map((r) => r.id)), [recent.map((r) => r.id).join(',')]);

  // Pages that no longer come back (hidden, deleted) are left out; no title is known for them.
  const sections = useMemo(() => {
    if (!data.data) return null;
    const { lists, bookmarks, pages } = data.data;
    const itemsOf = (listId: string | null): Item[] =>
      bookmarks.filter((b) => b.list_id === listId).flatMap((b) => {
        const page = pages.get(b.article_id);
        return page ? [{ bookmark: b, page }] : [];
      });
    return { lists, unsorted: itemsOf(null), perList: new Map(lists.map((l) => [l.id, itemsOf(l.id)])) };
  }, [data.data]);

  async function run(action: () => Promise<unknown>, said = '') {
    setBusy(true);
    setError(null);
    try {
      await action();
      data.reload();
      if (said) setAnnounce(said);
    } catch (e) {
      setError(noteErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const total = sections ? sections.unsorted.length + [...sections.perList.values()].reduce((n, l) => n + l.length, 0) : 0;
  const shownRecent = recent.flatMap((r) => {
    const p = recentPages.data?.get(r.id);
    return p ? [p] : [];
  });

  return (
    <div className="saved-page">
      <h1 className="page-title">Saved pages</h1>
      <p className="muted">Pages you keep for later, and reading lists to sort them into. Use the Save button at the top of any page.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {data.error && (
        <div className="notice" role="alert">
          <p>Could not load your saved pages: {data.error}</p>
          <button type="button" className="button secondary small" onClick={data.reload}>Try again</button>
        </div>
      )}
      {data.loading && !data.data && <p className="muted" role="status">Opening your saved pages…</p>}
      <p className="visually-hidden" role="status" aria-live="polite">{announce}</p>

      <form
        className="saved-new-list"
        onSubmit={(e) => {
          e.preventDefault();
          const name = newName.trim();
          if (!name || !sections) return;
          void run(async () => {
            await createList(name, Math.max(0, ...sections.lists.map((l) => l.position)) + 1);
            setNewName('');
          });
        }}
      >
        <label htmlFor="new-list-name">New reading list</label>
        <div className="button-row">
          <input id="new-list-name" value={newName} maxLength={60} placeholder="For example: Suspects" onChange={(e) => setNewName(e.target.value)} />
          <button type="submit" className="button small" disabled={busy || !newName.trim()}>Create list</button>
        </div>
      </form>

      {sections && total === 0 && sections.lists.length === 0 && (
        <p className="panel">Nothing saved yet. Open a page and choose <strong>Save</strong> near its title to keep it here. Make reading lists to sort what you save.</p>
      )}

      {sections && (
        <>
          <ItemsSection
            title="Saved"
            items={sections.unsorted}
            lists={sections.lists}
            listId={null}
            busy={busy}
            empty={sections.lists.length > 0 || total > 0 ? 'No unsorted pages.' : null}
            run={run}
          />
          {sections.lists.map((l) => (
            <ItemsSection
              key={l.id}
              title={l.name}
              list={l}
              items={sections.perList.get(l.id) ?? []}
              lists={sections.lists}
              listId={l.id}
              busy={busy}
              empty="This list is empty. Use “Add to a list” on a page, or move a saved page here."
              run={run}
              />
          ))}
        </>
      )}

      <section className="panel recent-views" aria-labelledby="recent-views-h">
        <h2 id="recent-views-h">Recently viewed</h2>
        {shownRecent.length === 0 ? (
          <p className="muted">Pages you open on this device will show up here.</p>
        ) : (
          <>
            <ul className="plain-list">
              {shownRecent.map((p) => (
                <li key={p.id}><Link to={`/wiki/${p.slug}`}>{p.title}</Link> <span className="badge">{TEMPLATES[p.type].label}</span></li>
              ))}
            </ul>
            <p className="fine-print">Kept on this device only.</p>
            <button type="button" className="button secondary small" onClick={() => { clearRecentViews(userId); setRecent([]); }}>Clear recently viewed</button>
          </>
        )}
      </section>
    </div>
  );
}

function ItemsSection({ title, list, items, lists, listId, busy, empty, run }: {
  title: string;
  list?: ReadingList;
  items: Item[];
  lists: ReadingList[];
  listId: string | null;
  busy: boolean;
  empty: string | null;
  run: (action: () => Promise<unknown>, said?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(title);
  const [dragging, setDragging] = useState<string | null>(null);
  const headingId = `saved-${listId ?? 'unsorted'}`;

  const reorder = (next: Item[], said: string) => void run(() => reorderBookmarks(listId, next.map((i) => i.bookmark.id)), said);
  const move = (index: number, delta: -1 | 1) => {
    const next = moveItem(items, index, delta);
    if (next !== items) reorder(next, `Moved ${items[index]!.page.title} to position ${index + delta + 1} of ${items.length}.`);
  };
  const onDrop = (e: DragEvent, toId: string) => {
    e.preventDefault();
    if (dragging && dragging !== toId) reorder(moveBefore(items.map((i) => ({ ...i, id: i.bookmark.id })), dragging, toId), 'Moved a saved page.');
    setDragging(null);
  };

  if (empty === null && items.length === 0 && !list) return null;
  return (
    <section className="panel saved-section" aria-labelledby={headingId}>
      <div className="saved-heading">
        {editing && list ? (
          <form
            className="button-row"
            onSubmit={(e) => {
              e.preventDefault();
              const next = name.trim();
              if (!next) return;
              void run(async () => { await renameList(list.id, next); setEditing(false); });
            }}
          >
            <label className="visually-hidden" htmlFor={`${headingId}-name`}>List name</label>
            <input id={`${headingId}-name`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="button small" disabled={busy || !name.trim()}>Save name</button>
            <button type="button" className="button secondary small" onClick={() => { setEditing(false); setName(title); }}>Cancel</button>
          </form>
        ) : (
          <>
            <h2 id={headingId}>{title} <span className="muted">({items.length})</span></h2>
            {list && (
              <div className="button-row">
                <button type="button" className="button secondary small" onClick={() => { setName(title); setEditing(true); }} aria-label={`Rename the list ${title}`}>Rename</button>
                <button
                  type="button"
                  className="button danger small"
                  disabled={busy}
                  aria-label={`Delete the list ${title}`}
                  onClick={() => {
                    if (window.confirm(`Delete the list “${title}”? Its saved pages are removed from your saved pages. The pages themselves are not affected.`)) void run(() => deleteList(list.id), `Deleted the list ${title}.`);
                  }}
                >
                  Delete list
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {items.length === 0 ? (
        empty && <p className="muted">{empty}</p>
      ) : (
        <ul className="saved-items">
          {items.map((it, i) => (
            <li
              key={it.bookmark.id}
              className={dragging === it.bookmark.id ? 'saved-item dragging' : 'saved-item'}
              data-testid="saved-item"
              draggable={!busy}
              onDragStart={(e) => { setDragging(it.bookmark.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.bookmark.id); }}
              onDragOver={(e) => { if (dragging) e.preventDefault(); }}
              onDrop={(e) => onDrop(e, it.bookmark.id)}
              onDragEnd={() => setDragging(null)}
            >
              <span className="saved-grip" aria-hidden="true">⠿</span>
              <span className="saved-main">
                <Link to={`/wiki/${it.page.slug}`}>{it.page.title}</Link> <span className="badge">{TEMPLATES[it.page.type].label}</span>
              </span>
              <span className="saved-actions">
                <button type="button" className="button secondary small" disabled={busy || i === 0} aria-label={`Move ${it.page.title} up`} onClick={() => move(i, -1)}>Move up</button>
                <button type="button" className="button secondary small" disabled={busy || i === items.length - 1} aria-label={`Move ${it.page.title} down`} onClick={() => move(i, 1)}>Move down</button>
                <select
                  aria-label={`Move ${it.page.title} to another list`}
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    const target = e.target.value;
                    if (!target) return;
                    const to = target === 'unsorted' ? null : target;
                    const toName = to === null ? 'Saved' : lists.find((l) => l.id === to)?.name ?? 'the list';
                    void run(() => moveBookmark(it.bookmark.id, to), `Moved ${it.page.title} to ${toName}.`);
                  }}
                >
                  <option value="">Move to…</option>
                  {listId !== null && <option value="unsorted">Saved (no list)</option>}
                  {lists.filter((l) => l.id !== listId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <button type="button" className="button secondary small" disabled={busy} aria-label={`Remove ${it.page.title} from ${listId ? title : 'saved pages'}`} onClick={() => void run(() => removeBookmark(it.bookmark.id), `Removed ${it.page.title}.`)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
