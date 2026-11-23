// Lore import: read many files of campaign notes, organise them into proposed wiki pages, compare
// them with the wiki as it is now, and turn the DM's approved choices into bounded change sets.
//
// Shared by the website (/dm/import) and the MCP Worker. It never talks to the database itself:
// callers pass in an index of the wiki and send the resulting change sets to the editing engine,
// which saves everything as DM-only drafts.
//
// Rules this module keeps, whatever a file says:
//   - Nothing is published and nothing is made visible to players.
//   - An existing page is never overwritten: matches only ever gain new DM-only sections, new
//     fields whose label the page does not have yet, and private notes; and only if the DM approves
//     that page explicitly. A field whose label exists with a different value is a conflict to
//     report, never a change.
//   - Nothing is invented: a type, a link or a connection that is a guess is labelled as a guess.
//   - Rumours and uncertain material stay marked as such (provenance and section headings).
import type { ChangeOp, ChangeSet, ProvenanceKind } from './changeSetTypes.ts';
import { PACKAGE_LIMITS, parsePackage, wikiLinkTargets, type PackageArticle, type PackageProblem, type PackageRelation } from './lorePackage.ts';
import type { ArticleType } from './types.ts';
import { slugify as slugAddress } from './slug.ts';

export const IMPORT_LIMITS = {
  files: 200,
  fileBytes: PACKAGE_LIMITS.fileBytes,
  totalBytes: 5_000_000,
  items: 1000,
  /** Pages per change set: small enough that one failure costs little and the engine stays fast. */
  chunkPages: 20,
} as const;

export type CanonLevel = 'confirmed' | 'uncertain' | 'rumor' | 'planned';
export type Confidence = 'high' | 'medium' | 'low';

export interface ImportItem extends PackageArticle {
  /** Where the entry came from: file name and position. */
  source: string;
  /** How the type was decided. */
  typeConfidence: Confidence;
  typeReason: string;
  canon: CanonLevel;
  aliases: string[];
  tags: string[];
}

export interface StagedImport {
  items: ImportItem[];
  relations: PackageRelation[];
  errors: PackageProblem[];
  warnings: PackageProblem[];
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The site's address rule (slug.ts), cut to 160 characters for imported titles. */
export const slugify = (s: string) => slugAddress(s).slice(0, 160).replace(/-+$/, '');
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 20);

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------
const TYPE_WORDS: Record<string, ArticleType> = {
  character: 'character', npc: 'character', pc: 'character', person: 'character', people: 'character', characters: 'character', npcs: 'character',
  location: 'location', place: 'location', city: 'location', town: 'location', region: 'location', locations: 'location', places: 'location',
  faction: 'faction', organisation: 'faction', organization: 'faction', guild: 'faction', factions: 'faction', organizations: 'faction',
  item: 'item', artifact: 'item', artefact: 'item', object: 'item', weapon: 'item', items: 'item',
  quest: 'quest', mission: 'quest', quests: 'quest', missions: 'quest',
  session: 'session', recap: 'session', journal: 'session', sessions: 'session',
  event: 'event', battle: 'event', events: 'event',
  lore: 'lore', history: 'lore', background: 'lore',
  dossier: 'dossier',
};
const TITLE_HINTS: [RegExp, ArticleType, string][] = [
  [/^session\s*\d+|\bsession\s+\d+\b|^recap\b/i, 'session', 'The title names a session.'],
  [/\b(battle|siege|fall|sack|war|massacre|coronation|festival)\s+of\b/i, 'event', 'The title names an event ("Battle of …").'],
  [/^(quest|mission|task|job)\b|:\s*(quest|mission)\b/i, 'quest', 'The title names a quest.'],
  [/\b(order|guild|knights|brotherhood|sisterhood|cult|clan|council|circle|society|company|army|legion|syndicate|church|cabal)\b/i, 'faction', 'The title has a word used for groups.'],
  [/\b(city|town|village|keep|fortress|castle|port|harbou?r|forest|woods?|mountains?|river|lake|tower|temple|inn|tavern|isle|island|kingdom|realm|valley|road|bridge|ruins|caverns?|caves?|district|market|lighthouse|docks?|shrine|hall|manor|estate|camp|mine|pass|sea|bay|coast|desert|swamp|marsh|citadel|outpost|fort|plains?|hills?|cove|grove|quarter)\b/i, 'location', 'The title has a word used for places.'],
  [/\b(sword|blade|staff|ring|amulet|orb|lance|shield|tome|book|crown|dagger|axe|bow|cloak|helm|gem|key|map of)\b/i, 'item', 'The title has a word used for objects.'],
];
const PERSON_FIELDS = /^(race|species|class|level|pronouns|occupation|alignment)$/i;

function classify(title: string, declared: string | null, folder: string | null, labels: string[]): { type: ArticleType; confidence: Confidence; reason: string } {
  const d = declared?.trim().toLowerCase() ?? '';
  if (d && TYPE_WORDS[d]) return { type: TYPE_WORDS[d]!, confidence: 'high', reason: `The file says it is a ${d}.` };
  const f = folder?.trim().toLowerCase() ?? '';
  if (f && TYPE_WORDS[f]) return { type: TYPE_WORDS[f]!, confidence: 'medium', reason: `It is in the "${folder}" folder.` };
  if (labels.some((l) => PERSON_FIELDS.test(l))) return { type: 'character', confidence: 'medium', reason: 'Its facts describe a person (race, class, level…).' };
  for (const [re, type, reason] of TITLE_HINTS) if (re.test(title)) return { type, confidence: 'medium', reason };
  return { type: 'lore', confidence: 'low', reason: 'Nothing says what kind of page this is; filed as lore. Check it.' };
}

