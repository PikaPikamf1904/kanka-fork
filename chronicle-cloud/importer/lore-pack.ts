// Lore packs: hand-reviewed batches of wiki drafts kept in the repository (chronicle-cloud/lore/).
//
//   node --experimental-strip-types importer/lore-pack.ts --pack lore/dragonlance/pack.json
//       Dry run (default): validates the pack and prints a summary. Writes nothing.
//   ... --review <file.md>
//       Also writes a readable review document for the DM.
//   ... --apply --target <SUPABASE_URL>     (needs SUPABASE_URL and SUPABASE_SECRET_KEY in the env)
//       Creates the pages. Rows that already exist (same source_ref) are skipped, never overwritten.
//   ... --rollback --target <SUPABASE_URL>
//       Deletes only the rows this pack created (source_ref "lore:<pack>:...").
//
// Safety rules, enforced here and not configurable:
//   - Every article, section, infobox field and relation is created DM-only.
//   - Every article and section is created as a draft.
//   - A pack that asks for player visibility or published status anywhere is refused.
//   - Every article must say what supports it (facts with a level and a source).
import fs from 'node:fs';
import { api, checkTarget, getAll } from './kanka-import.ts';
import type { ArticleType } from './lib.ts';

export const FACT_LEVELS = ['confirmed', 'dm-reported', 'transcript-derived', 'planned', 'uncertain'] as const;
export type FactLevel = (typeof FACT_LEVELS)[number];

const ARTICLE_TYPES: ArticleType[] = ['lore', 'character', 'location', 'faction', 'item', 'quest', 'session', 'event', 'dossier'];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KIND = /^[a-z_]{2,40}$/;
const PACK_NAME = /^[a-z0-9-]{2,40}$/;

export interface PackFact { level: FactLevel; text: string; source: string }
export interface PackArticle {
  ref: string;
  slug: string;
  type: ArticleType;
  title: string;
  summary: string;
  group: string;
  facts: PackFact[];
  sections: { heading: string; body: string }[];
  infobox: { label: string; value: string }[];
  questions: string[];
}
export interface PackRelation { source: string; target: string; kind: string; label: string; level: FactLevel }
export interface LorePack {
  pack: string;
  version: number;
  title: string;
  generated_from: string;
  note?: string;
  articles: PackArticle[];
  relations: PackRelation[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Any key called visibility/status, at any depth, that is not the safe value is an error. */
function findUnsafe(value: unknown, path: string, out: string[]) {
  if (Array.isArray(value)) value.forEach((v, i) => findUnsafe(v, `${path}[${i}]`, out));
  else if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'visibility' && v !== 'dm') out.push(`${path}.visibility: packs cannot set player visibility (found ${JSON.stringify(v)})`);
      else if (k === 'status' && v !== 'draft') out.push(`${path}.status: packs cannot publish (found ${JSON.stringify(v)})`);
      else findUnsafe(v, `${path}.${k}`, out);
    }
  }
}

export function wikiLinkTargets(body: string): string[] {
  return [...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]!.trim());
}

