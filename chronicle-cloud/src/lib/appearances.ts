// Merging [[links]] and plain-text mentions into one "appears in" list (pure; see mentions.ts).
import type { ArticleRef } from './types.ts';

/** Links first (they are deliberate), then plain-text mentions, each page once. */
export function mergeAppearances(links: ArticleRef[], mentions: ArticleRef[]): ArticleRef[] {
  const seen = new Set(links.map((l) => l.slug));
  return [...links, ...mentions.filter((m) => !seen.has(m.slug) && (seen.add(m.slug), true))];
}