function canonOf(v: unknown): CanonLevel | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (['confirmed', 'canon', 'table', 'table_confirmed', 'dm_confirmed', 'fact'].includes(s)) return 'confirmed';
  if (['rumor', 'rumour', 'gossip', 'hearsay', 'in-world', 'newspaper', 'gazette'].includes(s)) return 'rumor';
  if (['planned', 'plan', 'future', 'unplayed', 'planned_unplayed'].includes(s)) return 'planned';
  if (['uncertain', 'unconfirmed', 'maybe', 'transcript', 'transcript-derived', 'draft', 'ai'].includes(s)) return 'uncertain';
  return null;
}

export const PROVENANCE_FOR: Record<CanonLevel, ProvenanceKind> = {
  confirmed: 'dm_confirmed', uncertain: 'transcript_uncertain', rumor: 'transcript_uncertain', planned: 'planned_unplayed',
};
export const CANON_LABEL: Record<CanonLevel, string> = {
  confirmed: 'Confirmed by the DM', uncertain: 'Unconfirmed', rumor: 'Rumour (in-world, not canon)', planned: 'Planned, not yet played',
};

// ---------------------------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------------------------
/** A small YAML subset for front matter: `key: value`, `key: [a, b]` and `- item` lists. */
function frontMatter(lines: string[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of lines) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const prev = out[listKey];
      out[listKey] = [...(Array.isArray(prev) ? prev : []), item[1]!.trim().replace(/^["']|["']$/g, '')];
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const value = kv[2]!.trim();
    if (value === '') { listKey = key; out[key] = []; continue; }
    listKey = null;
    const inline = /^\[(.*)\]$/.exec(value);
    out[key] = inline ? inline[1]!.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : value.replace(/^["']|["']$/g, '');
  }
  return out;
}

const FACT_HEADINGS = /^(facts|infobox|details|at a glance|quick facts|stats)$/i;
const NOTE_HEADINGS = /^(dm notes?|gm notes?|secrets?|private notes?|behind the screen)$/i;
const FACT_LINE = /^\s*[-*]\s*(?:\*\*)?([^:*]{1,80}?)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.+?)\s*$/;

interface RawEntry { raw: Record<string, unknown>; source: string; folder: string | null; meta: Record<string, string | string[]> }

/** One Markdown file: a file with front matter is one entry; otherwise every top-level heading is. */
export function markdownEntries(name: string, text: string): { entries: RawEntry[]; problems: PackageProblem[] } {
  const problems: PackageProblem[] = [];
  const folder = name.includes('/') ? name.split('/').slice(-2, -1)[0] ?? null : null;
  const base = name.split('/').pop()!.replace(/\.(md|markdown|txt)$/i, '');
  let lines = text.replace(/\r\n?/g, '\n').split('\n');
  let meta: Record<string, string | string[]> = {};
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end > 0) {
      meta = frontMatter(lines.slice(1, end));
      lines = lines.slice(end + 1);
    }
  }
  // Split into entries at "# " headings unless front matter makes the whole file one entry.
  const blocks: { title: string; lines: string[] }[] = [];
  const oneEntry = Object.keys(meta).length > 0;
  for (const line of lines) {
    const h1 = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (h1 && (!oneEntry || blocks.length === 0)) {
      blocks.push({ title: h1[1]!.trim(), lines: [] });
      continue;
    }
    if (blocks.length === 0) blocks.push({ title: '', lines: [] });
    blocks[blocks.length - 1]!.lines.push(line);
  }
  const entries: RawEntry[] = [];
  for (const [i, b] of blocks.entries()) {
    const title = (oneEntry && typeof meta.title === 'string' ? meta.title : b.title || (blocks.length === 1 ? base.replace(/[-_]+/g, ' ') : '')).trim();
    if (!title && !b.lines.some((l) => l.trim())) continue;
    if (!title) {
      problems.push({ index: i + 1, name: `${name} part ${i + 1}`, message: 'Text before the first heading has no title; it was not imported.' });
      continue;
    }
    // Summary: the text before the first "## " heading. Sections: one per "## " heading.
    const sections: { heading: string; body: string }[] = [];
    const infobox: { label: string; value: string }[] = [];
    const notes: { title: string; body: string }[] = [];
    let intro: string[] = [];
    let current: { heading: string; lines: string[] } | null = null;
    const flush = () => {
      if (!current) return;
      const body = current.lines.join('\n').trim();
      if (FACT_HEADINGS.test(current.heading)) {
        for (const l of current.lines) {
          const m = FACT_LINE.exec(l);
          if (m) infobox.push({ label: m[1]!.trim(), value: m[2]!.trim() });
        }
      } else if (NOTE_HEADINGS.test(current.heading)) {
        if (body) notes.push({ title: current.heading, body });
      } else if (body) {
        sections.push({ heading: current.heading, body });
      }
      current = null;
    };
    for (const l of b.lines) {
      const h2 = /^##\s+(.+?)\s*#*\s*$/.exec(l);
      if (h2) {
        flush();
        current = { heading: h2[1]!.trim(), lines: [] };
      } else if (current) {
        current.lines.push(l);
      } else {
        intro.push(l);
      }
    }
    flush();
    intro = intro.join('\n').trim().split(/\n{2,}/);
    const first = (intro[0] ?? '').replace(/\s+/g, ' ').trim();
    const summaryFits = first.length > 0 && first.length <= PACKAGE_LIMITS.summary;
    const rest = (summaryFits ? intro.slice(1) : intro).join('\n\n').trim();
    if (rest) sections.unshift({ heading: 'Overview', body: rest });
    if (sections.length === 0 && summaryFits) sections.push({ heading: 'Overview', body: first });
    const m = oneEntry ? meta : {};
    entries.push({
      source: blocks.length > 1 ? `${name} (part ${i + 1})` : name,
      folder,
      meta: m,
      raw: {
        slug: typeof m.slug === 'string' ? m.slug : slugify(title), title,
        type: typeof m.type === 'string' ? m.type : null,
        subtitle: typeof m.subtitle === 'string' ? m.subtitle : '',
        summary: summaryFits ? first : '',
        sections, infobox, notes,
      },
    });
  }
  return { entries, problems };
}

// ---------------------------------------------------------------------------------------------
// Files -> staged import
// ---------------------------------------------------------------------------------------------
export function parseImportFiles(files: { name: string; text: string }[]): StagedImport {
  const out: StagedImport = { items: [], relations: [], errors: [], warnings: [] };
  if (files.length > IMPORT_LIMITS.files) {
    out.errors.push({ index: 0, name: 'Files', message: `${files.length} files were chosen; the limit is ${IMPORT_LIMITS.files} at a time.` });
    return out;
  }
  const total = files.reduce((n, f) => n + new TextEncoder().encode(f.text).length, 0);
  if (total > IMPORT_LIMITS.totalBytes) {
    out.errors.push({ index: 0, name: 'Files', message: `The files hold ${Math.round(total / 1000)} kB; the limit for one import is ${IMPORT_LIMITS.totalBytes / 1_000_000} MB. Import them in several batches.` });
    return out;
  }
  const raws: RawEntry[] = [];
  for (const f of files) {
    if (new TextEncoder().encode(f.text).length > IMPORT_LIMITS.fileBytes) {
      out.errors.push({ index: 0, name: f.name, message: 'This file is larger than 1 MB; split it.' });
      continue;
    }
    if (/\.json$/i.test(f.name)) {
      let data: unknown;
      try {
        data = JSON.parse(f.text);
      } catch {
        out.errors.push({ index: 0, name: f.name, message: 'This file is not valid JSON.' });
        continue;
      }
      const articles = isRecord(data) && Array.isArray(data.articles) ? data.articles : null;
      if (!articles) {
        out.errors.push({ index: 0, name: f.name, message: 'Not a lore package: the "articles" list is missing.' });
        continue;
      }
      const relRefs = isRecord(data) && Array.isArray(data.relations) ? data.relations : [];
      // Relations refer to entries by ref or slug; keep them for after every file is read.
      const byRef = new Map<string, string>();
      for (const [i, a] of articles.entries()) {
        if (!isRecord(a)) continue;
        const slug = typeof a.slug === 'string' ? a.slug : typeof a.title === 'string' ? slugify(a.title) : '';
        if (typeof a.ref === 'string') byRef.set(a.ref, slug);
        if (slug) byRef.set(slug, slug);
        raws.push({ raw: { ...a, slug, type: a.type ?? null }, source: `${f.name} #${i + 1}`, folder: null, meta: {} });
      }
      for (const r of relRefs) {
        if (!isRecord(r)) continue;
        const source = byRef.get(String(r.source ?? ''));
        const target = byRef.get(String(r.target ?? ''));
        const kind = typeof r.kind === 'string' && /^[a-z_]{2,40}$/.test(r.kind) ? r.kind : '';
        if (source && target && kind && source !== target) out.relations.push({ source, target, kind, label: String(r.label ?? '').slice(0, 120) });
        else out.warnings.push({ index: 0, name: f.name, message: 'A connection was skipped: it does not join two pages of the file.' });
      }
    } else if (/\.(md|markdown|txt)$/i.test(f.name)) {
      const { entries, problems } = markdownEntries(f.name, f.text);
      raws.push(...entries);
      for (const p of problems) out.warnings.push(p);
    } else {
      out.errors.push({ index: 0, name: f.name, message: 'Only .json, .md, .markdown and .txt files can be imported.' });
    }
  }
  if (raws.length > IMPORT_LIMITS.items) {
    out.errors.push({ index: 0, name: 'Files', message: `The files hold ${raws.length} entries; the limit for one import is ${IMPORT_LIMITS.items}.` });
    return out;
  }

  const seen = new Map<string, string>();
  for (const [i, r] of raws.entries()) {
    const labels = Array.isArray(r.raw.infobox) ? r.raw.infobox.filter(isRecord).map((f) => String(f.label ?? '')) : [];
    const title = typeof r.raw.title === 'string' ? r.raw.title.trim() : '';
    const declared = typeof r.raw.type === 'string' ? r.raw.type : null;
    const c = classify(title, declared, r.folder, labels);
    if (declared && !TYPE_WORDS[declared.trim().toLowerCase()]) {
      out.warnings.push({ index: i + 1, name: title || r.source, message: `Unknown type "${declared}"; ${c.reason.toLowerCase()}` });
    }
    // Reuse the package checks (lengths, control characters, at least one section…).
    const checked = parsePackage({ articles: [{ ...r.raw, type: c.type }] });
    if (checked.articles.length === 0) {
      out.errors.push({ index: i + 1, name: (title || r.source).slice(0, 80), message: `${r.source}: ${checked.errors[0]?.message ?? 'could not be read'}` });
      continue;
    }
    const article = checked.articles[0]!;
    if (!SLUG.test(article.slug)) {
      out.errors.push({ index: i + 1, name: title.slice(0, 80), message: `${r.source}: no usable page address.` });
      continue;
    }
    const earlier = seen.get(article.slug);
    if (earlier) {
      out.errors.push({ index: i + 1, name: title.slice(0, 80), message: `${r.source}: same page address as ${earlier}; merge the two entries first.` });
      continue;
    }
    seen.set(article.slug, r.source);
    const canon = canonOf(r.meta.canon ?? r.raw.canon ?? r.raw.certainty) ?? 'uncertain';
    out.items.push({
      ...article, source: r.source, typeConfidence: c.confidence, typeReason: c.reason, canon,
      aliases: strList(r.meta.aliases ?? r.raw.aliases), tags: strList(r.meta.tags ?? r.meta.categories ?? r.raw.tags ?? r.raw.group),
    });
  }
  const ok = new Set(out.items.map((x) => x.slug));
  out.relations = out.relations.filter((r) => ok.has(r.source) && ok.has(r.target));
  if (out.items.length === 0 && out.errors.length === 0) out.errors.push({ index: 0, name: 'Files', message: 'No entries were found in these files.' });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Comparison with the wiki
// ---------------------------------------------------------------------------------------------
export interface WikiIndex {
  articles: { id: string; slug: string; title: string; type: string; version: number; visibility: string; status: string }[];
  fields: { article_id: string; label: string; value: string }[];
  redirects: { from_slug: string; article_id: string }[];
  categories: { id: string; slug: string; name: string }[];
}

export type ItemAction = 'create' | 'add_to_existing' | 'imported';
export interface ItemAnalysis {
  slug: string;
  action: ItemAction;
  /** Existing pages whose name is close but not the same (a typo, "The", punctuation): check before creating. */
  similar_in_wiki: { slug: string; title: string }[];
  match: null | { id: string; slug: string; title: string; type: string; version: number; why: string; player_visible: boolean };
  /** Other entries of this import that look like the same subject. */
  similar_in_import: string[];
  new_fields: { label: string; value: string }[];
  same_fields: string[];
  conflicts: { label: string; existing: string; imported: string }[];
  links: { to_import: string[]; to_wiki: string[]; missing: string[] };
  categories: { existing: string[]; missing: string[] };
  provenance: { kind: ProvenanceKind; reference: string };
  default_decision: 'approve' | 'review';
}

export interface RelationProposal {
  key: string;
  source: string;
  target: string;
  kind: string;
  label: string;
  basis: 'stated' | 'link';
  default_decision: 'approve' | 'review';
}

export interface ImportAnalysis {
  items: ItemAnalysis[];
  relations: RelationProposal[];
  totals: { entries: number; create: number; add_to_existing: number; imported: number; duplicates: number; conflicts: number; relations: number; suggested_relations: number; dm_only: number; needs_approval: number };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
/** A name reduced to letters and digits, without a leading "the" or accents. */
export const nameKey = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/^\s*the\s+/, '').replace(/[^a-z0-9]+/g, '');

/** Edit distance where swapping two neighbouring letters counts once; stops early above max. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
  }
  return d[a.length]![b.length]!;
}

/** Close names: the same once punctuation and "the" are ignored, or one or two letters apart (longer names). */
export function similarName(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // "Session 3" and "Session 4" are different things, not a typo.
  if ((x.match(/\d+/g) ?? []).join(',') !== (y.match(/\d+/g) ?? []).join(',')) return false;
  const max = Math.min(x.length, y.length) >= 10 ? 2 : Math.min(x.length, y.length) >= 6 ? 1 : 0;
  return max > 0 && editDistance(x, y, max) <= max;
}

export function analyzeImport(staged: StagedImport, wiki: WikiIndex, alreadyImported: ReadonlySet<string> = new Set()): ImportAnalysis {
  const bySlug = new Map(wiki.articles.map((a) => [a.slug, a]));
  const byId = new Map(wiki.articles.map((a) => [a.id, a]));
  const byTitle = new Map<string, (typeof wiki.articles)[number]>();
  for (const a of wiki.articles) if (!byTitle.has(norm(a.title))) byTitle.set(norm(a.title), a);
  const redirect = new Map(wiki.redirects.map((r) => [r.from_slug, r.article_id]));
  const fieldsOf = new Map<string, Map<string, string>>();
  for (const f of wiki.fields) {
    const m = fieldsOf.get(f.article_id) ?? new Map<string, string>();
    if (!m.has(norm(f.label))) m.set(norm(f.label), f.value);
    fieldsOf.set(f.article_id, m);
  }
  const catBy = new Map<string, string>();
  for (const c of wiki.categories) { catBy.set(norm(c.name), c.slug); catBy.set(c.slug, c.slug); }
  const inImport = new Set(staged.items.map((i) => i.slug));
  const importTitles = new Map<string, string[]>();
  for (const i of staged.items) for (const t of [i.title, ...i.aliases]) importTitles.set(norm(t), [...(importTitles.get(norm(t)) ?? []), i.slug]);

  const items: ItemAnalysis[] = staged.items.map((it) => {
    let match: ItemAnalysis['match'] = null;
    const found = (a: (typeof wiki.articles)[number] | undefined, why: string) => {
      if (!match && a) match = { id: a.id, slug: a.slug, title: a.title, type: a.type, version: a.version, why, player_visible: a.visibility === 'players' && a.status === 'published' };
    };
    found(bySlug.get(it.slug), 'A page already has this address.');
    found(redirect.has(it.slug) ? byId.get(redirect.get(it.slug)!) : undefined, `"${it.slug}" already redirects to this page.`);
    found(byTitle.get(norm(it.title)), 'A page already has this title.');
    for (const alias of it.aliases) {
      found(byTitle.get(norm(alias)) ?? bySlug.get(slugify(alias)), `Its alias "${alias}" is the name of this page.`);
    }
    const similar = [...new Set([
      ...[it.title, ...it.aliases].flatMap((t) => importTitles.get(norm(t)) ?? []),
      ...staged.items.filter((o) => o.slug !== it.slug && similarName(o.title, it.title)).map((o) => o.slug),
    ])].filter((s) => s !== it.slug);
    const similar_in_wiki = match ? [] : wiki.articles.filter((w) => similarName(w.title, it.title) || it.aliases.some((al) => similarName(w.title, al))).slice(0, 5).map((w) => ({ slug: w.slug, title: w.title }));
    const existingFields = match ? fieldsOf.get((match as { id: string }).id) ?? new Map<string, string>() : new Map<string, string>();
    const new_fields: ItemAnalysis['new_fields'] = [];
    const same_fields: string[] = [];
    const conflicts: ItemAnalysis['conflicts'] = [];
    for (const f of it.infobox) {
      const have = existingFields.get(norm(f.label));
      if (have === undefined) new_fields.push(f);
      else if (norm(have) === norm(f.value)) same_fields.push(f.label);
      else conflicts.push({ label: f.label, existing: have, imported: f.value });
    }
    const targets = [...new Set(wikiLinkTargets(it.summary).concat(it.sections.flatMap((s) => wikiLinkTargets(s.body)), it.infobox.flatMap((f) => wikiLinkTargets(f.value))).map(slugify))].filter((t) => t && t !== it.slug);
    const resolve = (t: string) => bySlug.has(t) || redirect.has(t);
    const links = { to_import: targets.filter((t) => inImport.has(t)), to_wiki: targets.filter((t) => !inImport.has(t) && resolve(t)), missing: targets.filter((t) => !inImport.has(t) && !resolve(t)) };
    const categories = { existing: [] as string[], missing: [] as string[] };
    for (const t of it.tags) {
      const c = catBy.get(norm(t)) ?? catBy.get(slugify(t));
      if (c) { if (!categories.existing.includes(c)) categories.existing.push(c); } else if (!categories.missing.includes(t)) categories.missing.push(t);
    }
    const action: ItemAction = alreadyImported.has(it.slug) ? 'imported' : match ? 'add_to_existing' : 'create';
    return {
      slug: it.slug, action, match, similar_in_wiki, similar_in_import: similar, new_fields, same_fields, conflicts, links, categories,
      provenance: { kind: PROVENANCE_FOR[it.canon], reference: it.source.slice(0, 500) },
      // An existing page is only touched if the DM chooses it page by page.
      default_decision: action === 'create' && similar.length === 0 && similar_in_wiki.length === 0 ? 'approve' : 'review',
    };
  });

  // Connections: stated in a file (approved with both pages), or suggested from links (review).
  const relations: RelationProposal[] = [];
  const seenRel = new Set<string>();
  const add = (r: Omit<RelationProposal, 'key'>) => {
    const key = `${r.source}>${r.kind}>${r.target}`;
    if (seenRel.has(key) || r.source === r.target) return;
    seenRel.add(key);
    relations.push({ key, ...r });
  };
  for (const r of staged.relations) add({ source: r.source, target: r.target, kind: r.kind, label: r.label, basis: 'stated', default_decision: 'approve' });
  const linked = new Set(staged.relations.flatMap((r) => [`${r.source}>${r.target}`, `${r.target}>${r.source}`]));
  for (const a of items) {
    for (const t of [...a.links.to_import, ...a.links.to_wiki]) {
      if (linked.has(`${a.slug}>${t}`)) continue;
      linked.add(`${a.slug}>${t}`);
      add({ source: a.slug, target: bySlug.has(t) || inImport.has(t) ? t : wiki.articles.find((x) => x.id === redirect.get(t))?.slug ?? t, kind: 'related_to', label: 'Mentioned in imported notes', basis: 'link', default_decision: 'review' });
    }
  }

  const live = items.filter((i) => i.action !== 'imported');
  return {
    items,
    relations,
    totals: {
      entries: items.length,
      create: live.filter((i) => i.action === 'create').length,
      add_to_existing: live.filter((i) => i.action === 'add_to_existing').length,
      imported: items.length - live.length,
      duplicates: live.filter((i) => i.match || i.similar_in_import.length > 0 || i.similar_in_wiki.length > 0).length,
      conflicts: live.reduce((n, i) => n + i.conflicts.length, 0),
      relations: relations.filter((r) => r.basis === 'stated').length,
      suggested_relations: relations.filter((r) => r.basis === 'link').length,
      // Everything an import writes is DM-only.
      dm_only: live.length,
      needs_approval: live.length + relations.length,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Decisions -> change sets
// ---------------------------------------------------------------------------------------------
export type Decision = 'approve' | 'reject';
export interface Decisions {
  items: Record<string, Decision>;
  relations: Record<string, Decision>;
  types: Record<string, ArticleType>;
  /** Categories named in the files that do not exist yet, which the DM chose to create (DM-only). */
  categories?: Record<string, Decision>;
}
export const emptyDecisions = (): Decisions => ({ items: {}, relations: {}, types: {}, categories: {} });

/** Missing categories named by approved entries, and whether the DM chose to create each one. */
export function missingCategories(analysis: ImportAnalysis, decisions: Decisions): { name: string; slug: string; entries: number; create: boolean }[] {
  const by = new Map<string, { name: string; slug: string; entries: number; create: boolean }>();
  for (const a of analysis.items) {
    if (a.action === 'imported' || decisionOf(decisions, a.slug, a) !== 'approve') continue;
    for (const name of a.categories.missing) {
      const slug = slugify(name);
      if (!slug) continue;
      const x = by.get(slug) ?? { name, slug, entries: 0, create: (decisions.categories ?? {})[slug] === 'approve' };
      x.entries++;
      by.set(slug, x);
    }
  }
  return [...by.values()].sort((x, y) => x.name.localeCompare(y.name));
}

export function decisionOf(d: Decisions, slug: string, a: Pick<ItemAnalysis, 'default_decision'>): Decision {
  return d.items[slug] ?? (a.default_decision === 'approve' ? 'approve' : 'reject');
}
export function relationDecision(d: Decisions, r: Pick<RelationProposal, 'key' | 'default_decision'>): Decision {
  return d.relations[r.key] ?? (r.default_decision === 'approve' ? 'approve' : 'reject');
}

export interface ImportChunk {
  index: number;
  label: string;
  /** Import entries this part creates or adds to. */
  slugs: string[];
  /** Connections (proposal keys) this part saves. */
  relationKeys: string[];
  changeSet: ChangeSet;
  /** Derived from the content: the same part retried after a lost answer is saved once. */
  idempotencyKey: string;
}

/** FNV-1a, enough to tell two parts apart; not a security boundary (the engine checks digests). */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export const chunkKeyPrefix = (batchId: string) => `imp-${batchId.replace(/-/g, '').slice(0, 12)}-`;

/**
 * Turn the approved entries into parts for the editing engine, against the wiki as it is NOW.
 * Call it again after each saved part (with that part recorded as done): pages are created first,
 * and a connection is saved in the part that creates its source page, or later, once both of its
 * pages exist and the source page's current version is known.
 */
export function buildChunks(
  staged: StagedImport, analysis: ImportAnalysis, decisions: Decisions, batchId: string, label: string,
  wiki: Pick<WikiIndex, 'articles'>, doneRelations: ReadonlySet<string> = new Set(), chunkPages: number = IMPORT_LIMITS.chunkPages,
): ImportChunk[] {
  const byslug = new Map(staged.items.map((i) => [i.slug, i]));
  const inWiki = new Map(wiki.articles.map((a) => [a.slug, a]));
  const chosen = analysis.items.filter((a) => a.action !== 'imported' && decisionOf(decisions, a.slug, a) === 'approve');
  const groups: { kind: 'create' | 'add'; items: ItemAnalysis[] }[] = [];
  const creates = chosen.filter((a) => a.action === 'create');
  const adds = chosen.filter((a) => a.action === 'add_to_existing');
  for (let i = 0; i < creates.length; i += chunkPages) groups.push({ kind: 'create', items: creates.slice(i, i + chunkPages) });
  for (let i = 0; i < adds.length; i += chunkPages) groups.push({ kind: 'add', items: adds.slice(i, i + chunkPages) });

  // Where each import entry lives in the wiki once saved: its own address, or the page it adds to.
  const target = new Map(analysis.items.map((a) => [a.slug, a.match?.slug ?? a.slug]));
  const rejected = new Set(analysis.items.filter((a) => a.action !== 'imported' && decisionOf(decisions, a.slug, a) !== 'approve' && !a.match).map((a) => a.slug));
  const rels = analysis.relations
    .filter((r) => !doneRelations.has(r.key) && relationDecision(decisions, r) === 'approve' && !rejected.has(r.source) && !rejected.has(r.target))
    .map((r) => ({ ...r, from: target.get(r.source) ?? r.source, to: target.get(r.target) ?? r.target }))
    .filter((r) => r.from !== r.to);
  const placed = new Set<string>();

  const chunks: ImportChunk[] = [];
  for (const g of groups) {
    const changes: ChangeOp[] = [];
    const expected: Record<string, string> = {};
    const here = new Set(g.items.map((a) => a.slug));
    for (const a of g.items) {
      const it = byslug.get(a.slug)!;
      const prov = { provenance: a.provenance };
      const rumor = it.canon === 'rumor';
      const head = (h: string) => (rumor ? `Rumour (unconfirmed): ${h}` : h).slice(0, PACKAGE_LIMITS.heading);
      if (a.action === 'create') {
        const type = decisions.types[a.slug] ?? it.type;
        changes.push({ operation: 'create_article', slug: it.slug, title: it.title, type, subtitle: it.subtitle, summary: it.summary, on_exists: 'skip' });
        for (const s of it.sections) changes.push({ operation: 'upsert_section', article_slug: it.slug, heading: head(s.heading), body: s.body, ...prov });
        for (const f of it.infobox) changes.push({ operation: 'upsert_infobox_field', article_slug: it.slug, label: f.label, value: f.value, ...prov });
        for (const n of it.notes) changes.push({ operation: 'add_dm_note', article_slug: it.slug, title: n.title, body: n.body });
        for (const c of a.categories.existing) changes.push({ operation: 'add_category_link', article_slug: it.slug, category_slug: c });
      } else {
        // Additions only, under a heading that says where they came from. Nothing is replaced.
        const dest = a.match!.slug;
        expected[dest] = `v${a.match!.version}`;
        const where = it.source.slice(0, 120);
        for (const s of it.sections) changes.push({ operation: 'upsert_section', article_slug: dest, heading: head(`${s.heading || 'Notes'} (imported from ${where})`), body: s.body, ...prov });
        if (it.summary) changes.push({ operation: 'upsert_section', article_slug: dest, heading: head(`Summary (imported from ${where})`), body: it.summary, ...prov });
        for (const f of a.new_fields) changes.push({ operation: 'upsert_infobox_field', article_slug: dest, label: f.label, value: f.value, ...prov });
        if (a.conflicts.length) {
          changes.push({ operation: 'add_dm_note', article_slug: dest, title: `Import conflicts (${where})`.slice(0, 200), body: a.conflicts.map((c) => `- **${c.label}**: the wiki says “${c.existing}”; the import says “${c.imported}”. Nothing was changed.`).join('\n') });
        }
        for (const n of it.notes) changes.push({ operation: 'add_dm_note', article_slug: dest, title: n.title, body: n.body });
        for (const c of a.categories.existing) changes.push({ operation: 'add_category_link', article_slug: dest, category_slug: c });
      }
    }
    // Connections whose source is in this part, when the other page exists or is made here too.
    const relationKeys: string[] = [];
    for (const r of rels) {
      if (!here.has(r.source)) continue;
      const otherReady = here.has(r.target) || (inWiki.has(r.to) && !chosen.some((a) => a.slug === r.target && a.action === 'create'));
      if (!otherReady) continue;
      changes.push({ operation: 'add_relation', source_slug: r.from, target_slug: r.to, kind: r.kind, label: r.label });
      relationKeys.push(r.key);
      placed.add(r.key);
    }
    if (changes.length === 0) continue;
    chunks.push({ index: chunks.length, label: `${label} — ${g.kind === 'create' ? 'new pages' : 'additions'} ${chunks.length + 1}`.slice(0, 200), slugs: g.items.map((a) => a.slug), relationKeys,
      changeSet: { label: '', changes, ...(Object.keys(expected).length ? { expected_versions: expected } : {}) }, idempotencyKey: '' });
  }
  // The rest, once both pages exist: needs the source page's current version.
  const ready = rels.filter((r) => !placed.has(r.key) && inWiki.has(r.from) && inWiki.has(r.to)
    && !chosen.some((a) => (a.slug === r.source || a.slug === r.target)));
  for (let i = 0; i < ready.length; i += 200) {
    const part = ready.slice(i, i + 200);
    chunks.push({
      index: chunks.length, label: `${label} — connections ${i / 200 + 1}`.slice(0, 200), slugs: [], relationKeys: part.map((r) => r.key),
      changeSet: { label: '', expected_versions: Object.fromEntries(part.map((r) => [r.from, `v${inWiki.get(r.from)!.version}`])), changes: part.map((r) => ({ operation: 'add_relation' as const, source_slug: r.from, target_slug: r.to, kind: r.kind, label: r.label })) },
      idempotencyKey: '',
    });
  }
  for (const c of chunks) {
    c.changeSet.label = c.label;
    c.idempotencyKey = `${chunkKeyPrefix(batchId)}${c.index}-${hash(JSON.stringify(c.changeSet))}`;
  }
  return chunks;
}

/**
 * The next part to save, worked out from the batch's record and the wiki as it is now. Saving one
 * part at a time and asking again is what makes an interrupted import resumable.
 */
export function nextChunk(staged: StagedImport, wiki: WikiIndex, decisions: Decisions, batchId: string, label: string, progress: ProgressEntry[]) {
  const applied = progress.filter((p) => p.status === 'applied');
  const doneItems = new Set(applied.flatMap((p) => p.slugs));
  const doneRelations = new Set(applied.flatMap((p) => p.relations ?? []));
  const analysis = analyzeImport(staged, wiki, doneItems);
  const chunks = buildChunks(staged, analysis, decisions, batchId, label, wiki, doneRelations);
  return { chunk: chunks[0] ?? null, remaining: chunks.length, analysis, doneRelations };
}

/**
 * Parts the engine saved but the batch did not record (the browser closed, or the answer was
 * lost): found again in the DM's own saved change sets by their key, so nothing is redone.
 */
export function recoverProgress(batchId: string, progress: ProgressEntry[], saved: { idempotency_key: string; id: string; result: { created?: string[]; updated?: string[] } | null }[], analysis: ImportAnalysis): ProgressEntry[] {
  const known = new Set(progress.map((p) => p.key));
  const prefix = chunkKeyPrefix(batchId);
  const out = [...progress];
  for (const cs of saved) {
    if (!cs.idempotency_key.startsWith(prefix) || known.has(cs.idempotency_key)) continue;
    const touched = new Set([...(cs.result?.created ?? []), ...(cs.result?.updated ?? [])]);
    const slugs = analysis.items.filter((a) => touched.has(a.slug) || (a.match && touched.has(a.match.slug))).map((a) => a.slug);
    out.push({ chunk: Number(cs.idempotency_key.slice(prefix.length).split('-')[0]) || 0, key: cs.idempotency_key, slugs, status: 'applied', change_set_id: cs.id, message: 'recovered', at: new Date().toISOString() });
  }
  return out;
}

/**
 * What a saved part really did. An entry whose page was created by someone else between review
 * and save is skipped by the engine (it never overwrites): it is reported, not counted as saved.
 */
export function progressFromResult(chunk: ImportChunk, result: { change_set_id?: string | null; skipped?: string[] }, at: string): ProgressEntry {
  const skipped = new Set(result.skipped ?? []);
  const slugs = chunk.slugs.filter((s) => !skipped.has(s));
  const lost = chunk.slugs.filter((s) => skipped.has(s));
  return { chunk: chunk.index, key: chunk.idempotencyKey, slugs, relations: chunk.relationKeys, status: 'applied', change_set_id: result.change_set_id ?? null, at,
    ...(lost.length ? { message: `not saved because a page with the same address already exists: ${lost.join(', ')}` } : {}) };
}

/** The import entry a failing change belongs to, from the engine's 1-based change index. */
export function entryForChange(chunk: ImportChunk, analysis: ImportAnalysis, index: number): string | null {
  const op = chunk.changeSet.changes[index - 1] as { article_slug?: string; slug?: string; source_slug?: string } | undefined;
  const target = op?.article_slug ?? op?.slug ?? op?.source_slug;
  if (!target) return null;
  return analysis.items.find((a) => a.slug === target || a.match?.slug === target)?.slug ?? null;
}

/** Connections that can never be saved as chosen: one of their pages is missing and not coming. */
export function pendingRelations(analysis: ImportAnalysis, decisions: Decisions, wiki: Pick<WikiIndex, 'articles'>, doneRelations: ReadonlySet<string>): RelationProposal[] {
  const target = new Map(analysis.items.map((a) => [a.slug, a.match?.slug ?? a.slug]));
  const coming = new Set(analysis.items.filter((a) => a.action !== 'imported' && decisionOf(decisions, a.slug, a) === 'approve').map((a) => a.slug));
  const exists = new Set(wiki.articles.map((a) => a.slug));
  return analysis.relations.filter((r) => !doneRelations.has(r.key) && relationDecision(decisions, r) === 'approve'
    && ![r.source, r.target].every((s) => exists.has(target.get(s) ?? s) || coming.has(s)));
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------
export interface ProgressEntry { chunk: number; key: string; slugs: string[]; relations?: string[]; status: 'applied' | 'failed'; message?: string; change_set_id?: string | null; at: string }

export function importReport(label: string, staged: StagedImport, analysis: ImportAnalysis, decisions: Decisions, progress: ProgressEntry[]): string {
  const t = analysis.totals;
  const byslug = new Map(staged.items.map((i) => [i.slug, i]));
  const lines = [
    `# Import report: ${label}`, '',
    `Entries: ${t.entries}. New pages: ${t.create}. Additions to existing pages: ${t.add_to_existing}. Already imported: ${t.imported}.`,
    `Possible duplicates: ${t.duplicates}. Conflicting facts: ${t.conflicts}. Stated connections: ${t.relations}. Suggested connections: ${t.suggested_relations}.`,
    'Everything this import saves is a DM-only draft. Nothing was published.', '',
    '## Entries', '',
  ];
  for (const a of analysis.items) {
    const it = byslug.get(a.slug)!;
    const d = a.action === 'imported' ? 'imported' : decisionOf(decisions, a.slug, a) === 'approve' ? 'approved' : 'not approved';
    lines.push(`- **${it.title}** (${decisions.types[a.slug] ?? it.type}, ${CANON_LABEL[it.canon].toLowerCase()}) — ${a.action === 'create' ? 'new page' : a.action === 'imported' ? 'already imported' : `adds to “${a.match!.title}”`}; ${d}. Source: ${it.source}.`);
    for (const c of a.conflicts) lines.push(`  - Conflict, not applied: ${c.label}: wiki “${c.existing}”, import “${c.imported}”.`);
    if (a.similar_in_wiki.length) lines.push(`  - Similar existing page: ${a.similar_in_wiki.map((w) => w.title).join(', ')}.`);
    if (a.links.missing.length) lines.push(`  - Links to pages that do not exist: ${a.links.missing.join(', ')}.`);
    if (a.categories.missing.length) lines.push(`  - Categories that do not exist yet (not created): ${a.categories.missing.join(', ')}.`);
  }
  if (staged.errors.length) {
    lines.push('', '## Not imported', '');
    for (const e of staged.errors) lines.push(`- ${e.name}: ${e.message}`);
  }
  if (progress.length) {
    lines.push('', '## Saving', '');
    for (const p of progress) lines.push(`- Part ${p.chunk + 1}: ${p.status}${p.message ? ` (${p.message})` : ''}, ${p.slugs.length} page(s), ${p.at}.`);
  }
  return lines.join('\n') + '\n';
}
