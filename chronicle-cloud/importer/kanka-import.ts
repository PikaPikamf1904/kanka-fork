// Kanka -> Chronicle importer.
//
//   node --experimental-strip-types importer/kanka-import.ts --source <unzipped export dir> [--trust-public-entities]
//       Dry run (default): reads the export, writes importer/out/report.{md,json}. Writes nothing else.
//
//   ... --apply --target <SUPABASE_URL>      (needs SUPABASE_URL and SUPABASE_SECRET_KEY in the env)
//       Creates articles, sections, infobox fields, categories and relations. Existing rows
//       (same source_ref) are skipped, never overwritten. The target must be given twice
//       (flag and env) so a run cannot hit the wrong project by accident.
//
//   ... --rollback --target <SUPABASE_URL>
//       Deletes every row whose source_ref starts with "kanka:" (and, by cascade, their sections,
//       fields, links and category links). Content created in Chronicle is untouched.
//
// The importer never connects to Kanka's database; it only reads an export you downloaded.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildPlan, type KankaRecord, type Plan } from './lib.ts';

interface Args {
  source?: string;
  out: string;
  apply: boolean;
  rollback: boolean;
  target?: string;
  trustPublicEntities: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { out: 'importer/out', apply: false, rollback: false, trustPublicEntities: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') args.source = argv[++i];
    else if (a === '--out') args.out = argv[++i] ?? args.out;
    else if (a === '--apply') args.apply = true;
    else if (a === '--rollback') args.rollback = true;
    else if (a === '--target') args.target = argv[++i];
    else if (a === '--trust-public-entities') args.trustPublicEntities = true;
    else if (a === '--dry-run') { /* default */ }
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

/** Read every <module>/<name>_<id>.json file in an unzipped Kanka export. */
export function readExport(dir: string): { records: KankaRecord[]; checksum: string; files: number; unreadable: string[] } {
  const records: KankaRecord[] = [];
  const unreadable: string[] = [];
  const hash = crypto.createHash('sha256');
  let files = 0;
  for (const module of fs.readdirSync(dir).sort()) {
    const moduleDir = path.join(dir, module);
    if (!fs.statSync(moduleDir).isDirectory() || module === 'gallery' || module === 'settings') continue;
    for (const file of fs.readdirSync(moduleDir).sort()) {
      if (!file.endsWith('.json')) continue;
      const raw = fs.readFileSync(path.join(moduleDir, file));
      hash.update(`${module}/${file}\0`).update(raw);
      files++;
      try {
        const parsed = JSON.parse(raw.toString('utf8')) as KankaRecord['model'];
        // Entity-only exports wrap the data as { entity: {...} }.
        records.push({ module, file, model: parsed });
      } catch {
        unreadable.push(`${module}/${file}`);
      }
    }
  }
  return { records, checksum: hash.digest('hex'), files, unreadable };
}

export function reportMarkdown(plan: Plan, meta: { source: string; checksum: string; files: number; unreadable: string[]; trust: boolean }): string {
  const r = plan.report;
  const lines = [
    '# Kanka import report (dry run)',
    '',
    `- Source: \`${meta.source}\` (${meta.files} JSON files, sha256 \`${meta.checksum}\`)`,
    `- Generated: ${new Date().toISOString()}`,
    `- Player visibility of non-private entries: ${meta.trust ? '**trusted** (--trust-public-entities)' : '**not trusted**: everything is DM-only until you review it'}`,
    '',
    '## What would be created',
    '',
    `| Kind | Count |`,
    `|---|---|`,
    ...Object.entries(r.byType).sort().map(([t, n]) => `| ${t} | ${n} |`),
    `| categories/tags | ${plan.categories.length} |`,
    `| relations | ${plan.relations.length} |`,
    '',
    '## Visibility',
    '',
    `- Articles visible to players: ${r.byVisibility.players}`,
    `- Articles DM-only: ${r.byVisibility.dm}`,
    `- Non-private entries that \`--trust-public-entities\` would show to players: ${r.wouldBePlayersWithTrust}`,
    `- DM-only sections (posts): ${r.sectionsDmOnly}; DM-only infobox fields (attributes): ${r.infoboxDmOnly}; DM-only relations: ${r.relationsDmOnly}`,
    '',
    '| Reason | Articles |',
    '|---|---|',
    ...Object.entries(r.reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k} | ${n} |`),
    '',
    '## Needs attention',
    '',
    `- Unreadable files: ${meta.unreadable.length ? meta.unreadable.join(', ') : 'none'}`,
    `- Modules not imported: ${Object.keys(r.skippedModules).length ? Object.entries(r.skippedModules).map(([m, n]) => `${m} (${n})`).join(', ') : 'none'}`,
    `- Same name, same type (possible duplicates): ${r.duplicateNames.length ? r.duplicateNames.map((d) => `${d.name} [${d.ids.join(', ')}]`).join('; ') : 'none'}`,
    `- Mentions of entities not in the export: ${r.unknownMentions.length ? r.unknownMentions.join(', ') : 'none'}`,
    `- Relations with an end not in the export: ${r.relationsMissingEnd}`,
    `- Inline images removed from text: ${r.droppedInlineImages}`,
    `- Mentions of DM-only pages removed from player-visible text: ${r.mentionsRedacted}`,
    `- Entity images referenced (not imported yet: upload them in the editor): ${r.imagesReferenced}`,
    '',
    '## Articles',
    '',
    '| Kanka id | Type | Title | Slug | Visibility | Why |',
    '|---|---|---|---|---|---|',
    ...plan.articles.map((a) => `| ${a.kankaEntityId} | ${a.type} | ${a.title.replace(/\|/g, '\\|')} | ${a.slug} | ${a.visibility} | ${a.reason} |`),
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Apply / rollback through the Supabase Data API with the secret key (server-side only).
// ---------------------------------------------------------------------------------------------
function api(base: string, key: string) {
  const headers = { apikey: key, 'content-type': 'application/json' };
  return async function call<T>(method: string, pathAndQuery: string, body?: unknown, prefer?: string): Promise<T> {
    const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
      method,
      headers: prefer ? { ...headers, prefer } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${pathAndQuery}: ${res.status} ${await res.text()}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  };
}

function checkTarget(args: Args): { base: string; key: string } {
  const base = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SECRET_KEY ?? '';
  if (!args.target || !base || args.target.replace(/\/+$/, '') !== base) {
    throw new Error('--target must match SUPABASE_URL exactly.');
  }
  if (!key) throw new Error('SUPABASE_SECRET_KEY is not set.');
  return { base, key };
}

export async function applyPlan(plan: Plan, base: string, key: string) {
  const call = api(base, key);
  const summary = { articlesCreated: 0, articlesSkipped: 0, categories: 0, relations: 0 };

  // Categories (skip existing by source_ref or slug).
  const existingCats = await call<{ id: string; slug: string; source_ref: string | null }[]>('GET', 'categories?select=id,slug,source_ref');
  const catBySource = new Map(existingCats.filter((c) => c.source_ref).map((c) => [c.source_ref!, c.id]));
  const catSlugs = new Set(existingCats.map((c) => c.slug));
  for (const c of plan.categories) {
    if (catBySource.has(c.sourceRef)) continue;
    const slug = catSlugs.has(c.slug) ? `${c.slug}-kanka` : c.slug;
    const [row] = await call<{ id: string }[]>('POST', 'categories', { slug, name: c.name, kind: 'tag', visibility: c.visibility, source_ref: c.sourceRef }, 'return=representation');
    catBySource.set(c.sourceRef, row!.id);
    catSlugs.add(slug);
    summary.categories++;
  }

  const existing = await call<{ id: string; slug: string; source_ref: string | null }[]>('GET', 'articles?select=id,slug,source_ref');
  const bySource = new Map(existing.filter((a) => a.source_ref).map((a) => [a.source_ref!, a.id]));
  const slugs = new Set(existing.map((a) => a.slug));
  const slugToId = new Map(existing.map((a) => [a.slug, a.id]));

  for (const a of plan.articles) {
    if (bySource.has(a.sourceRef)) {
      summary.articlesSkipped++;
      continue;
    }
    const slug = slugs.has(a.slug) ? `${a.slug}-kanka-${a.kankaEntityId}` : a.slug;
    const [row] = await call<{ id: string }[]>('POST', 'articles', {
      slug, type: a.type, title: a.title.slice(0, 200), summary: a.summary, visibility: a.visibility,
      status: 'published', source_ref: a.sourceRef,
    }, 'return=representation');
    const id = row!.id;
    slugs.add(slug);
    slugToId.set(a.slug, id);
    bySource.set(a.sourceRef, id);
    if (a.sections.length) {
      await call('POST', 'article_sections', a.sections.map((s, i) => ({
        article_id: id, position: i + 1, heading: s.heading.slice(0, 200), body: s.body, visibility: s.visibility, status: 'published',
      })));
    }
    if (a.infobox.length) {
      await call('POST', 'infobox_fields', a.infobox.map((f, i) => ({ article_id: id, position: i + 1, label: f.label, value: f.value, visibility: f.visibility })));
    }
    const catIds = a.tagIds.map((t) => catBySource.get(`kanka:tag:${t}`)).filter(Boolean);
    if (catIds.length) await call('POST', 'article_categories', catIds.map((category_id) => ({ article_id: id, category_id })));
    summary.articlesCreated++;
  }

  const existingRels = await call<{ source_ref: string | null }[]>('GET', 'relations?select=source_ref&source_ref=not.is.null');
  const relRefs = new Set(existingRels.map((r) => r.source_ref));
  for (const r of plan.relations) {
    if (relRefs.has(r.sourceRef)) continue;
    const source = slugToId.get(r.source);
    const target = slugToId.get(r.target);
    if (!source || !target || source === target) continue;
    await call('POST', 'relations', { source_article_id: source, target_article_id: target, kind: 'related_to', label: r.label, visibility: r.visibility, source_ref: r.sourceRef });
    summary.relations++;
  }
  return summary;
}

export async function rollback(base: string, key: string) {
  const call = api(base, key);
  const deleted = {
    relations: (await call<unknown[]>('DELETE', 'relations?source_ref=like.kanka:*', undefined, 'return=representation')).length,
    articles: (await call<unknown[]>('DELETE', 'articles?source_ref=like.kanka:*', undefined, 'return=representation')).length,
    categories: (await call<unknown[]>('DELETE', 'categories?source_ref=like.kanka:*', undefined, 'return=representation')).length,
  };
  return deleted;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.rollback) {
    const { base, key } = checkTarget(args);
    console.log(JSON.stringify(await rollback(base, key)));
    return;
  }
  if (!args.source) throw new Error('--source <unzipped Kanka export directory> is required');
  const read = readExport(args.source);
  const plan = buildPlan(read.records, { trustPublicEntities: args.trustPublicEntities });
  fs.mkdirSync(args.out, { recursive: true });
  const meta = { source: args.source, checksum: read.checksum, files: read.files, unreadable: read.unreadable, trust: args.trustPublicEntities };
  fs.writeFileSync(path.join(args.out, 'report.md'), reportMarkdown(plan, meta));
  fs.writeFileSync(path.join(args.out, 'report.json'), JSON.stringify({ meta, report: plan.report, articles: plan.articles.map(({ sections, infobox, ...a }) => ({ ...a, sections: sections.length, infobox: infobox.length })) }, null, 2));
  console.log(`Planned ${plan.articles.length} articles (${plan.report.byVisibility.players} for players, ${plan.report.byVisibility.dm} DM-only), ${plan.categories.length} tags, ${plan.relations.length} relations.`);
  console.log(`Report: ${path.join(args.out, 'report.md')}`);
  if (args.apply) {
    const { base, key } = checkTarget(args);
    console.log(JSON.stringify(await applyPlan(plan, base, key)));
  } else {
    console.log('Dry run: nothing was written to any database.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
