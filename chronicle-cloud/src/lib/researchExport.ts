// Knowledge Studio pure helpers: numbering sources, a citable source list, Markdown export, and
// in-collection search. Every title here is one the reader received under their own RLS; a
// source whose page did not come back is shown as unavailable and never named.

export interface ResolvedSource {
  id: string;
  article_id: string;
  topic: string;
  annotation: string;
  excerpt: string;
  position: number;
  /** null when the page is not readable (hidden or deleted since it was added). */
  page: { slug: string; title: string; type: string } | null;
}

export interface ResearchSummary {
  id: string;
  title: string;
  body: string;
  version: number;
  updated_at: string;
}

export const UNAVAILABLE = 'A source that is no longer available';

/** Sources in reading order, numbered from 1, for citations like [2]. */
export function numberSources(sources: ResolvedSource[]): (ResolvedSource & { n: number })[] {
  return [...sources].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map((s, i) => ({ ...s, n: i + 1 }));
}

/** Sources grouped by topic (untitled topic last), keeping their numbers. */
export function byTopic<T extends ResolvedSource & { n: number }>(sources: T[]): { topic: string; sources: T[] }[] {
  const map = new Map<string, T[]>();
  for (const s of sources) {
    const key = s.topic.trim();
    map.set(key, [...(map.get(key) ?? []), s]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([topic, list]) => ({ topic, sources: list }));
}

/** Citation numbers used in a summary, e.g. "see [1] and [3, 4]" → [1, 3, 4]. */
export function citedNumbers(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const n of m[1]!.split(',')) found.add(Number(n.trim()));
  }
  return [...found].sort((a, b) => a - b);
}

export function sourceLine(s: ResolvedSource & { n: number }, origin: string): string {
  return s.page ? `[${s.n}] ${s.page.title} — ${origin}/wiki/${s.page.slug}` : `[${s.n}] ${UNAVAILABLE}`;
}

export function sourceList(sources: (ResolvedSource & { n: number })[], origin: string): string {
  return sources.map((s) => sourceLine(s, origin)).join('\n');
}

/** A readable Markdown file of the collection: description, sources with provenance, summaries. */
export function collectionMarkdown(
  c: { title: string; description: string },
  sources: (ResolvedSource & { n: number })[],
  summaries: ResearchSummary[],
  origin: string,
  exportedOn: string,
): string {
  const lines: string[] = [`# ${c.title}`, ''];
  if (c.description.trim()) lines.push(c.description.trim(), '');
  lines.push(`_Exported from Chronicle on ${exportedOn}. Only pages you could read at that time are named._`, '');
  if (summaries.length) {
    lines.push('## Research summaries', '');
    for (const s of summaries) lines.push(`### ${s.title}`, '', s.body.trim(), '');
  }
  lines.push('## Sources', '');
  for (const group of byTopic(sources)) {
    if (group.topic) lines.push(`### ${group.topic}`, '');
    for (const s of group.sources) {
      lines.push(`- ${sourceLine(s, origin)}`);
      if (s.page && s.excerpt.trim()) lines.push(`  > ${s.excerpt.trim().replace(/\n+/g, ' ')}`);
      if (s.annotation.trim()) lines.push(`  Note: ${s.annotation.trim().replace(/\n+/g, ' ')}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/** Search within one collection: page titles, topics, excerpts, notes and summaries. */
export function searchCollection(sources: (ResolvedSource & { n: number })[], summaries: ResearchSummary[], q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return { sources, summaries };
  const has = (t: string) => t.toLowerCase().includes(needle);
  return {
    sources: sources.filter((s) => (s.page && has(s.page.title)) || has(s.topic) || has(s.annotation) || (s.page && has(s.excerpt))),
    summaries: summaries.filter((s) => has(s.title) || has(s.body)),
  };
}
