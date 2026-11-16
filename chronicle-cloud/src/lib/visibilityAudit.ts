// The DM's visibility audit, as a pure function so it can be unit-tested. It answers two questions:
// what can players read (totals by kind and by category), and where might something players can
// read give away something they cannot (a link or a plain mention of a hidden page's name, a
// page that is published to players but shows them nothing, a page meant for players but still a
// draft). It only reports; nothing here changes visibility.
import { slugify } from './slug.ts';
import { TYPE_ORDER } from './templates.ts';
import type { ArticleType, PublishStatus, Visibility } from './types.ts';

export interface AuditArticle {
  id: string;
  slug: string;
  title: string;
  type: ArticleType;
  visibility: Visibility;
  status: PublishStatus;
  /** Whether the summary has any text (the summary itself is not needed). */
  has_summary: boolean;
}

export interface AuditData {
  articles: AuditArticle[];
  sections: { id: string; article_id: string; heading: string; visibility: Visibility; status: PublishStatus }[];
  /** Bodies of sections that are themselves players + published (only those can leak). */
  visibleBodies: { id: string; article_id: string; body: string }[];
  links: { source_section_id: string; target_slug: string }[];
  redirects: { from_slug: string; article_id: string }[];
  /** Infobox fields marked players (label and value). */
  visibleFields: { article_id: string; label: string; value: string }[];
  categories: { id: string; name: string }[];
  articleCategories: { article_id: string; category_id: string }[];
}

export type FindingKind = 'link' | 'mention' | 'empty' | 'draft';

export interface Finding {
  kind: FindingKind;
  /** The page players can read where the problem shows (or, for "draft", the page itself). */
  page: AuditArticle;
  /** Section heading or infobox label where it was found; '' for the page as a whole. */
  where: string;
  /** The hidden page that leaks, for links and mentions. */
  hidden?: AuditArticle;
}

export interface Totals { readable: number; playersDraft: number; dmOnly: number }

export interface Audit {
  byType: { type: ArticleType; totals: Totals }[];
  byCategory: { id: string; name: string; totals: Totals }[];
  overall: Totals;
  findings: Record<FindingKind, Finding[]>;
}

export const MIN_MENTION_LENGTH = 5;
/** Bounds the plain-text search so a very large wiki cannot freeze the page. */
export const MAX_MENTION_TITLES = 2000;
const TITLES_PER_PATTERN = 150;

export const isReadable = (a: Pick<AuditArticle, 'visibility' | 'status'>) => a.visibility === 'players' && a.status === 'published';

function bucket(a: AuditArticle): keyof Totals {
  if (isReadable(a)) return 'readable';
  return a.visibility === 'players' ? 'playersDraft' : 'dmOnly';
}

const emptyTotals = (): Totals => ({ readable: 0, playersDraft: 0, dmOnly: 0 });
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Finds hidden-page titles mentioned as whole words in a text. Titles shorter than
 * MIN_MENTION_LENGTH and titles that a readable page shares are ignored (they would be noise).
 */
export function mentionMatcher(hiddenTitles: string[]): (text: string) => string[] {
  const titles = [...new Set(hiddenTitles.map((t) => t.trim()).filter((t) => t.length >= MIN_MENTION_LENGTH))]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_MENTION_TITLES);
  const patterns: RegExp[] = [];
  for (let i = 0; i < titles.length; i += TITLES_PER_PATTERN) {
    const chunk = titles.slice(i, i + TITLES_PER_PATTERN).map(escapeRegExp).join('|');
    // Word boundaries that also work next to accented letters and apostrophes.
    patterns.push(new RegExp(`(?<![\\p{L}\\p{N}])(?:${chunk})(?![\\p{L}\\p{N}])`, 'giu'));
  }
  const byLower = new Map(titles.map((t) => [t.toLowerCase(), t]));
  return (text: string) => {
    const found = new Set<string>();
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        const t = byLower.get(m[0].toLowerCase());
        if (t) found.add(t);
      }
    }
    return [...found];
  };
}