/** Returns a list of problems; an empty list means the pack is safe to stage. */
export function validatePack(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) return ['pack: not a JSON object'];
  findUnsafe(input, 'pack', errors);
  if (!PACK_NAME.test(text(input.pack))) errors.push('pack: name must be lower-case letters, digits and hyphens');
  if (!text(input.generated_from)) errors.push('pack.generated_from: say where the content came from');
  const articles = Array.isArray(input.articles) ? input.articles : null;
  const relations = Array.isArray(input.relations) ? input.relations : null;
  if (!articles) errors.push('pack.articles: missing');
  if (!relations) errors.push('pack.relations: missing');
  if (!articles || !relations) return errors;

  const refs = new Set<string>();
  const slugs = new Set<string>();
  const titles = new Map<string, string>();
  for (const [i, raw] of articles.entries()) {
    const at = `articles[${i}]`;
    if (!isRecord(raw)) { errors.push(`${at}: not an object`); continue; }
    const ref = text(raw.ref);
    const slug = text(raw.slug);
    const title = text(raw.title);
    if (!SLUG.test(ref)) errors.push(`${at}.ref: "${ref}" is not a valid reference`);
    if (!SLUG.test(slug)) errors.push(`${at}.slug: "${slug}" is not a valid address`);
    if (refs.has(ref)) errors.push(`${at}.ref: duplicate "${ref}"`);
    if (slugs.has(slug)) errors.push(`${at}.slug: duplicate "${slug}"`);
    refs.add(ref);
    slugs.add(slug);
    if (title.length < 1 || title.length > 200) errors.push(`${at}.title: must be 1 to 200 characters`);
    const sameTitle = titles.get(title.toLowerCase());
    if (sameTitle) errors.push(`${at}.title: "${title}" duplicates the title of "${sameTitle}"`);
    titles.set(title.toLowerCase(), ref);
    if (!ARTICLE_TYPES.includes(raw.type as ArticleType)) errors.push(`${at}.type: unknown type ${JSON.stringify(raw.type)}`);
    if (!text(raw.summary)) errors.push(`${at}.summary: missing`);
    const facts = Array.isArray(raw.facts) ? raw.facts : [];
    if (facts.length === 0) errors.push(`${at}.facts: every article must say what supports it`);
    for (const [j, f] of facts.entries()) {
      if (!isRecord(f) || !FACT_LEVELS.includes(f.level as FactLevel)) errors.push(`${at}.facts[${j}].level: must be one of ${FACT_LEVELS.join(', ')}`);
      if (!isRecord(f) || !text(f.text)) errors.push(`${at}.facts[${j}].text: missing`);
      if (!isRecord(f) || !text(f.source)) errors.push(`${at}.facts[${j}].source: missing`);
    }
    const sections = Array.isArray(raw.sections) ? raw.sections : [];
    if (sections.length === 0) errors.push(`${at}.sections: at least one section is needed`);
    for (const [j, s] of sections.entries()) {
      if (!isRecord(s) || !text(s.heading) || text(s.heading).length > 200) errors.push(`${at}.sections[${j}].heading: must be 1 to 200 characters`);
      if (!isRecord(s) || !text(s.body)) errors.push(`${at}.sections[${j}].body: missing`);
    }
    for (const [j, f] of (Array.isArray(raw.infobox) ? raw.infobox : []).entries()) {
      const label = isRecord(f) ? text(f.label) : '';
      if (label.length < 1 || label.length > 80) errors.push(`${at}.infobox[${j}].label: must be 1 to 80 characters`);
    }
  }

  // Links and relations must point at pages in this pack, so nothing dangles after import.
  for (const [i, raw] of articles.entries()) {
    if (!isRecord(raw)) continue;
    const bodies = [
      ...(Array.isArray(raw.sections) ? raw.sections : []).map((s) => (isRecord(s) ? text(s.body) : '')),
      ...(Array.isArray(raw.facts) ? raw.facts : []).map((f) => (isRecord(f) ? text(f.text) : '')),
    ];
    for (const target of bodies.flatMap(wikiLinkTargets)) {
      if (!slugs.has(target)) errors.push(`articles[${i}] (${text(raw.ref)}): link to "${target}", which is not in this pack`);
    }
  }
  const seen = new Set<string>();
  for (const [i, raw] of relations.entries()) {
    const at = `relations[${i}]`;
    if (!isRecord(raw)) { errors.push(`${at}: not an object`); continue; }
    const source = text(raw.source);
    const target = text(raw.target);
    if (!refs.has(source)) errors.push(`${at}.source: "${source}" is not in this pack`);
    if (!refs.has(target)) errors.push(`${at}.target: "${target}" is not in this pack`);
    if (source === target) errors.push(`${at}: a page cannot be related to itself`);
    if (!KIND.test(text(raw.kind))) errors.push(`${at}.kind: "${text(raw.kind)}" is not a valid kind`);
    if (!FACT_LEVELS.includes(raw.level as FactLevel)) errors.push(`${at}.level: must be one of ${FACT_LEVELS.join(', ')}`);
    const key = `${source}:${text(raw.kind)}:${target}`;
    if (seen.has(key)) errors.push(`${at}: duplicate relation ${key}`);
    seen.add(key);
  }
  return errors;
}

