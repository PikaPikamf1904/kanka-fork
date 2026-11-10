import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { importDraftArticle, importRelation, listImportStates, type ImportState } from '../../lib/api.ts';
import { danglingLinks, parsePackageText, PACKAGE_LIMITS, type ParsedPackage } from '../../lib/lorePackage.ts';
import { useIsDm } from '../../lib/session.tsx';
import { TEMPLATES } from '../../lib/templates.ts';
import { useLoad } from '../../lib/useLoad.ts';

type Outcome = { slug: string; title: string; result: 'created' | 'replaced' | 'skipped' | 'failed'; detail?: string };

const ACTION: Record<ImportState, string> = {
  absent: 'Create private draft',
  present: 'Already in the wiki (left alone)',
  incomplete: 'Unfinished from an earlier import (replace)',
};

/**
 * Import a lore package as DM-only drafts. Runs entirely as the signed-in DM: the database's own
 * rules decide what may be written, and nothing here can publish a page or make it visible to
 * players, whatever the file contains.
 */
export function BulkLoreImport() {
  const isDm = useIsDm();
  const states = useLoad(listImportStates, []);
  const [filename, setFilename] = useState('');
  const [pack, setPack] = useState<ParsedPackage | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, of: 0 });
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [fatal, setFatal] = useState('');
  const [connections, setConnections] = useState<{ created: number; skipped: number } | null>(null);
  const stop = useRef(false);

  const stateOf = (slug: string): ImportState => states.data?.get(slug)?.state ?? 'absent';
  const importable = useMemo(
    () => (pack?.articles ?? []).filter((a) => (states.data?.get(a.slug)?.state ?? 'absent') !== 'present'),
    [pack, states.data],
  );
  const selected = importable.filter((a) => chosen.has(a.slug));
  const dangling = useMemo(
    () => (pack ? danglingLinks(pack.articles, new Set(states.data?.keys() ?? [])) : []),
    [pack, states.data],
  );

  // Leaving mid-import is recoverable, but worth a warning.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  async function chooseFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPack(null); setOutcomes([]); setFatal(''); setFilename(''); setConnections(null); setChosen(new Set());
    if (!file) return;
    if (file.size > PACKAGE_LIMITS.fileBytes) {
      setFatal('The file is too large (limit 2 MB).');
      return;
    }
    const parsed = parsePackageText(await file.text());
    setFilename(file.name);
    setPack(parsed);
    setChosen(new Set(parsed.articles.map((a) => a.slug)));
  }

  async function runImport() {
    if (!isDm || busy || !pack || selected.length === 0) return;
    if (!window.confirm(`Import ${selected.length} ${selected.length === 1 ? 'page' : 'pages'} as private drafts? Pages already in the wiki are left alone, and nothing is published.`)) return;
    setBusy(true); setFatal(''); setOutcomes([]); setConnections(null);
    stop.current = false;
    const results: Outcome[] = [];
    const ids = new Map<string, string>();
    try {
      // Look again, so a page created since the preview (or in another tab) is never duplicated.
      const current = await listImportStates();
      for (const [slug, v] of current) ids.set(slug, v.id);
      setProgress({ done: 0, of: selected.length });
      for (const [i, a] of selected.entries()) {
        if (stop.current) {
          results.push({ slug: a.slug, title: a.title, result: 'skipped', detail: 'Import stopped before this page.' });
          continue;
        }
        const now = current.get(a.slug);
        if (now?.state === 'present') {
          results.push({ slug: a.slug, title: a.title, result: 'skipped', detail: 'Already in the wiki.' });
        } else {
          try {
            const row = await importDraftArticle(a, now?.state === 'incomplete' ? now.id : undefined);
            ids.set(a.slug, row.id);
            results.push({ slug: a.slug, title: a.title, result: now?.state === 'incomplete' ? 'replaced' : 'created' });
          } catch (err) {
            ids.delete(a.slug);
            results.push({ slug: a.slug, title: a.title, result: 'failed', detail: err instanceof Error ? err.message : 'Could not be saved.' });
          }
        }
        setProgress({ done: i + 1, of: selected.length });
        setOutcomes([...results]);
      }
      // Connections only between pages that are really there now.
      const made = new Set(results.filter((r) => r.result === 'created' || r.result === 'replaced').map((r) => r.slug));
      let created = 0;
      let skipped = 0;
      for (const r of pack.relations) {
        if (stop.current || (!made.has(r.source) && !made.has(r.target))) {
          skipped++;
          continue;
        }
        try {
          if ((await importRelation(r, ids)) === 'created') created++;
          else skipped++;
        } catch {
          skipped++;
        }
      }
      if (pack.relations.length > 0) setConnections({ created, skipped });
    } catch (err) {
      setFatal(err instanceof Error ? err.message : 'The import could not start.');
    } finally {
      setOutcomes(results);
      setBusy(false);
      states.reload();
    }
  }

  if (!isDm) return <p role="alert">Only the Dungeon Master may import lore.</p>;
  const count = (r: Outcome['result']) => outcomes.filter((o) => o.result === r).length;
  const finished = !busy && outcomes.length > 0;

  return (
    <div>
      <p className="muted"><Link to="/dm">DM desk</Link> › Lore import</p>
      <h1 className="page-title">Import campaign lore</h1>

      <section className="panel">
        <h2>Choose a package</h2>
        <p>
          A lore package is a JSON file of draft pages. You will see every page before anything is saved. Imported pages are always
          {' '}<strong>private drafts</strong>: only you can see them until you publish each one yourself. Pages that already exist are never changed.
        </p>
        <label>Package (.json)<input type="file" accept="application/json,.json" onChange={(e) => void chooseFile(e)} disabled={busy} /></label>
        {fatal && <p className="form-error" role="alert">{fatal}</p>}
        {states.error && <p className="form-error" role="alert">Could not check which pages already exist: {states.error}</p>}
      </section>

      {pack && pack.errors.length > 0 && (
        <section className="panel" aria-labelledby="import-problems">
          <h2 id="import-problems">{pack.articles.length === 0 ? 'This package cannot be imported' : `${pack.errors.length} ${pack.errors.length === 1 ? 'entry' : 'entries'} will not be imported`}</h2>
          <ul>
            {pack.errors.map((e, i) => <li key={i}><strong>{e.index > 0 ? `${e.index}. ` : ''}{e.name}</strong>: {e.message}</li>)}
          </ul>
        </section>
      )}

      {pack && pack.articles.length > 0 && (
        <section className="panel">
          <h2>Preview</h2>
          <p className="muted" data-testid="import-summary">
            {filename} · {pack.articles.length} readable {pack.articles.length === 1 ? 'page' : 'pages'} · {importable.length} to import · {pack.articles.length - importable.length} already in the wiki
            {pack.relations.length > 0 && <> · {pack.relations.length} connections</>}
          </p>
          {pack.warnings.length > 0 && (
            <ul className="fine-print">
              {pack.warnings.map((w, i) => <li key={i}>{w.index > 0 ? `${w.name}: ` : ''}{w.message}</li>)}
            </ul>
          )}
          {dangling.length > 0 && (
            <p className="fine-print">
              {dangling.length} {dangling.length === 1 ? 'page links' : 'pages link'} to pages that are not in this package or the wiki
              ({dangling.slice(0, 5).map((d) => d.targets[0]).join(', ')}{dangling.length > 5 ? '…' : ''}). Those links will show as missing pages until you create them.
            </p>
          )}
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th scope="col">Import</th><th scope="col">Title</th><th scope="col">Type</th><th scope="col">Address</th><th scope="col">Sections</th><th scope="col">What will happen</th></tr>
              </thead>
              <tbody>
                {pack.articles.map((a) => {
                  const state = stateOf(a.slug);
                  return (
                    <tr key={a.slug}>
                      <td>
                        <input
                          type="checkbox" aria-label={`Import ${a.title}`} disabled={busy || state === 'present'}
                          checked={state !== 'present' && chosen.has(a.slug)}
                          onChange={(e) => setChosen((c) => { const n = new Set(c); if (e.target.checked) n.add(a.slug); else n.delete(a.slug); return n; })}
                        />
                      </td>
                      <td>{a.title}</td>
                      <td>{TEMPLATES[a.type].label}</td>
                      <td><code>{a.slug}</code></td>
                      <td>{a.sections.length}</td>
                      <td>{ACTION[state]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>
            <button type="button" className="button" disabled={busy || selected.length === 0 || states.loading || Boolean(states.error)} onClick={() => void runImport()}>
              {busy ? `Importing ${progress.done} of ${progress.of}…` : `Import ${selected.length} private ${selected.length === 1 ? 'draft' : 'drafts'}`}
            </button>
            {busy && <> <button type="button" className="button secondary" onClick={() => { stop.current = true; }}>Stop after this page</button></>}
          </p>
          {busy && <progress value={progress.done} max={progress.of} aria-label="Import progress" />}
        </section>
      )}

      {outcomes.length > 0 && (
        <section className="panel" aria-live="polite">
          <h2>{finished ? (count('failed') > 0 ? 'Import finished with problems' : 'Import finished') : 'Importing…'}</h2>
          {finished && (
            <p data-testid="import-result">
              {count('created') + count('replaced')} created · {count('skipped')} skipped · {count('failed')} failed
              {connections && <> · {connections.created} connections added</>}
            </p>
          )}
          {finished && count('failed') > 0 && (
            <p className="form-error" role="alert">Some pages were not saved. Nothing partial was left behind; fix the cause and run the import again, and only the missing pages will be created.</p>
          )}
          <ul>
            {outcomes.map((o) => (
              <li key={o.slug}>
                {o.result === 'failed' ? '✗' : o.result === 'skipped' ? '–' : '✓'}{' '}
                {o.result === 'created' || o.result === 'replaced' ? <Link to={`/dm/edit/${o.slug}`}>{o.title}</Link> : o.title}
                {' · '}{o.result === 'created' ? 'private draft created' : o.result === 'replaced' ? 'unfinished page replaced' : o.result}
                {o.detail && <> ({o.detail})</>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="muted">Imported pages appear in the review list on the <Link to="/dm">DM desk</Link>. Add artwork and publish each page from its editor when the story has reached the table.</p>
    </div>
  );
}
