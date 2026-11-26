// Daily Discovery: one readable page, the same for everyone who may read it, for the whole campaign
// day, changing at the next. No stored state. The pick uses highest-random-weight hashing, so
// adding a page rarely changes today's pick and a small collection still gives a sensible answer.

/** FNV-1a with a murmur3 finaliser, 32-bit. Stable across platforms. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Final avalanche (murmur3 finaliser): similar strings must not give similar scores.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Today's pick from the ids the reader may read, or null when there are none. */
export function pickDaily(ids: readonly string[], day: string): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const id of ids) {
    const score = hash32(`${day}|${id}`);
    if (score > bestScore || (score === bestScore && best !== null && id < best)) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}