export function readPack(file: string): LorePack {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const errors = validatePack(parsed);
  if (errors.length > 0) throw new Error(`Pack refused (${errors.length} problem${errors.length === 1 ? '' : 's'}):\n- ${errors.join('\n- ')}`);
  return parsed as LorePack;
}

export function factCounts(pack: LorePack): Record<FactLevel, number> {
  const counts = Object.fromEntries(FACT_LEVELS.map((l) => [l, 0])) as Record<FactLevel, number>;
  for (const a of pack.articles) for (const f of a.facts) counts[f.level]++;
  return counts;
}

const sourceRef = (pack: LorePack, ref: string) => `lore:${pack.pack}:${ref}`;

function provenanceNote(a: PackArticle): string {
  return a.facts.map((f) => `- **${f.level}**: ${f.text} _(${f.source})_`).join('\n');
}

export function reviewMarkdown(pack: LorePack): string {
  const counts = factCounts(pack);
  const lines = [
    `# Lore review: ${pack.title}`,
    '',
    `Pack \`${pack.pack}\` version ${pack.version}. Source: ${pack.generated_from}.`,
    '',
    'Every page below is staged **DM-only** and as a **draft**. Nothing here is in the live wiki until the DM runs the import, and nothing is visible to players until the DM publishes it page by page.',
    '',
    '## How sure are we',
    '',
    '| Level | Facts | Meaning |',
    '|---|---|---|',
    `| confirmed | ${counts.confirmed} | Checked against a recording, notes or the DM's explicit confirmation |`,
    `| dm-reported | ${counts['dm-reported']} | Stated by the DM in the brief; not checked against source files |`,
    `| transcript-derived | ${counts['transcript-derived']} | Reported outcome that still needs the DM's check |`,
    `| planned | ${counts.planned} | Preparation for a future session; has not happened |`,
    `| uncertain | ${counts.uncertain} | Unknown, assumed or conflicting |`,
    '',
    `## Pages (${pack.articles.length})`,
    '',
  ];
  const groups = [...new Set(pack.articles.map((a) => a.group))];
  for (const group of groups) {
    lines.push(`### ${group}`, '');
    for (const a of pack.articles.filter((x) => x.group === group)) {
      lines.push(
        `#### ${a.title}`,
        '',
        `- Address: \`${a.slug}\` · Type: ${a.type} · Visibility: DM only · Status: draft · Reference: \`${sourceRef(pack, a.ref)}\``,
        `- Summary: ${a.summary}`,
        `- Sections: ${a.sections.map((s) => s.heading).join('; ')}`,
        '- Supported by:',
        ...a.facts.map((f) => `  - ${f.level}: ${f.text}`),
        ...(a.questions.length ? ['- Questions for the DM:', ...a.questions.map((q) => `  - ${q}`)] : []),
        '',
      );
    }
  }
  lines.push(`## Connections (${pack.relations.length})`, '', '| From | Kind | To | Note | Level |', '|---|---|---|---|---|');
  for (const r of pack.relations) lines.push(`| ${r.source} | ${r.kind} | ${r.target} | ${r.label} | ${r.level} |`);
  lines.push('');
  return lines.join('\n');
}

