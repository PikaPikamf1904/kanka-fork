import { useState } from 'react';
import { buildExport, type ExportStats } from '../../lib/knowledgeExport/build.ts';
import { ExportRefused, loadExportData } from '../../lib/knowledgeExport/load.ts';
import { DEFAULT_OPTIONS, type ExportOptions } from '../../lib/knowledgeExport/types.ts';
import { useSession } from '../../lib/session.tsx';
import { supabase } from '../../lib/supabase.ts';
import { zipFiles } from '../../lib/zip.ts';

type Kind = 'archive' | 'notebook';
type Choices = Omit<ExportOptions, 'siteUrl'>;

const CHOICES: { key: keyof Choices; label: string; hint: string }[] = [
  { key: 'dmSecrets', label: 'Include DM secrets', hint: 'DM-only pages, sections, facts and connections, drafts, mysteries and dossiers. Off: only what players can read.' },
  { key: 'plans', label: 'Include future campaign plans', hint: 'Material marked “planned, not yet played”.' },
  { key: 'dmNotes', label: 'Include DM notes and research', hint: 'Your notes and your own Knowledge Studio collections. Chronicle does not label them, so they are marked “Unclassified”.' },
  { key: 'sessions', label: 'Include session history', hint: 'Session journals and the timeline.' },
  { key: 'relationships', label: 'Include saved connections', hint: 'Every connection between pages, with its custom description.' },
];

/** Saves a file on the reader's device. Nothing is uploaded or stored anywhere else. */
function save(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Some phones read the file after the click returns; release it a minute later.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * /dm/export: a private copy of the campaign's knowledge, for keeping and for NotebookLM. Built in
 * this browser from the DM's own reads; the database's own rules decide what can be read.
 */
export function KnowledgeExport() {
  const { state } = useSession();
  const [choices, setChoices] = useState<Choices>(DEFAULT_OPTIONS);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ kind: Kind; files: string[]; stats: ExportStats } | null>(null);

  const run = async (kind: Kind) => {
    if (state.kind !== 'member' || state.role !== 'dm') return;
    setBusy(kind);
    setError('');
    setDone(null);
    setProgress('Reading Chronicle…');
    try {
      const data = await loadExportData(supabase, {
        userId: state.userId,
        onProgress: (n, total) => setProgress(`Reading Chronicle… ${Math.round((n / total) * 100)}%`),
      });
      setProgress('Writing the files…');
      const built = buildExport(data, { ...choices, siteUrl: window.location.origin });
      const day = data.generatedAt.slice(0, 10);
      if (kind === 'archive') {
        const name = `Chronicle-Export-${day}.zip`;
        save(name, new Blob([zipFiles(built.archive) as BlobPart], { type: 'application/zip' }));
        setDone({ kind, files: [name], stats: built.stats });
      } else if (built.notebook.length === 1) {
        const name = built.notebook[0]!.name.replace('.md', `-${day}.md`);
        save(name, new Blob([built.notebook[0]!.text], { type: 'text/markdown;charset=utf-8' }));
        setDone({ kind, files: [name], stats: built.stats });
      } else {
        // Too large for one NotebookLM source: one archive holding the parts, each a source.
        const name = `Chronicle-Knowledge-${day}-${built.notebook.length}-parts.zip`;
        save(name, new Blob([zipFiles(built.notebook.map((d) => ({ path: d.name, text: d.text }))) as BlobPart], { type: 'application/zip' }));
        setDone({ kind, files: built.notebook.map((d) => d.name), stats: built.stats });
      }
      setProgress('');
    } catch (e) {
      setProgress('');
      // Only the message: never the data.
      setError(e instanceof ExportRefused ? e.message : `The export did not finish: ${e instanceof Error ? e.message : 'unknown error'}. Nothing was saved. Try again.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="export-page">
      <h1 className="page-title">Export Chronicle Knowledge</h1>
      <p className="lede">Create a private knowledge archive for research, brainstorming, and use with NotebookLM.</p>

      <section className="panel">
        <h2>What to include</h2>
        <fieldset className="export-choices" disabled={busy !== null}>
          <legend className="visually-hidden">What to include</legend>
          {CHOICES.map((c) => (
            <label key={c.key} className="check-row export-choice">
              <input type="checkbox" checked={choices[c.key]} onChange={(e) => setChoices({ ...choices, [c.key]: e.target.checked })} />
              <span><strong>{c.label}</strong><br /><span className="muted">{c.hint}</span></span>
            </label>
          ))}
        </fieldset>
        <p className="muted">Players&apos; private journals and scratchpads are never exported.</p>
      </section>

      <section className="panel">
        <h2>Download</h2>
        <div className="export-actions">
          <button type="button" className="button" disabled={busy !== null} onClick={() => void run('notebook')}>
            {busy === 'notebook' ? 'Preparing…' : 'NotebookLM knowledge document (Markdown)'}
          </button>
          <button type="button" className="button secondary" disabled={busy !== null} onClick={() => void run('archive')}>
            {busy === 'archive' ? 'Preparing…' : 'Complete Chronicle archive (ZIP)'}
          </button>
        </div>
        <p className="muted">The file is made in this browser and saved to this device only. It is not stored on Chronicle&apos;s servers{choices.dmSecrets ? ' and it contains DM secrets: keep it private' : ''}.</p>
        <p role="status" aria-live="polite" className="export-progress">{progress}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {done && (
          <div className="export-done" data-testid="export-done">
            <p><strong>Saved {done.files.length === 1 ? done.files[0] : `${done.files.length} files`}.</strong> {done.stats.articles} pages, {done.stats.relations} connections, about {done.stats.words.toLocaleString()} words.</p>
            {done.kind === 'notebook' && (
              <p className="muted">
                In NotebookLM, open your notebook, choose <em>Add source</em>, then <em>Upload</em>, and pick {done.files.length === 1 ? 'this file' : 'each Markdown file inside the ZIP (unzip it first; NotebookLM does not read ZIP files)'}.
              </p>
            )}
            {done.kind === 'archive' && <p className="muted">The archive is for keeping and browsing. For NotebookLM, use the knowledge document.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
