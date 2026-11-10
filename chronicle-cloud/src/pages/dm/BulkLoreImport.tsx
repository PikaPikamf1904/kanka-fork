import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { listAllArticleRefs } from '../../lib/api.ts';
import { applyChanges, ChronicleError, newIdempotencyKey, previewChanges, type ApplyResult, type Preview } from '../../lib/changeSets.ts';
import { danglingLinks, PACKAGE_LIMITS, packageToChangeSet, parsePackageText, type ParsedPackage } from '../../lib/lorePackage.ts';
import { useIsDm } from '../../lib/session.tsx';
import { TEMPLATES } from '../../lib/templates.ts';
import { useLoad } from '../../lib/useLoad.ts';

/**
 * Import a lore package as DM-only drafts through the editing engine: Chronicle checks the whole
 * package first, shows what will happen, and then saves all of it in one transaction, or none of
 * it. Retrying after a lost connection reuses the same key, so nothing is ever created twice.
 */
export function BulkLoreImport() {
  const isDm = useIsDm();
  const refs = useLoad(listAllArticleRefs, []);
  const [filename, setFilename] = useState('');
  const [pack, setPack] = useState<ParsedPackage | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'' | 'checking' | 'importing'>('');
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState('');
  const [canRetry, setCanRetry] = useState(false);

  const existing = useMemo(() => new Set((refs.data ?? []).map((r) => r.slug)), [refs.data]);
  const dangling = useMemo(() => (pack ? danglingLinks(pack.articles, existing) : []), [pack, existing]);
  const selected = (pack?.articles ?? []).filter((a) => chosen.has(a.slug));

  useEffect(() => {
    if (busy !== 'importing') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  function reset() {
    setPreview(null); setResult(null); setError(''); setCanRetry(false); setKey('');
  }

  async function chooseFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    reset(); setPack(null); setFilename(''); setChosen(new Set());
    if (!file) return;
    if (file.size > PACKAGE_LIMITS.fileBytes) {
      setError('The file is too large (limit 1 MB).');
      return;
    }
    const parsed = parsePackageText(await file.text());
    setFilename(file.name);
    setPack(parsed);
    setChosen(new Set(parsed.articles.filter((a) => !existing.has(a.slug)).map((a) => a.slug)));
  }

  function toggle(slug: string, on: boolean) {
    reset();
    setChosen((c) => {
      const n = new Set(c);
      if (on) n.add(slug); else n.delete(slug);
      return n;
    });
  }

  async function check() {
    if (!pack || selected.length === 0) return;
    reset(); setBusy('checking');
    try {
      setPreview(await previewChanges(packageToChangeSet(pack, chosen, `Lore import: ${filename}`)));
      setKey(newIdempotencyKey());
    } catch (err) {
      setError(err instanceof ChronicleError ? err.message : 'Chronicle could not check this package.');
    } finally {
      setBusy('');
    }
  }

  async function runImport() {
    if (!preview?.preview_id || !key || busy) return;
    setBusy('importing'); setError(''); setCanRetry(false);
    try {
      setResult(await applyChanges(preview, key));
      refs.reload();
    } catch (err) {
      if (err instanceof ChronicleError && err.code !== 'INTERNAL_ERROR') {
        setError(`${err.message} Nothing was saved.`);
        if (err.code === 'CONFLICT' || err.code === 'PREVIEW_EXPIRED') setPreview(null);
      } else {
        // The connection may have dropped after Chronicle saved. Retrying with the same key is safe.
        setError('The connection was lost, so it is not certain whether the import was saved. Retry to find out; nothing will be created twice.');
        setCanRetry(true);
      }
    } finally {
      setBusy('');
    }
  }

  if (!isDm) return <p role="alert">Only the Dungeon Master may import lore.</p>;
  const willCreate = new Set(preview?.created ?? []);
  const action = (slug: string) => {
    if (!chosen.has(slug)) return 'Not selected';
    if (!preview) return existing.has(slug) ? 'Already in the wiki (left alone)' : 'Create private draft';
    if (willCreate.has(slug)) return 'Create private draft';
    if (preview.skipped.includes(slug)) return 'Already in the wiki (left alone)';
    return 'Create private draft';
  };

  return (
    <div>
      <p className="muted"><Link to="/dm">DM desk</Link> › Lore import</p>
      <h1 className="page-title">Import campaign lore</h1>

      <section className="panel">
        <h2>Choose a package</h2>
        <p>
          A lore package is a JSON file of draft pages. Chronicle checks the whole package and shows you what will happen before anything is saved.
          Imported pages are always <strong>private drafts</strong>, and pages that already exist are never changed. The import is saved in one step: all of it, or none of it.
        </p>
        <label>Package (.json)<input type="file" accept="application/json,.json" onChange={(e) => void chooseFile(e)} disabled={busy !== ''} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {refs.error && <p className="form-error" role="alert">Could not check which pages already exist: {refs.error}</p>}
      </section>

      {pack && pack.errors.length > 0 && (
        <section className="panel" aria-labelledby="import-problems">
          <h2 id="import-problems">{pack.articles.length === 0 ? 'This package cannot be imported' : `${pack.errors.length} ${pack.errors.length === 1 ? 'entry' : 'entries'} will not be imported`}</h2>
          <ul>{pack.errors.map((e, i) => <li key={i}><strong>{e.index > 0 ? `${e.index}. ` : ''}{e.name}</strong>: {e.message}</li>)}</ul>
        </section>
      )}

      {pack && pack.articles.length > 0 && (
        <section className="panel">
          <h2>Preview</h2>
          <p className="muted" data-testid="import-summary">
            {filename} · {pack.articles.length} readable {pack.articles.length === 1 ? 'page' : 'pages'} · {selected.length} selected
            {pack.relations.length > 0 && <> · {pack.relations.length} connections</>}
          </p>
          {pack.warnings.length > 0 && <ul className="fine-print">{pack.warnings.map((w, i) => <li key={i}>{w.index > 0 ? `${w.name}: ` : ''}{w.message}</li>)}</ul>}
          {dangling.length > 0 && (
            <p className="fine-print">
              {dangling.length} {dangling.length === 1 ? 'page links' : 'pages link'} to pages that are not in this package or the wiki
              ({dangling.slice(0, 5).map((d) => d.targets[0]).join(', ')}{dangling.length > 5 ? '…' : ''}). Those links will show as missing pages until you create them.
            </p>
          )}
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th scope="col">Import</th><th scope="col">Title</th><th scope="col">Type</th><th scope="col">Address</th><th scope="col">Sections</th><th scope="col">What will happen</th></tr></thead>
              <tbody>
                {pack.articles.map((a) => (
                  <tr key={a.slug}>
                    <td><input type="checkbox" aria-label={`Import ${a.title}`} disabled={busy !== '' || result !== null} checked={chosen.has(a.slug)} onChange={(e) => toggle(a.slug, e.target.checked)} /></td>
                    <td>{a.title}</td>
                    <td>{TEMPLATES[a.type].label}</td>
                    <td><code>{a.slug}</code></td>
                    <td>{a.sections.length}</td>
                    <td>{action(a.slug)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!preview && !result && (
            <p><button type="button" className="button" disabled={busy !== '' || selected.length === 0} onClick={() => void check()}>
              {busy === 'checking' ? 'Checking…' : `Check ${selected.length} ${selected.length === 1 ? 'page' : 'pages'} with Chronicle`}
            </button></p>
          )}

          {preview && !result && (
            <div data-testid="import-preview">
              <p>
                <strong>{preview.created.length}</strong> {preview.created.length === 1 ? 'page' : 'pages'} will be created as private drafts
                {new Set(preview.skipped).size > 0 && <>; <strong>{new Set(preview.skipped).size}</strong> already exist and will be left alone</>}.
              </p>
              {preview.conflicts.length > 0 && <p className="form-error" role="alert">Some pages changed while you were looking. Check again.</p>}
              {preview.warnings.filter((w) => w.code === 'BROKEN_LINK').length > 0 && (
                <p className="fine-print">Links to missing pages: {[...new Set(preview.warnings.filter((w) => w.code === 'BROKEN_LINK').map((w) => w.target_slug))].join(', ')}.</p>
              )}
              <p>
                <button type="button" className="button" disabled={busy !== '' || !preview.preview_id || preview.created.length === 0} onClick={() => void runImport()}>
                  {busy === 'importing' ? 'Importing…' : canRetry ? 'Retry import' : `Import ${preview.created.length} private ${preview.created.length === 1 ? 'draft' : 'drafts'}`}
                </button>{' '}
                <button type="button" className="button secondary" disabled={busy !== ''} onClick={reset}>Back</button>
              </p>
            </div>
          )}
        </section>
      )}

      {result && (
        <section className="panel" aria-live="polite">
          <h2>Import finished</h2>
          <p data-testid="import-result">{result.created.length} created · {new Set(result.skipped).size} left alone{result.replayed ? ' (this import had already been saved)' : ''}</p>
          <ul>{result.created.map((slug) => <li key={slug}><Link to={`/dm/edit/${slug}`}>{pack?.articles.find((a) => a.slug === slug)?.title ?? slug}</Link> · private draft</li>)}</ul>
        </section>
      )}

      <p className="muted">Imported pages appear in the review list on the <Link to="/dm">DM desk</Link>. Add artwork and publish each page from its editor when the story has reached the table.</p>
    </div>
  );
}