export async function applyPack(pack: LorePack, base: string, key: string) {
  const call = api(base, key);
  const summary = { articlesCreated: 0, articlesSkipped: 0, slugConflicts: [] as string[], relationsCreated: 0, relationsSkipped: 0 };
  const existing = await getAll<{ id: string; slug: string; source_ref: string | null }>(call, 'articles?select=id,slug,source_ref&order=id');
  const bySource = new Map(existing.filter((a) => a.source_ref).map((a) => [a.source_ref!, a.id]));
  const slugOwner = new Map(existing.map((a) => [a.slug, a.source_ref]));
  const idByRef = new Map<string, string>();

  for (const a of pack.articles) {
    const ref = sourceRef(pack, a.ref);
    const have = bySource.get(ref);
    if (have) {
      idByRef.set(a.ref, have);
      summary.articlesSkipped++;
      continue;
    }
    // A page with this address that did not come from this pack is someone's work: never
    // overwrite it and never create a second page for the same subject.
    if (slugOwner.has(a.slug)) {
      summary.slugConflicts.push(a.slug);
      continue;
    }
    const [row] = await call<{ id: string }[]>('POST', 'articles', {
      slug: a.slug, type: a.type, title: a.title, summary: a.summary, visibility: 'dm', status: 'draft', source_ref: ref,
    }, 'return=representation');
    const id = row!.id;
    idByRef.set(a.ref, id);
    await call('POST', 'article_sections', a.sections.map((s, i) => ({
      article_id: id, position: i + 1, heading: s.heading, body: s.body, visibility: 'dm', status: 'draft',
    })));
    if (a.infobox.length) {
      await call('POST', 'infobox_fields', a.infobox.map((f, i) => ({ article_id: id, position: i + 1, label: f.label, value: f.value, visibility: 'dm' })));
    }
    const notes = [{ article_id: id, title: 'Provenance', body: provenanceNote(a) }];
    if (a.questions.length) notes.push({ article_id: id, title: 'Questions for the DM', body: a.questions.map((q) => `- ${q}`).join('\n') });
    await call('POST', 'dm_notes', notes);
    summary.articlesCreated++;
  }

  const existingRels = await getAll<{ source_ref: string | null }>(call, 'relations?select=source_ref&source_ref=not.is.null&order=id');
  const relRefs = new Set(existingRels.map((r) => r.source_ref));
  for (const r of pack.relations) {
    const ref = `lore:${pack.pack}:rel:${r.source}:${r.kind}:${r.target}`;
    const source = idByRef.get(r.source);
    const target = idByRef.get(r.target);
    if (relRefs.has(ref) || !source || !target) {
      summary.relationsSkipped++;
      continue;
    }
    await call('POST', 'relations', { source_article_id: source, target_article_id: target, kind: r.kind, label: r.label, visibility: 'dm', source_ref: ref });
    summary.relationsCreated++;
  }
  return summary;
}

export async function rollbackPack(packName: string, base: string, key: string) {
  if (!PACK_NAME.test(packName)) throw new Error('Bad pack name.');
  const call = api(base, key);
  return {
    relations: (await call<unknown[]>('DELETE', `relations?source_ref=like.lore:${packName}:*`, undefined, 'return=representation')).length,
    articles: (await call<unknown[]>('DELETE', `articles?source_ref=like.lore:${packName}:*`, undefined, 'return=representation')).length,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.includes(name);
  const value = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const file = value('--pack');
  if (!file) throw new Error('Usage: lore-pack.ts --pack <pack.json> [--review <file.md>] [--apply|--rollback --target <SUPABASE_URL>]');
  const pack = readPack(file);
  const counts = factCounts(pack);
  console.log(`Pack "${pack.pack}" v${pack.version}: ${pack.articles.length} pages, ${pack.relations.length} connections. All DM-only drafts.`);
  console.log(`Facts: ${FACT_LEVELS.map((l) => `${l} ${counts[l]}`).join(', ')}`);
  const review = value('--review');
  if (review) {
    fs.writeFileSync(review, reviewMarkdown(pack));
    console.log(`Review written to ${review}`);
  }
  if (flag('--apply') || flag('--rollback')) {
    const { base, key } = checkTarget({ target: value('--target') });
    console.log(flag('--apply') ? await applyPack(pack, base, key) : await rollbackPack(pack.pack, base, key));
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
