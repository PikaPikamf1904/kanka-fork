// "Recently updated": which pages changed, built from what the reader can read. For a player that
// is the sections they can read (each section keeps its own updated_at) and the publication date of
// pages they can read, so an edit the DM makes to hidden text never shows up as "updated".
import type { ArticleType } from './types.ts';

export interface RecentPage { id: string; slug: string; title: string; type: ArticleType; published_at: string | null }
export interface RecentSection { article_id: string; heading: string; updated_at: string }

export interface RecentEntry {
  page: RecentPage;
  at: string;
  /** True when the page was published inside the window and nothing later changed. */
  isNew: boolean;
  /** Headings of the sections that changed, newest first (empty headings left out). */
  headings: string[];
}

export interface RecentDay { day: string; entries: RecentEntry[] }

export function recentChanges(pages: RecentPage[], sections: RecentSection[], limit = 50): RecentEntry[] {
  const byId = new Map(pages.filter((p) => p.type !== 'news').map((p) => [p.id, p]));
  const entries = new Map<string, RecentEntry>();
  for (const p of byId.values()) {
    if (p.published_at) entries.set(p.id, { page: p, at: p.published_at, isNew: true, headings: [] });
  }
  for (const s of [...sections].sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
    const page = byId.get(s.article_id);
    if (!page) continue;
    const e = entries.get(page.id) ?? { page, at: s.updated_at, isNew: false, headings: [] };
    // A section edited well after publication makes this an update, not a new page.
    if (e.isNew && Date.parse(s.updated_at) - Date.parse(e.at) > 60_000) e.isNew = false;
    if (s.updated_at > e.at) e.at = s.updated_at;
    const h = s.heading.replace(/^\s*\[[^\]]*\]\s*/, '').trim();
    if (h && !e.headings.includes(h) && e.headings.length < 4) e.headings.push(h);
    entries.set(page.id, e);
  }
  return [...entries.values()].sort((a, b) => b.at.localeCompare(a.at) || a.page.title.localeCompare(b.page.title)).slice(0, limit);
}

/** Groups entries by local calendar day, labelled Today / Yesterday / a long date. */
export function groupByDay(entries: RecentEntry[], now: Date, format: (d: Date) => string): RecentDay[] {
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const today = key(now);
  const yesterday = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const days: RecentDay[] = [];
  for (const e of entries) {
    const d = new Date(e.at);
    const k = key(d);
    const label = k === today ? 'Today' : k === yesterday ? 'Yesterday' : format(d);
    const last = days[days.length - 1];
    if (last && last.day === label) last.entries.push(e);
    else days.push({ day: label, entries: [e] });
  }
  return days;
}
