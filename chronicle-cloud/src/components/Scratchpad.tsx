import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChronicleError } from '../lib/changeSetTypes.ts';
import { deleteScratchpad, loadScratchpad, noteErrorMessage, saveScratchpad } from '../lib/readerNotes.ts';
import { useUnsavedGuard } from '../lib/useUnsavedGuard.ts';

export const SCRATCHPAD_CONFLICT = 'This note was changed on another device. Copy your text, reload, and try again.';
const AUTOSAVE_MS = 2000;
const MAX = 5000;

type Status = 'loading' | 'ready' | 'saving' | 'saved' | 'conflict' | 'error' | 'load-error';

/**
 * A personal note, for one page or (articleId null) in general. Only its owner can read it: the
 * database has no policy that lets anyone else, the DM included, see these rows. Saves send the
 * version that was loaded, and one save runs at a time, so a slow autosave and a click on Save
 * cannot conflict with each other. A change made on another device is never overwritten.
 */
export function ScratchpadEditor({ articleId }: { articleId: string | null }) {
  const id = useId();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');
  const [savedText, setSavedText] = useState('');
  const latest = useRef({ text: '', saved: '', version: null as number | null, noteId: null as string | null, conflict: false });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const note = await loadScratchpad(articleId);
      const body = note?.body ?? '';
      latest.current = { text: body, saved: body, version: note?.version ?? null, noteId: note?.id ?? null, conflict: false };
      setText(body);
      setSavedText(body);
      setStatus('ready');
      setMessage('');
    } catch (e) {
      setStatus('load-error');
      setMessage(noteErrorMessage(e));
    }
  }, [articleId]);
  useEffect(() => {
    // Loads the note from the database when the editor opens; state is set after the request returns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => window.clearTimeout(timer.current);
  }, [load]);

  const doSave = useCallback(async () => {
    const s = latest.current;
    if (s.conflict || s.text === s.saved) return;
    const body = s.text;
    setStatus('saving');
    try {
      if (body === '') {
        if (s.noteId) await deleteScratchpad(s.noteId);
        s.noteId = null;
        s.version = null;
      } else {
        const row = await saveScratchpad(articleId, body, s.version);
        s.noteId = row.id;
        s.version = row.version;
      }
      s.saved = body;
      setSavedText(body);
      setStatus('saved');
      setMessage('');
    } catch (e) {
      if (e instanceof ChronicleError && e.code === 'CONFLICT') {
        s.conflict = true;
        setStatus('conflict');
        setMessage(SCRATCHPAD_CONFLICT);
      } else {
        setStatus('error');
        setMessage(noteErrorMessage(e));
      }
    }
  }, [articleId]);

  const save = useCallback(() => {
    window.clearTimeout(timer.current);
    queue.current = queue.current.then(doSave);
    return queue.current;
  }, [doSave]);

  function change(value: string) {
    setText(value);
    latest.current.text = value;
    window.clearTimeout(timer.current);
    if (!latest.current.conflict) timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
  }

  const dirty = status !== 'loading' && status !== 'load-error' && text !== savedText;
  useUnsavedGuard(dirty);

  if (status === 'loading') return <p className="muted" role="status">Opening your note…</p>;
  if (status === 'load-error') {
    return (
      <div className="notice" role="alert">
        <p>Could not open your note. {message}</p>
        <button type="button" className="button secondary small" onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  return (
    <div className="scratchpad-editor">
      <label htmlFor={id}>My note</label>
      <textarea
        id={id}
        value={text}
        maxLength={MAX}
        rows={6}
        onChange={(e) => change(e.target.value)}
        aria-describedby={`${id}-help`}
      />
      <p id={`${id}-help`} className="fine-print">Only you can see this note. It saves by itself a moment after you stop typing. {text.length} of {MAX} characters.</p>
      <div className="button-row">
        <button type="button" className="button small" disabled={status === 'saving' || !dirty || status === 'conflict'} onClick={() => void save()}>Save note</button>
        {status === 'conflict' && <button type="button" className="button secondary small" onClick={() => void load()}>Load the newest note</button>}
        <span className="muted" role="status">
          {status === 'saving' ? 'Saving…' : status === 'saved' && !dirty ? 'Saved.' : dirty && status !== 'conflict' ? 'Unsaved changes' : ''}
        </span>
      </div>
      {(status === 'conflict' || status === 'error') && <p className="form-error" role="alert">{message}</p>}
    </div>
  );
}

/** The collapsible panel on an article page. The note is only fetched once the panel is opened. */
export function ScratchpadPanel({ articleId }: { articleId: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <details className="panel scratchpad" onToggle={(e) => { if (e.currentTarget.open) setOpened(true); }}>
      <summary>My scratchpad</summary>
      {opened && <ScratchpadEditor key={articleId} articleId={articleId} />}
    </details>
  );
}