export function computeAudit(d: AuditData): Audit {
  const byId = new Map(d.articles.map((a) => [a.id, a]));
  const bySlug = new Map(d.articles.map((a) => [a.slug, a]));
  for (const r of d.redirects) {
    const a = byId.get(r.article_id);
    if (a && !bySlug.has(r.from_slug)) bySlug.set(r.from_slug, a);
  }
  const sectionById = new Map(d.sections.map((s) => [s.id, s]));
  const visibleSection = (s: { visibility: Visibility; status: PublishStatus; article_id: string } | undefined) => {
    const a = s ? byId.get(s.article_id) : undefined;
    return !!s && !!a && s.visibility === 'players' && s.status === 'published' && isReadable(a);
  };

  // ---- totals ----
  const overall = emptyTotals();
  const typeTotals = new Map<ArticleType, Totals>();
  for (const a of d.articles) {
    if (a.type === 'news') continue;
    overall[bucket(a)]++;
    const t = typeTotals.get(a.type) ?? emptyTotals();
    t[bucket(a)]++;
    typeTotals.set(a.type, t);
  }
  const catTotals = new Map<string, Totals>();
  for (const ac of d.articleCategories) {
    const a = byId.get(ac.article_id);
    if (!a || a.type === 'news') continue;
    const t = catTotals.get(ac.category_id) ?? emptyTotals();
    t[bucket(a)]++;
    catTotals.set(ac.category_id, t);
  }

  // ---- findings ----
  const findings: Record<FindingKind, Finding[]> = { link: [], mention: [], empty: [], draft: [] };
  const seen = new Set<string>();
  const add = (f: Finding) => {
    const key = `${f.kind}|${f.page.id}|${f.where}|${f.hidden?.id ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings[f.kind].push(f);
  };

  // Links from a section players can read to a page they cannot (the link text often names it).
  for (const l of d.links) {
    const s = sectionById.get(l.source_section_id);
    if (!s || !visibleSection(s)) continue;
    const target = bySlug.get(slugify(l.target_slug));
    if (target && !isReadable(target) && target.id !== s.article_id) add({ kind: 'link', page: byId.get(s.article_id)!, where: s.heading, hidden: target });
  }
  // Links in infobox fields players can read.
  const linkRe = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  for (const f of d.visibleFields) {
    const page = byId.get(f.article_id);
    if (!page || !isReadable(page)) continue;
    for (const m of f.value.matchAll(linkRe)) {
      const target = bySlug.get(slugify(m[1] ?? ''));
      if (target && !isReadable(target) && target.id !== page.id) add({ kind: 'link', page, where: f.label, hidden: target });
    }
  }

  // Plain mentions of a hidden page's title. A title a readable page also uses is not a secret.
  const readableTitles = new Set(d.articles.filter(isReadable).map((a) => a.title.trim().toLowerCase()));
  const hidden = d.articles.filter((a) => !isReadable(a) && a.type !== 'news' && !readableTitles.has(a.title.trim().toLowerCase()));
  const hiddenByTitle = new Map(hidden.map((a) => [a.title.trim().toLowerCase(), a]));
  const match = mentionMatcher(hidden.map((a) => a.title));
  const linkedPairs = new Set(findings.link.map((f) => `${f.page.id}|${f.hidden!.id}`));
  const mention = (page: AuditArticle, where: string, text: string) => {
    for (const t of match(text)) {
      const h = hiddenByTitle.get(t.toLowerCase());
      if (h && h.id !== page.id && !linkedPairs.has(`${page.id}|${h.id}`)) add({ kind: 'mention', page, where, hidden: h });
    }
  };
  for (const b of d.visibleBodies) {
    const s = sectionById.get(b.id);
    if (!s || !visibleSection(s)) continue;
    mention(byId.get(s.article_id)!, s.heading, b.body);
  }
  for (const f of d.visibleFields) {
    const page = byId.get(f.article_id);
    if (page && isReadable(page)) mention(page, f.label, f.value);
  }

  // Published to players, but players would see an empty page.
  const withVisibleText = new Set(d.visibleBodies.filter((b) => visibleSection(sectionById.get(b.id)) && b.body.trim()).map((b) => b.article_id));
  for (const a of d.articles) {
    if (a.type === 'news') continue;
    if (isReadable(a) && !a.has_summary && !withVisibleText.has(a.id)) add({ kind: 'empty', page: a, where: '' });
    if (a.visibility === 'players' && a.status === 'draft') add({ kind: 'draft', page: a, where: '' });
  }

  const byTitle = (x: Finding, y: Finding) => x.page.title.localeCompare(y.page.title) || x.where.localeCompare(y.where) || (x.hidden?.title ?? '').localeCompare(y.hidden?.title ?? '');
  for (const k of Object.keys(findings) as FindingKind[]) findings[k].sort(byTitle);

  return {
    overall,
    byType: TYPE_ORDER.filter((t) => typeTotals.has(t)).map((type) => ({ type, totals: typeTotals.get(type)! })),
    byCategory: d.categories
      .filter((c) => catTotals.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, totals: catTotals.get(c.id)! }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    findings,
  };
}

export const leakCount = (a: Audit) => a.findings.link.length + a.findings.mention.length;
