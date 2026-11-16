// "Wander": pick a random readable page without downloading the wiki. The pick logic is pure (the
// random source and the page lookup are passed in) so it can be tested; the recent-slug memory
// lives in sessionStorage, which is per browser tab and is cleared whenever the account changes.

export const RECENT_LIMIT = 10;
export const MAX_ROLLS = 5;
const KEY = 'chronicle-wander-recent';

/** A random whole number in [0, count). */
export function randomOffset(count: number, random: () => number = Math.random): number {
  return Math.min(count - 1, Math.floor(random() * count));
}

/** The recent list with `slug` as the newest, without duplicates, capped at `limit`. */
export function remember(recent: string[], slug: string, limit = RECENT_LIMIT): string[] {
  return [...recent.filter((s) => s !== slug), slug].slice(-limit);
}

/**
 * Picks a page: a random offset into the readable pages, looked up with `at(offset)`, re-rolled up to
 * `rolls` times while the result was visited recently. When every roll repeats (a tiny wiki) the
 * last page is used, unless another one exists and it is the very latest visit. Null for an empty
 * wiki or when nothing could be fetched.
 */
export async function pickWander(opts: {
  count: number;
  at: (offset: number) => Promise<string | null>;
  recent: string[];
  random?: () => number;
  rolls?: number;
}): Promise<string | null> {
  const { count, at, recent, random = Math.random, rolls = MAX_ROLLS } = opts;
  if (count <= 0) return null;
  let fallback: string | null = null;
  const tried = new Set<number>();
  for (let i = 0; i < rolls && tried.size < count; i++) {
    let offset = randomOffset(count, random);
    // Never spend a roll on an offset already looked at.
    while (tried.has(offset) && tried.size < count) offset = (offset + 1) % count;
    tried.add(offset);
    const slug = await at(offset);
    if (!slug) continue;
    if (!recent.includes(slug)) return slug;
    fallback ??= slug;
    if (slug !== recent[recent.length - 1]) fallback = slug;
  }
  return fallback;
}

export function loadRecent(): string[] {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(-RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function saveRecent(recent: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(recent.slice(-RECENT_LIMIT)));
  } catch {
    // Storage blocked: wandering still works, it just may repeat.
  }
}

/** Forget what this tab wandered through; called when the signed-in account changes. */
export function clearWanderHistory() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
