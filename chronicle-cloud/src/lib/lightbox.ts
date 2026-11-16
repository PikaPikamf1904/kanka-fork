// Pure helpers behind the picture viewer: ordering, stepping and swipe detection. Kept free of
// React and the DOM so they can be unit-tested directly.

/** Minimum horizontal travel, in CSS pixels, for a touch drag to count as a swipe. */
export const SWIPE_THRESHOLD = 40;

/** Sort entries by where their node sits in the document (the order a reader sees them). */
export function orderByDocument<T extends { el: Node }>(entries: Iterable<T>, compare: (a: Node, b: Node) => number = compareDocumentOrder): T[] {
  return [...entries].sort((a, b) => compare(a.el, b.el));
}

/** Negative when `a` comes before `b` in the document. */
export function compareDocumentOrder(a: Node, b: Node): number {
  if (a === b) return 0;
  const pos = a.compareDocumentPosition(b);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

/** The index after moving `delta` places from `index` in a ring of `count` pictures. */
export function stepIndex(index: number, count: number, delta: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/** +1 (next) for a leftward swipe, -1 (previous) for a rightward one, 0 for a tap, a short drag or a mostly vertical one. */
export function swipeDelta(dx: number, dy: number, threshold = SWIPE_THRESHOLD): -1 | 0 | 1 {
  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

export function positionLabel(index: number, count: number): string {
  return `${index + 1} of ${count}`;
}
