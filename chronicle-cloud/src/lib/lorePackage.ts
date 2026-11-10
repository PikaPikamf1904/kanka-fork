// Lore packages: JSON files of draft pages that the DM uploads at /dm/import.
//
// This module only reads and checks a package; it never talks to the database. Two shapes are
// accepted:
//   - simple:   { "articles": [{ slug, title, type, subtitle?, summary?, sections, infobox?, notes? }] }
//   - lore pack: the files in chronicle-cloud/lore/ (adds facts, questions and relations)
//
// Whatever the file says, an import creates DM-only drafts. Visibility and status fields in a
// package are never honoured; they are reported so the DM knows the file asked for them.
import type { ArticleType } from './types.ts';

export const PACKAGE_LIMITS = {
  fileBytes: 2_000_000,
  articles: 200,
  sections: 30,
  infobox: 30,
  notes: 10,
  slug: 160,
  title: 200,
  subtitle: 200,
  summary: 2000,
  heading: 200,
  body: 30_000,
  label: 80,
  value: 2000,
} as const;

const TYPES: readonly ArticleType[] = ['lore', 'character', 'location', 'faction', 'item', 'quest', 'session', 'event', 'dossier'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KIND = /^[a-z_]{2,40}$/;

export interface PackageArticle {
  slug: string;
  title: string;
  type: ArticleType;
  subtitle: string;
  summary: string;
  sections: { heading: string; body: string }[];
  infobox: { label: string; value: string }[];
  /** Private DM notes stored with the page (provenance, open questions). Never publishable. */
  notes: { title: string; body: string }[];
}

export interface PackageRelation { source: string; target: string; kind: string; label: string }

export interface PackageProblem {
  /** Position in the file (1-based), or 0 for the file as a whole. */
  index: number;
  /** Best available name for the entry, for display. */
  name: string;
  message: string;
}

export interface ParsedPackage {
  /** Entries that passed every check, in file order. */
  articles: PackageArticle[];
  relations: PackageRelation[];
  /** Entries that were refused; nothing from them is imported. */
  errors: PackageProblem[];
  /** Things the DM should know that do not stop an import. */
  warnings: PackageProblem[];
  total: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Characters that have no business in wiki text: control codes other than tab and newline. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function wikiLinkTargets(body: string): string[] {
  return [...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]!.trim());
}

function hasUnsafeFlags(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUnsafeFlags);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([k, v]) =>
    (k === 'visibility' && v !== 'dm') || (k === 'status' && v !== 'draft' && typeof v === 'string' && ['published', 'public', 'players'].includes(v)) || hasUnsafeFlags(v));
}

function checkText(value: unknown, max: number, what: string, required: boolean): string {
  const s = str(value);
  if (s === null) {
    if (value === undefined || value === null) {
      if (required) throw new Error(`${what} is missing`);
      return '';
    }
    throw new Error(`${what} must be text`);
  }
  if (required && !s.trim()) throw new Error(`${what} is empty`);
  if (s.length > max) throw new Error(`${what} is too long (${s.length} characters, limit ${max})`);
  if (CONTROL.test(s)) throw new Error(`${what} contains control characters`);
  return s;
}

function parseArticle(raw: unknown): PackageArticle {
  if (!isRecord(raw)) throw new Error('entry is not an object');
  const slug = checkText(raw.slug, PACKAGE_LIMITS.slug, 'address (slug)', true);
  if (!SLUG.test(slug)) throw new Error(`address "${slug.slice(0, 60)}" may only use lower-case letters, digits and single hyphens`);
  const title = checkText(raw.title, PACKAGE_LIMITS.title, 'title', true).trim();
  if (!TYPES.includes(raw.type as ArticleType)) throw new Error(`type ${JSON.stringify(raw.type)} is not supported`);
  const subtitle = checkText(raw.subtitle, PACKAGE_LIMITS.subtitle, 'subtitle', false);
  const summary = checkText(raw.summary, PACKAGE_LIMITS.summary, 'summary', false);

  if (!Array.isArray(raw.sections)) throw new Error('sections must be a list');
  if (raw.sections.length < 1) throw new Error('at least one section is needed');
  if (raw.sections.length > PACKAGE_LIMITS.sections) throw new Error(`too many sections (limit ${PACKAGE_LIMITS.sections})`);
  const sections = raw.sections.map((s: unknown, i: number) => {
    if (!isRecord(s)) throw new Error(`section ${i + 1} is not an object`);
    return {
      heading: checkText(s.heading, PACKAGE_LIMITS.heading, `section ${i + 1} heading`, false),
      body: checkText(s.body, PACKAGE_LIMITS.body, `section ${i + 1} text`, true),
    };
  });

  const rawInfobox = raw.infobox === undefined || raw.infobox === null ? [] : raw.infobox;
  if (!Array.isArray(rawInfobox)) throw new Error('infobox must be a list');
  if (rawInfobox.length > PACKAGE_LIMITS.infobox) throw new Error(`too many infobox fields (limit ${PACKAGE_LIMITS.infobox})`);
  const infobox = rawInfobox.map((f: unknown, i: number) => {
    if (!isRecord(f)) throw new Error(`infobox field ${i + 1} is not an object`);
    return {
      label: checkText(f.label, PACKAGE_LIMITS.label, `infobox field ${i + 1} label`, true).trim(),
      value: checkText(f.value, PACKAGE_LIMITS.value, `infobox field ${i + 1} value`, false),
    };
  });

  // Notes: explicit notes, plus the provenance and questions carried by repository lore packs.
  const notes: PackageArticle['notes'] = [];
  for (const n of Array.isArray(raw.notes) ? raw.notes : []) {
    if (!isRecord(n)) throw new Error('a note is not an object');
    notes.push({ title: checkText(n.title, PACKAGE_LIMITS.heading, 'note title', false), body: checkText(n.body, PACKAGE_LIMITS.body, 'note text', true) });
  }
  if (Array.isArray(raw.facts) && raw.facts.length > 0) {
    const lines = raw.facts.filter(isRecord).map((f) => `- **${str(f.level) ?? 'unrated'}**: ${str(f.text) ?? ''}${str(f.source) ? ` _(${str(f.source)})_` : ''}`);
    notes.push({ title: 'Provenance', body: checkText(lines.join('\n'), PACKAGE_LIMITS.body, 'provenance', true) });
  }
  if (Array.isArray(raw.questions) && raw.questions.length > 0) {
    const lines = raw.questions.filter((q): q is string => typeof q === 'string').map((q) => `- ${q}`);
    if (lines.length) notes.push({ title: 'Questions for the DM', body: checkText(lines.join('\n'), PACKAGE_LIMITS.body, 'questions', true) });
  }
  if (notes.length > PACKAGE_LIMITS.notes) throw new Error(`too many notes (limit ${PACKAGE_LIMITS.notes})`);
  return { slug, title, type: raw.type as ArticleType, subtitle, summary, sections, infobox, notes };
}

