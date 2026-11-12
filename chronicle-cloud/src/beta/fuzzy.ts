// Small fuzzy matcher for Quick jump: every typed character must appear in order; consecutive
// runs, word starts and an exact prefix score higher. Case and accents are ignored.

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A score (higher is better) or null when the query does not match. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = fold(query).replace(/\s+/g, '');
  const t = fold(text);
  if (!q) return 0;
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    const wordStart = found === 0 || /[\s\-:'’(]/.test(t[found - 1]!);
    run = found === ti ? run + 1 : 1;
    score += 1 + run * 2 + (wordStart ? 6 : 0) - Math.min(found - ti, 6) * 0.5;
    ti = found + 1;
  }
  if (t.startsWith(fold(query).trim())) score += 25;
  if (t === fold(query).trim()) score += 50;
  return score - t.length * 0.05;
}

export function rank<T>(query: string, items: T[], text: (item: T) => string, limit = 12): T[] {
  return items
    .map((item) => ({ item, s: fuzzyScore(query, text(item)) }))
    .filter((x): x is { item: T; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.item);
}
