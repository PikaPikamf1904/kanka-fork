// Staged lore imports: choose many files, review what Chronicle would do with each entry, approve or
// reject entries one by one or in groups, and save the approved ones as DM-only drafts in small,
// resumable parts. See src/lib/loreImport.ts for the rules (nothing is published, existing pages
// only gain additions, conflicts are reported and never applied).
import { useMemo, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  deleteImportBatch, getImportBatch, importChangeSets, listImportBatches, loadWikiIndex, stageImportBatch, updateImportBatch, type ImportBatch,
} from '../../lib/api.ts';
import { applyChanges, ChronicleError, previewChanges } from '../../lib/changeSets.ts';
import {
  analyzeImport, CANON_LABEL, chunkKeyPrefix, decisionOf, IMPORT_LIMITS, importReport, nextChunk, parseImportFiles, pendingRelations, recoverProgress, relationDecision,
  type Decisions, type ImportAnalysis, type ItemAnalysis, type ProgressEntry, type StagedImport, type WikiIndex,
} from '../../lib/loreImport.ts';
import { TEMPLATES, TYPE_ORDER } from '../../lib/templates.ts';
import type { ArticleType } from '../../lib/types.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { useUnsavedGuard } from '../../lib/useUnsavedGuard.ts';
import { NotFound } from '../NotFound.tsx';

/** [[target|text]] and [[target]] shown as their text. */
const plain = (s: string) => s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');

const STATE_LABEL = { staged: 'Waiting for review', saving: 'Partly saved', done: 'Saved', abandoned: 'Discarded' } as const;

