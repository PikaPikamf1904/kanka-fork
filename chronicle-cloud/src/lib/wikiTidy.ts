// The "Tidy up the wiki" report, as a pure function so it can be unit-tested. The rules follow
// chronicle_wiki_health in mcp/src/campaignTools.ts (broken links: target is neither a page nor a
// redirect; orphans: nothing links to the page and it has no connections; sessions are not orphans),
// with two differences: news stories are skipped everywhere (they live on the news desk), and a link
// from a page to itself does not count as "something links here".
import { slugify } from './slug.ts';
import { TYPE_ORDER } from './templates.ts';
import type { ArticleType, PublishStatus, Visibility } from './types.ts';

export interface TidyArticle {
  id: string;
  slug: string;
  title: string;
  type: ArticleType;
  summary: string;
  hero_media_id: string | null;
  visibility: Visibility;
  status: PublishStatus;
}

export interface TidyData {
  articles: TidyArticle[];
  /** Every section: id and owning article (links are stored per section). */
  sections: { id: string; article_id: string }[];
  /** Ids of articles with at least one section whose body is not blank. */
  articlesWithText: string[];
  links: { source_section_id: string; target_slug: string }[];
  redirects: { from_slug: string; article_id: string }[];
  relations: { source_article_id: string; target_article_id: string }[];
  /** Ids of articles with a section of at least STUB_LONG_SECTION characters (found by a server-side filter). */
  longTextArticles: string[];
  /** One entry per section of at least STUB_MEDIUM_SECTION characters. */
  mediumSections: { article_id: string }[];
  /** The DM's private notes that are attached to a page (title only; bodies are never downloaded here). */
  notes: { article_id: string; title: string }[];
}

/**
 * A stub is a page that has some text but little of it. Section lengths are not downloaded (that
 * would pull every body); the server filters instead (see loadWikiTidyData): a page is NOT a stub
 * when one section reaches STUB_LONG_SECTION characters, or when at least STUB_MEDIUM_COUNT sections
 * reach STUB_MEDIUM_SECTION. Pages with no text at all are "Empty pages", not stubs.
 */
export const STUB_LONG_SECTION = 300;
export const STUB_MEDIUM_SECTION = 100;
export const STUB_MEDIUM_COUNT = 3;

/**
 * A PostgreSQL regular expression matching text of at least `n` characters (line breaks included).
 * A single repetition is limited to 255, so longer minimums are built from blocks of 100.
 */
export function minLengthPattern(n: number): string {
  if (n <= 255) return `.{${n}}`;
  const blocks = Math.floor(n / 100);
  const rest = n % 100;
  return `(.{100}){${blocks}}${rest ? `.{${rest}}` : ''}`;
}

/** DM notes about a page, as the tidy report shows them. A note titled "To do ..." marks work to do. */
export interface TidyNotes { count: number; todo: boolean }
export const isTodoNote = (title: string) => /^\s*to[\s-]?do\b/i.test(title);

export type TidyPage = Pick<TidyArticle, 'id' | 'slug' | 'title' | 'type' | 'visibility' | 'status'> & { notes: TidyNotes };
export interface BrokenLink { page: TidyPage; target: string }

export interface TidyReport {
  brokenLinks: BrokenLink[];
  orphans: TidyPage[];
  missingSummary: TidyPage[];
  missingPicture: TidyPage[];
  emptyPages: TidyPage[];
  stubs: TidyPage[];
}

/** Types that should have a picture. */
export const PICTURE_TYPES: ArticleType[] = ['character', 'location', 'faction'];
/** Types that never count as "nothing links here" (a session journal is a record, not a topic). */
export const ORPHAN_EXEMPT: ArticleType[] = ['session', 'news'];

export const isPlayerVisible = (a: Pick<TidyArticle, 'visibility' | 'status'>) => a.visibility === 'players' && a.status === 'published';

const byTitle = (a: { title: string; slug: string }, b: { title: string; slug: string }) =>
  a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || a.slug.localeCompare(b.slug);


