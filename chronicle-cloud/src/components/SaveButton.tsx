import { useState } from 'react';
import { Link } from 'react-router';
import { bookmarksForPage, listReadingLists, noteErrorMessage, removeBookmark, savePage } from '../lib/readerNotes.ts';
import { PinButton } from './Clues.tsx';
import { useLoad } from '../lib/useLoad.ts';

/**
 * "Save this page": a toggle that keeps the page in the reader's own saved pages, with a small menu to
 * file it in reading lists too. Only the page id is stored.
 */
export function SaveButton({ articleId }: { articleId: string }) {
  const state = useLoad(async () => {
    const [marks, lists] = await Promise.all([bookmarksForPage(articleId), listReadingLists()]);
    return { marks, lists };
  }, [articleId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const marks = state.data?.marks ?? [];
  const lists = state.data?.lists ?? [];
  const unsorted = marks.find((m) => m.list_id === null);
  const saved = marks.length > 0;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      state.reload();
    } catch (e) {
      setError(noteErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // Not loaded (or the tables are not there yet): offer nothing rather than a button that cannot work.
  if (state.error) return null;
  if (!state.data) return <div className="article-save" aria-hidden="true" />;
  return (
    <div className="article-save">
      <button
        type="button"
        className={saved ? 'button small save-toggle save-on' : 'button small secondary save-toggle'}
        aria-pressed={saved}
        aria-label="Save this page"
        disabled={busy}
        onClick={() => void run(async () => {
          if (saved) await Promise.all(marks.map((m) => removeBookmark(m.id)));
          else await savePage(articleId, null);
        })}
      >
        <span aria-hidden="true">{saved ? '★' : '☆'}</span> {saved ? 'Saved' : 'Save'}
      </button>
      <details className="save-menu">
        <summary className="button small secondary">Add to a list</summary>
        <div className="save-menu-body panel">
          {lists.length === 0 ? (
            <p className="muted">You have no reading lists yet. Make one on <Link to="/saved">Saved pages</Link>.</p>
          ) : (
            <ul className="plain-list">
              {lists.map((l) => {
                const mark = marks.find((m) => m.list_id === l.id);
                return (
                  <li key={l.id}>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={Boolean(mark)}
                        disabled={busy}
                        onChange={() => void run(() => (mark ? removeBookmark(mark.id) : savePage(articleId, l.id)))}
                      />
                      {l.name}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {unsorted && <p className="fine-print">Also kept in your unsorted saved pages.</p>}
        </div>
      </details>
      <PinButton refType="article" refId={articleId} />
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