/**
 * Check a parsed JSON value. Never throws for bad content: every problem is listed, and the
 * entries that are fine can still be imported.
 */
export function parsePackage(data: unknown): ParsedPackage {
  const out: ParsedPackage = { articles: [], relations: [], errors: [], warnings: [], total: 0 };
  const fileError = (message: string) => {
    out.errors.push({ index: 0, name: 'File', message });
    return out;
  };
  if (!isRecord(data)) return fileError('This is not a lore package: expected a JSON object with an "articles" list.');
  if (!Array.isArray(data.articles)) return fileError('This is not a lore package: the "articles" list is missing.');
  out.total = data.articles.length;
  if (out.total === 0) return fileError('The package has no articles.');
  if (out.total > PACKAGE_LIMITS.articles) return fileError(`The package has ${out.total} articles; the limit is ${PACKAGE_LIMITS.articles}. Split it into smaller files.`);

  if (hasUnsafeFlags(data)) {
    out.warnings.push({ index: 0, name: 'File', message: 'The file asks for player visibility or published status somewhere. That is ignored: everything is imported as a DM-only draft.' });
  }

  const slugs = new Map<string, number>();
  const titles = new Map<string, string>();
  for (const [i, raw] of data.articles.entries()) {
    const name = isRecord(raw) ? (str(raw.title) ?? str(raw.slug) ?? `Entry ${i + 1}`).slice(0, 80) : `Entry ${i + 1}`;
    try {
      const article = parseArticle(raw);
      const earlier = slugs.get(article.slug);
      if (earlier !== undefined) throw new Error(`same address as entry ${earlier} ("${article.slug}")`);
      slugs.set(article.slug, i + 1);
      const sameTitle = titles.get(article.title.toLowerCase());
      if (sameTitle) out.warnings.push({ index: i + 1, name, message: `Same title as "${sameTitle}". Check these are not the same subject.` });
      titles.set(article.title.toLowerCase(), article.slug);
      out.articles.push(article);
    } catch (error) {
      out.errors.push({ index: i + 1, name, message: error instanceof Error ? error.message : 'could not be read' });
    }
  }

  // Connections (lore packs only). Ends are given as addresses of pages in this package.
  if (Array.isArray(data.relations)) {
    const byRef = new Map<string, string>();
    for (const raw of data.articles) if (isRecord(raw) && str(raw.slug)) byRef.set(str(raw.ref) ?? str(raw.slug)!, str(raw.slug)!);
    const ok = new Set(out.articles.map((a) => a.slug));
    const seen = new Set<string>();
    for (const [i, raw] of data.relations.entries()) {
      if (!isRecord(raw)) continue;
      const source = byRef.get(str(raw.source) ?? '');
      const target = byRef.get(str(raw.target) ?? '');
      const kind = str(raw.kind) ?? '';
      const key = `${source}:${kind}:${target}`;
      if (!source || !target || !ok.has(source) || !ok.has(target) || source === target || !KIND.test(kind) || seen.has(key)) {
        out.warnings.push({ index: 0, name: `Connection ${i + 1}`, message: 'Skipped: it does not join two different, valid pages of this package.' });
        continue;
      }
      seen.add(key);
      out.relations.push({ source, target, kind, label: (str(raw.label) ?? '').slice(0, 120) });
    }
  }
  return out;
}

/** Parse the text of an uploaded file. */
export function parsePackageText(text: string): ParsedPackage {
  if (new TextEncoder().encode(text).length > PACKAGE_LIMITS.fileBytes) {
    return { articles: [], relations: [], total: 0, warnings: [], errors: [{ index: 0, name: 'File', message: 'The file is too large (limit 2 MB).' }] };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { articles: [], relations: [], total: 0, warnings: [], errors: [{ index: 0, name: 'File', message: 'This file is not valid JSON.' }] };
  }
  return parsePackage(data);
}

/** Links in the package that point at pages which are neither in the package nor in the wiki. */
export function danglingLinks(articles: PackageArticle[], existingSlugs: ReadonlySet<string>): { slug: string; targets: string[] }[] {
  const inPack = new Set(articles.map((a) => a.slug));
  return articles
    .map((a) => ({
      slug: a.slug,
      targets: [...new Set(a.sections.flatMap((s) => wikiLinkTargets(s.body)).map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')))]
        .filter((t) => t && !inPack.has(t) && !existingSlugs.has(t)),
    }))
    .filter((x) => x.targets.length > 0);
}