export function computeWikiTidy(data: TidyData): TidyReport {
  const articles = data.articles.filter((a) => a.type !== 'news');
  const noteInfo = new Map<string, TidyNotes>();
  for (const n of data.notes) {
    const cur = noteInfo.get(n.article_id) ?? { count: 0, todo: false };
    noteInfo.set(n.article_id, { count: cur.count + 1, todo: cur.todo || isTodoNote(n.title) });
  }
  const brief = (a: TidyArticle): TidyPage => ({ id: a.id, slug: a.slug, title: a.title, type: a.type, visibility: a.visibility, status: a.status, notes: noteInfo.get(a.id) ?? { count: 0, todo: false } });
  const longText = new Set(data.longTextArticles);
  const mediumCount = new Map<string, number>();
  for (const m of data.mediumSections) mediumCount.set(m.article_id, (mediumCount.get(m.article_id) ?? 0) + 1);
  const bySlug = new Map(articles.map((a) => [a.slug, a]));
  const byId = new Map(articles.map((a) => [a.id, a]));
  // A redirect keeps an old address working; only redirects to a page that is in the report count.
  const redirectTo = new Map<string, string>();
  for (const r of data.redirects) redirectTo.set(slugify(r.from_slug), r.article_id);
  const newsSlugs = new Set(data.articles.filter((a) => a.type === 'news').map((a) => a.slug));
  const sectionOwner = new Map(data.sections.map((s) => [s.id, s.article_id]));

  const broken = new Map<string, BrokenLink>();
  const linkedTo = new Set<string>();
  for (const l of data.links) {
    const sourceId = sectionOwner.get(l.source_section_id);
    const source = sourceId ? byId.get(sourceId) : undefined;
    if (!source) continue;
    const target = slugify(l.target_slug);
    if (!target) continue;
    const hit = bySlug.get(target);
    const viaRedirect = redirectTo.get(target);
    if (hit || viaRedirect || newsSlugs.has(target)) {
      const id = hit?.id ?? viaRedirect;
      if (id && id !== source.id) linkedTo.add(id);
      continue;
    }
    broken.set(`${source.id}|${target}`, { page: brief(source), target });
  }

  const connected = new Set<string>();
  for (const r of data.relations) {
    connected.add(r.source_article_id);
    connected.add(r.target_article_id);
  }
  const withText = new Set(data.articlesWithText);
  const pick = (keep: (a: TidyArticle) => boolean) => articles.filter(keep).map(brief).sort(byTitle);

  return {
    brokenLinks: [...broken.values()].sort((a, b) => byTitle(a.page, b.page) || a.target.localeCompare(b.target)),
    orphans: pick((a) => !ORPHAN_EXEMPT.includes(a.type) && !linkedTo.has(a.id) && !connected.has(a.id)),
    missingSummary: pick((a) => !a.summary.trim()),
    missingPicture: pick((a) => PICTURE_TYPES.includes(a.type) && !a.hero_media_id),
    emptyPages: pick((a) => !withText.has(a.id)),
    stubs: pick((a) => withText.has(a.id) && !longText.has(a.id) && (mediumCount.get(a.id) ?? 0) < STUB_MEDIUM_COUNT),
  };
}

/** Keep only problems on pages players can currently read. */
export function onlyPlayerVisible(report: TidyReport): TidyReport {
  const keep = (p: TidyPage) => isPlayerVisible(p);
  return {
    brokenLinks: report.brokenLinks.filter((b) => keep(b.page)),
    orphans: report.orphans.filter(keep),
    missingSummary: report.missingSummary.filter(keep),
    missingPicture: report.missingPicture.filter(keep),
    emptyPages: report.emptyPages.filter(keep),
    stubs: report.stubs.filter(keep),
  };
}

/** Keep only problems on pages of one type (all of them when `type` is null). */
export function onlyType(report: TidyReport, type: ArticleType | null): TidyReport {
  if (!type) return report;
  const keep = (p: TidyPage) => p.type === type;
  return {
    brokenLinks: report.brokenLinks.filter((b) => keep(b.page)),
    orphans: report.orphans.filter(keep),
    missingSummary: report.missingSummary.filter(keep),
    missingPicture: report.missingPicture.filter(keep),
    emptyPages: report.emptyPages.filter(keep),
    stubs: report.stubs.filter(keep),
  };
}

export type TidySort = 'title' | 'type' | 'visibility';
export const TIDY_SORTS: { key: TidySort; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'type', label: 'Type' },
  { key: 'visibility', label: 'Visibility' },
];
export const TIDY_SECTIONS = ['broken', 'orphans', 'summary', 'picture', 'empty', 'stubs'] as const;
export type TidySectionId = (typeof TIDY_SECTIONS)[number];

/** DM-only and draft pages first (they are the ones a reader never sees), then by title. */
const attention = (p: Pick<TidyPage, 'visibility' | 'status'>) => (p.visibility === 'dm' ? 0 : 2) + (p.status === 'draft' ? 0 : 1);

/** A copy of the pages in the chosen order; every order falls back to title so it is stable. */
export function sortPages<T extends { page: TidyPage }>(rows: T[], sort: TidySort): T[];
export function sortPages(rows: TidyPage[], sort: TidySort): TidyPage[];
export function sortPages(rows: (TidyPage | { page: TidyPage })[], sort: TidySort) {
  const page = (r: TidyPage | { page: TidyPage }) => ('page' in r ? r.page : r);
  const key = (p: TidyPage) => (sort === 'type' ? TYPE_ORDER.indexOf(p.type) : sort === 'visibility' ? attention(p) : 0);
  return [...rows].sort((a, b) => key(page(a)) - key(page(b)) || byTitle(page(a), page(b)));
}

export const tidyTotal = (r: TidyReport) => r.brokenLinks.length + r.orphans.length + r.missingSummary.length + r.missingPicture.length + r.emptyPages.length + r.stubs.length;

/** "north-gate" -> "North Gate", for pre-filling the new-page form from a broken link. */
export function titleFromSlug(slug: string): string {
  return slug.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
