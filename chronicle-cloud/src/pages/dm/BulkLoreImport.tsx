import { useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { listAllArticleRefs, saveArticle, type ArticleDraft } from '../../lib/api.ts';
import { useIsDm } from '../../lib/session.tsx';
import type { ArticleType } from '../../lib/types.ts';
import { useLoad } from '../../lib/useLoad.ts';

const TYPES = new Set<string>(['lore', 'character', 'location', 'faction', 'item', 'quest', 'session', 'event', 'dossier']);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ARTICLES = 200;
const MAX_FILE_BYTES = 2_000_000;

interface ImportRow {
  slug: string;
  title: string;
  type: ArticleType;
  subtitle: string;
  summary: string;
  sections: { heading: string; body: string }[];
  infobox: { label: string; value: string }[];
}

function cleanPack(data: unknown): ImportRow[] {
  if (!data || typeof data !== 'object' || !('articles' in data)) throw new Error('Expected a JSON object containing an articles array.');
  const raw = (data as { articles: unknown }).articles;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_ARTICLES) throw new Error('The package must have between 1 and 200 articles.');
  const seen = new Set<string>();
  return raw.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error('Article '+(index+1)+' is not an object.');
    const r = value as Record<string, unknown>;
    if (typeof r.slug !== 'string' || !SLUG.test(r.slug) || r.slug.length > 160) throw new Error('Invalid slug in article '+(index+1)+'.');
    if (seen.has(r.slug)) throw new Error('Duplicate slug in import: '+r.slug);
    seen.add(r.slug);
    if (typeof r.title !== 'string' || !r.title.trim() || r.title.length > 200 || !TYPES.has(String(r.type))) throw new Error('Invalid title or type for '+r.slug);
    const subtitle = typeof r.subtitle === 'string' ? r.subtitle : '';
    const summary = typeof r.summary === 'string' ? r.summary : '';
    if (subtitle.length > 200 || summary.length > 2000) throw new Error('Subtitle or summary too long: '+r.slug);
    if (!Array.isArray(r.sections) || r.sections.length > 30 || !Array.isArray(r.infobox) || r.infobox.length > 30) throw new Error('Invalid sections or infobox: '+r.slug);
    const sections = r.sections.map((v: unknown) => {
      if (!v || typeof v !== 'object') throw new Error('Invalid section in '+r.slug);
      const s = v as Record<string, unknown>;
      if (typeof s.heading !== 'string' || s.heading.length > 200 || typeof s.body !== 'string' || s.body.length > 30000) throw new Error('Invalid section content in '+r.slug);
      return { heading: s.heading, body: s.body };
    });
    const infobox = r.infobox.map((v: unknown) => {
      if (!v || typeof v !== 'object') throw new Error('Invalid infobox in '+r.slug);
      const s = v as Record<string, unknown>;
      if (typeof s.label !== 'string' || s.label.length < 1 || s.label.length > 80 || typeof s.value !== 'string' || s.value.length > 2000) throw new Error('Invalid infobox field in '+r.slug);
      return { label: s.label, value: s.value };
    });
    return { slug: r.slug, title: r.title, type: r.type as ArticleType, subtitle, summary, sections, infobox };
  });
}

/**
 * Uses the signed-in DM's own session and database RLS: no service-role key in
 * the browser. All imported content is forced to DM-only/draft, regardless of
 * any visibility or status fields contained in the uploaded JSON.
 */
export function BulkLoreImport() {
  const isDm = useIsDm();
  const articles = useLoad(listAllArticleRefs, []);
  const [pack, setPack] = useState<ImportRow[]>([]);
  const [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<string[]>([]);
  const existing = useMemo(() => new Set((articles.data ?? []).map((a) => a.slug)), [articles.data]);
  const newCount = pack.filter((p) => !existing.has(p.slug)).length;

  async function chooseFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPack([]); setReport([]); setError(''); setFilename('');
    if (!file) return;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('File is too large (2 MB maximum).');
      const result = cleanPack(JSON.parse(await file.text()) as unknown);
      setFilename(file.name); setPack(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read this package.');
    }
  }

  async function importDrafts() {
    if (!isDm || !pack.length || busy) return;
    if (!window.confirm('Import '+newCount+' new DM-only drafts? Existing slugs will be skipped. Nothing will be published.')) return;
    setBusy(true); setError(''); setReport([]);
    const results: string[] = [];
    try {
      // Refresh to prevent accidental duplicate creation after loading the preview.
      const current = new Set((await listAllArticleRefs()).map((a) => a.slug));
      for (const row of pack) {
        if (current.has(row.slug)) {
          results.push('Skipped existing: '+row.title);
          continue;
        }
        const draft: ArticleDraft = {
          article: {
            slug: row.slug, title: row.title, type: row.type, subtitle: row.subtitle,
            summary: row.summary, hero_media_id: null, visibility: 'dm',
            status: 'draft', is_featured: false, is_party_member: false,
            importance: 0, session_date: null,
          },
          sections: row.sections.map((s, i) => ({ ...s, position: i+1, visibility: 'dm', status: 'draft' })),
          infobox: row.infobox.map((s, i) => ({ ...s, position: i+1, visibility: 'dm' })),
          categoryIds: [],
        };
        try {
          await saveArticle(draft, 'Imported DM-only lore draft');
          current.add(row.slug);
          results.push('Created private draft: '+row.title);
        } catch (err) {
          results.push('ERROR importing '+row.title+': '+(err instanceof Error ? err.message : String(err)));
          // saveArticle is not transactional: stop to avoid leaving unseen partial failures.
          throw new Error('Stopped after an import error. Review affected articles before retrying.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import stopped.');
    } finally {
      setReport(results); setBusy(false); articles.reload();
    }
  }

  if (!isDm) return <p role="alert">Only the Dungeon Master may import lore.</p>;
  return (
    <div>
      <p className="muted"><Link to="/dm">DM desk</Link> › Lore import</p>
      <h1 className="page-title">Import campaign lore</h1>
      <section className="panel">
        <h2>Import JSON package</h2>
        <p>Choose a Chronicle lore package. You'll see the page titles before importing. The importer always creates <strong>DM-only unpublished drafts</strong>, never overwrites existing slugs, and never publishes to players.</p>
        <label>Package (.json)<input type="file" accept="application/json,.json" onChange={(e) => void chooseFile(e)} disabled={busy} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
      {pack.length > 0 && <section className="panel">
        <h2>Preview: {pack.length} articles</h2>
        <p className="muted">{filename} · {newCount} new · {pack.length-newCount} already present</p>
        <table className="table"><thead><tr><th>Title</th><th>Type</th><th>Action</th></tr></thead><tbody>
          {pack.map((r) => <tr key={r.slug}><td>{r.title}</td><td>{r.type}</td><td>{existing.has(r.slug) ? 'Skip existing' : 'Create DM draft'}</td></tr>)}
        </tbody></table>
        <button type="button" className="button" disabled={busy || newCount === 0 || articles.loading || Boolean(articles.error)} onClick={() => void importDrafts()}>{busy ? 'Importing…' : 'Import '+newCount+' private drafts'}</button>
      </section>}
      {report.length > 0 && <section className="panel"><h2>Import results</h2><ul>{report.map((line,i)=><li key={i}>{line}</li>)}</ul></section>}
      <p className="muted">After importing, open any article in <Link to="/dm">DM desk</Link> to add your own image. Keep the page private until the story has been revealed at the table.</p>
    </div>
  );
}