/** Choose files and stage them; list earlier imports (including ones an assistant staged). */
export function ImportBatchesPage() {
  const navigate = useNavigate();
  const batches = useLoad(listImportBatches, []);
  const [files, setFiles] = useState<{ name: string; text: string }[]>([]);
  const [staged, setStaged] = useState<StagedImport | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    setError(''); setStaged(null);
    const list = [...(e.target.files ?? [])];
    if (list.length === 0) return;
    if (list.length > IMPORT_LIMITS.files) {
      setError(`Choose at most ${IMPORT_LIMITS.files} files at a time.`);
      return;
    }
    const read = await Promise.all(list.map(async (f) => ({ name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, text: await f.text() })));
    setFiles(read);
    setStaged(parseImportFiles(read));
    if (!label) setLabel(read.length === 1 ? read[0]!.name : `${read.length} files`);
  }

  async function stage() {
    if (!staged || staged.items.length === 0 || busy) return;
    setBusy(true); setError('');
    try {
      const id = await stageImportBatch(label.trim() || 'Lore import', files.map((f) => f.name).join(', '), staged);
      navigate(`/dm/import/${id}`);
    } catch (err) {
      setError(err instanceof Error ? `Not staged: ${err.message}` : 'Not staged. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="import-page">
      <p className="muted"><Link to="/dm">DM desk</Link> › <Link to="/dm/import">Lore import</Link> › Many files</p>
      <h1 className="page-title">Import a collection of lore</h1>
      <p>Choose Markdown notes (<code>.md</code>) or lore packages (<code>.json</code>), up to {IMPORT_LIMITS.files} files and {IMPORT_LIMITS.totalBytes / 1_000_000} MB at a time.
        Chronicle reads them, works out what each entry is, and compares it with the wiki. <strong>Nothing is saved until you review the batch and save the entries you approve, as DM-only drafts.</strong></p>
      <details className="panel fine-print">
        <summary>How to write a Markdown note</summary>
        <p>One file per page, starting with optional details between <code>---</code> lines; or several pages in one file, each starting with <code># Title</code>.</p>
        <pre>{`---
title: Kalaman
type: location          # character, location, faction, item, quest, session, event, lore
canon: confirmed        # confirmed, uncertain, rumor or planned (default: uncertain)
tags: [Solamnia, Cities]
aliases: [The Harbour City]
---
One-paragraph summary.

## History
Text. Link other pages like [[Lord Bakaris]].

## Facts
- Ruler: …

## DM notes
Private notes stay private.`}</pre>
      </details>
      <section className="panel">
        <label className="field-label">Lore files
          <input type="file" multiple accept=".md,.markdown,.txt,.json" onChange={(e) => void choose(e)} data-testid="lore-files" />
        </label>
        {staged && (
          <div data-testid="stage-summary">
            <p><strong>{staged.items.length}</strong> {staged.items.length === 1 ? 'entry' : 'entries'} read from {files.length} {files.length === 1 ? 'file' : 'files'}
              {staged.relations.length > 0 && <>, {staged.relations.length} stated connections</>}.</p>
            {staged.errors.length > 0 && (
              <div className="callout" role="alert">
                <strong>{staged.errors.length} {staged.errors.length === 1 ? 'entry or file was' : 'entries or files were'} not read:</strong>
                <ul>{staged.errors.slice(0, 50).map((e, i) => <li key={i}>{e.name}: {e.message}</li>)}</ul>
              </div>
            )}
            {staged.warnings.length > 0 && <ul className="fine-print">{staged.warnings.slice(0, 50).map((w, i) => <li key={i}>{w.name}: {w.message}</li>)}</ul>}
            <label>Name for this import<input value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} /></label>
            <p><button type="button" className="button" disabled={busy || staged.items.length === 0} onClick={() => void stage()}>{busy ? 'Staging…' : 'Stage for review'}</button></p>
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
      <section className="panel">
        <h2>Imports</h2>
        {batches.error && <p className="form-error" role="alert">{batches.error}</p>}
        {batches.data?.length === 0 && <p className="muted">None yet.</p>}
        <ul className="import-batch-list">
          {batches.data?.map((b) => (
            <li key={b.id}>
              <Link to={`/dm/import/${b.id}`}>{b.label}</Link>{' '}
              <span className="badge">{STATE_LABEL[b.status]}</span>{' '}
              <span className="muted fine-print">{b.entries} entries · {new Date(b.created_at).toLocaleDateString()} · {b.created_via === 'web' ? 'you' : 'an assistant'}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

type Filter = 'all' | 'new' | 'existing' | 'duplicates' | 'conflicts' | 'guessed' | 'approved' | 'not_approved' | 'saved';
const FILTERS: [Filter, string][] = [
  ['all', 'All'], ['new', 'New pages'], ['existing', 'Additions to existing pages'], ['duplicates', 'Possible duplicates'], ['conflicts', 'Conflicting facts'],
  ['guessed', 'Type is a guess'], ['approved', 'Approved'], ['not_approved', 'Not approved'], ['saved', 'Already saved'],
];

interface Loaded { batch: ImportBatch; wiki: WikiIndex; progress: ProgressEntry[] }

/** Review one staged import and save the approved entries. */
export function ImportReviewPage() {
  const { batchId = '' } = useParams();
  const navigate = useNavigate();
  const loaded = useLoad<Loaded | null>(async () => {
    const batch = await getImportBatch(batchId);
    if (!batch) return null;
    const [wiki, saved] = await Promise.all([loadWikiIndex(), importChangeSets(chunkKeyPrefix(batch.id))]);
    // Parts the engine saved but this batch did not record (a closed tab, a lost answer).
    const done = new Set(batch.progress.filter((p) => p.status === 'applied').flatMap((p) => p.slugs));
    const progress = recoverProgress(batch.id, batch.progress, saved, analyzeImport(batch.staged, wiki, done));
    return { batch, wiki, progress };
  }, [batchId]);
  const [decisions, setDecisions] = useState<Decisions | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saveState, setSaveState] = useState<{ done: number; total: number } | null>(null);

  const data = loaded.data;
  const d: Decisions | null = decisions ?? data?.batch.decisions ?? null;
  const dirty = decisions !== null && data !== null && data !== undefined && JSON.stringify(decisions) !== JSON.stringify(data.batch.decisions);
  useUnsavedGuard(dirty && busy === '');

  const analysis: ImportAnalysis | null = useMemo(() => {
    if (!data) return null;
    const done = new Set(data.progress.filter((p) => p.status === 'applied').flatMap((p) => p.slugs));
    return analyzeImport(data.batch.staged, data.wiki, done);
  }, [data]);

  if (loaded.loading && !data) return <p className="muted">Loading…</p>;
  if (loaded.error) return <p className="form-error" role="alert">{loaded.error}</p>;
  if (!data || !analysis || !d) return <NotFound what="import" />;
  const { batch } = data;
  const items = new Map(batch.staged.items.map((i) => [i.slug, i]));
  const doneRelations = new Set(data.progress.filter((p) => p.status === 'applied').flatMap((p) => p.relations ?? []));
  const approved = (a: ItemAnalysis) => a.action !== 'imported' && decisionOf(d, a.slug, a) === 'approve';
  const shown = analysis.items.filter((a) => {
    const it = items.get(a.slug)!;
    switch (filter) {
      case 'new': return a.action === 'create';
      case 'existing': return a.action === 'add_to_existing';
      case 'duplicates': return a.action !== 'imported' && (a.match !== null || a.similar_in_import.length > 0);
      case 'conflicts': return a.conflicts.length > 0;
      case 'guessed': return it.typeConfidence !== 'high';
      case 'approved': return approved(a);
      case 'not_approved': return a.action !== 'imported' && !approved(a);
      case 'saved': return a.action === 'imported';
      default: return true;
    }
  });
  const approvedItems = analysis.items.filter(approved);
  const approvedRelations = analysis.relations.filter((r) => !doneRelations.has(r.key) && relationDecision(d, r) === 'approve');
  const stuck = pendingRelations(analysis, d, data.wiki, doneRelations);
  const t = analysis.totals;

  const change = (fn: (x: Decisions) => void) => {
    const next: Decisions = JSON.parse(JSON.stringify(d));
    fn(next);
    setDecisions(next);
    setMessage(null);
  };

  async function saveChoices(): Promise<boolean> {
    if (!decisions) return true;
    try {
      await updateImportBatch(batch.id, { decisions });
      loaded.reload();
      setDecisions(null);
      return true;
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? `Your choices were not saved: ${err.message}` : 'Your choices were not saved.' });
      return false;
    }
  }

  /** Save approved entries one part at a time, re-reading the wiki before each part. */
  async function saveApproved() {
    if (busy) return;
    setBusy('saving'); setMessage(null);
    const choices = d!;
    if (decisions && !(await saveChoices())) { setBusy(''); return; }
    let progress = [...data!.progress];
    let saved = 0;
    try {
      await updateImportBatch(batch.id, { status: 'saving', progress });
      for (let guard = 0; guard < 500; guard++) {
        const wiki = await loadWikiIndex();
        const { chunk, remaining } = nextChunk(batch.staged, wiki, choices, batch.id, batch.label, progress);
        setSaveState({ done: saved, total: saved + remaining });
        if (!chunk) break;
        const preview = await previewChanges(chunk.changeSet);
        if (preview.conflicts.length > 0 || !preview.preview_id) {
          throw new ChronicleError('CONFLICT', `A page changed while you were reviewing (${preview.conflicts.map((c) => c.slug).join(', ')}). Nothing in this part was saved; the list below is up to date — check it and save again.`);
        }
        let result;
        try {
          result = await applyChanges(preview, chunk.idempotencyKey);
        } catch (err) {
          // A lost answer: send the same part again; the engine saves it once.
          if (err instanceof ChronicleError && err.code !== 'INTERNAL_ERROR' && err.code !== 'DEPENDENCY_UNAVAILABLE') throw err;
          result = await applyChanges(preview, chunk.idempotencyKey);
        }
        progress = [...progress, { chunk: chunk.index, key: chunk.idempotencyKey, slugs: chunk.slugs, relations: chunk.relationKeys, status: 'applied', change_set_id: result.change_set_id, at: new Date().toISOString() }];
        await updateImportBatch(batch.id, { progress });
        saved++;
      }
      await updateImportBatch(batch.id, { status: 'done', progress });
      setMessage({ ok: true, text: `Saved ${saved} ${saved === 1 ? 'part' : 'parts'}. Every new page and section is a DM-only draft. Nothing was published.` });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? `Saving stopped: ${err.message} Parts already saved stay saved; “Save approved entries” continues where it stopped.` : 'Saving stopped. Try again to continue.' });
    } finally {
      setBusy(''); setSaveState(null);
      loaded.reload();
    }
  }

  function downloadReport() {
    const text = importReport(batch.label, batch.staged, analysis!, d!, data!.progress);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-report-${batch.id.slice(0, 8)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function discard() {
    if (!window.confirm('Discard this import? Pages already saved from it stay in the wiki as drafts.')) return;
    try {
      await deleteImportBatch(batch.id);
      navigate('/dm/import/batches');
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? `Not discarded: ${err.message}` : 'Not discarded.' });
    }
  }

  return (
    <div className="import-page">
      <p className="muted"><Link to="/dm">DM desk</Link> › <Link to="/dm/import/batches">Imports</Link> › {batch.label}</p>
      <h1 className="page-title">Review import: {batch.label}</h1>
      <p className="muted">{STATE_LABEL[batch.status]} · staged by {batch.created_via === 'web' ? 'you' : 'an assistant'} on {new Date(batch.created_at).toLocaleString()} · {batch.source_name}</p>

      <section className="panel" aria-label="What this import would do">
        <dl className="import-totals" data-testid="import-totals">
          <div><dt>New pages</dt><dd>{t.create}</dd></div>
          <div><dt>Additions to existing pages</dt><dd>{t.add_to_existing}</dd></div>
          <div><dt>Possible duplicates</dt><dd>{t.duplicates}</dd></div>
          <div><dt>Conflicting facts</dt><dd>{t.conflicts}</dd></div>
          <div><dt>Connections</dt><dd>{t.relations} stated · {t.suggested_relations} suggested</dd></div>
          <div><dt>Already saved</dt><dd>{t.imported}</dd></div>
        </dl>
        <p className="fine-print">Everything this import saves is <strong>DM-only and unpublished</strong>. An existing page only gains new sections, new facts and private notes, and only if you approve it here; a fact that disagrees with the wiki is listed as a conflict and never changed. Approved now: <strong>{approvedItems.length}</strong> {approvedItems.length === 1 ? 'entry' : 'entries'} and {approvedRelations.length} connections.</p>
        {batch.staged.errors.length > 0 && <p className="fine-print">{batch.staged.errors.length === 1 ? '1 entry or file' : `${batch.staged.errors.length} entries or files`} could not be read; they are listed in the report.</p>}
        {message && <p className={message.ok ? 'form-ok' : 'form-error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
        {saveState && (
          <p role="status">Saving part {Math.min(saveState.done + 1, saveState.total)} of {saveState.total}… <progress max={Math.max(saveState.total, 1)} value={saveState.done} /></p>
        )}
        <div className="row-wrap">
          <button type="button" className="button" disabled={busy !== '' || (approvedItems.length === 0 && approvedRelations.length === 0) || batch.status === 'abandoned'} onClick={() => void saveApproved()}>
            {busy === 'saving' ? 'Saving…' : batch.status === 'saving' ? 'Continue saving approved entries' : 'Save approved entries as DM-only drafts'}
          </button>
          {dirty && <button type="button" className="button secondary" disabled={busy !== ''} onClick={() => void saveChoices()}>Save my choices</button>}
          <button type="button" className="button secondary" onClick={downloadReport}>Download report</button>
          <button type="button" className="button secondary" disabled={busy !== ''} onClick={() => void discard()}>Discard import</button>
          {dirty && <span className="badge badge-draft">Choices not saved</span>}
        </div>
        {stuck.length > 0 && <p className="fine-print">{stuck.length} approved connections join a page you have not approved; they will not be saved.</p>}
      </section>

      <section className="panel">
        <div className="row-wrap">
          <label>Show
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Show entries">
              {FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <button type="button" className="button small secondary" disabled={busy !== ''} onClick={() => change((x) => { for (const a of shown) if (a.action !== 'imported') x.items[a.slug] = 'approve'; })}>Approve all shown</button>
          <button type="button" className="button small secondary" disabled={busy !== ''} onClick={() => change((x) => { for (const a of shown) if (a.action !== 'imported') x.items[a.slug] = 'reject'; })}>Reject all shown</button>
          <span className="muted fine-print">{shown.length} shown</span>
        </div>
        <ul className="import-items">
          {shown.slice(0, 300).map((a) => {
            const it = items.get(a.slug)!;
            const type = d.types[a.slug] ?? it.type;
            const on = approved(a);
            return (
              <li key={a.slug} className={`import-item${on ? ' approved' : ''}`} data-testid={`import-item-${a.slug}`}>
                <div className="import-item-head">
                  {a.action === 'imported' ? <span className="badge">Saved</span> : (
                    <label className="checkbox">
                      <input type="checkbox" checked={on} disabled={busy !== ''} onChange={(e) => change((x) => { x.items[a.slug] = e.target.checked ? 'approve' : 'reject'; })} />
                      <span className="visually-hidden">Approve {it.title}</span>
                    </label>
                  )}
                  <strong>{it.title}</strong>
                  <span className={`badge${it.canon === 'confirmed' ? '' : ' badge-draft'}`}>{CANON_LABEL[it.canon]}</span>
                </div>
                <p className="fine-print">
                  {a.action === 'create' ? 'New page' : a.action === 'imported' ? 'Already saved' : <>Adds to <Link to={`/wiki/${a.match!.slug}`}>{a.match!.title}</Link>{a.match!.player_visible ? ' (a page players can read; the additions stay DM-only)' : ''} — {a.match!.why}</>}
                  {' · '}from {it.source}
                </p>
                {a.action === 'create' && (
                  <label className="fine-print">Type{' '}
                    <select value={type} disabled={busy !== ''} aria-label={`Type of ${it.title}`} onChange={(e) => change((x) => { x.types[a.slug] = e.target.value as ArticleType; })}>
                      {TYPE_ORDER.map((k) => <option key={k} value={k}>{TEMPLATES[k].label}</option>)}
                    </select>
                    {' '}{it.typeConfidence === 'high' ? '' : <span className="muted">({it.typeConfidence === 'low' ? 'guess' : 'likely'}: {it.typeReason})</span>}
                  </label>
                )}
                {a.similar_in_import.length > 0 && <p className="fine-print form-error">May be the same subject as: {a.similar_in_import.join(', ')} (in this import).</p>}
                {a.conflicts.length > 0 && (
                  <ul className="fine-print import-conflicts" aria-label={`Conflicts for ${it.title}`}>
                    {a.conflicts.map((c) => <li key={c.label}><strong>{c.label}</strong>: the wiki says “{c.existing}”, this import says “{c.imported}”. Not changed; noted privately.</li>)}
                  </ul>
                )}
                {a.action === 'add_to_existing' && (a.new_fields.length > 0 || it.sections.length > 0) && (
                  <p className="fine-print">Would add {it.sections.length + (it.summary ? 1 : 0)} DM-only section(s){a.new_fields.length ? ` and new facts: ${a.new_fields.map((f) => f.label).join(', ')}` : ''}.</p>
                )}
                {it.summary && <p className="import-summary-text">{plain(it.summary).slice(0, 300)}{it.summary.length > 300 ? '…' : ''}</p>}
                {(a.links.missing.length > 0 || a.categories.missing.length > 0) && (
                  <p className="fine-print muted">
                    {a.links.missing.length > 0 && <>Links to pages that do not exist: {a.links.missing.join(', ')}. </>}
                    {a.categories.missing.length > 0 && <>Categories that do not exist (not created): {a.categories.missing.join(', ')}.</>}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {shown.length > 300 && <p className="muted">Showing the first 300; use the filter to narrow the list.</p>}
      </section>

      {analysis.relations.length > 0 && (
        <section className="panel">
          <h2>Connections</h2>
          <p className="fine-print">Stated ones come from the files; suggested ones only from a link in the text, and are not approved unless you tick them. Connections are DM-only.</p>
          <ul className="import-items">
            {analysis.relations.slice(0, 300).map((r) => {
              const done = doneRelations.has(r.key);
              return (
                <li key={r.key} className="import-relation">
                  {done ? <span className="badge">Saved</span> : (
                    <label className="checkbox">
                      <input type="checkbox" checked={relationDecision(d, r) === 'approve'} disabled={busy !== ''} onChange={(e) => change((x) => { x.relations[r.key] = e.target.checked ? 'approve' : 'reject'; })} />
                      <span className="visually-hidden">Approve connection {r.source} {r.kind} {r.target}</span>
                    </label>
                  )}
                  <span>{items.get(r.source)?.title ?? r.source} <em>{r.kind.replace(/_/g, ' ')}</em> {items.get(r.target)?.title ?? r.target}</span>{' '}
                  <span className="muted fine-print">({r.basis === 'stated' ? 'stated' : 'suggested from a link'})</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
