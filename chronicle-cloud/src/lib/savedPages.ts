// Pure helpers for reordering saved pages.

/** Move the item at `index` up (-1) or down (+1). Returns the same order when it cannot move. */
export function moveItem<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Move the item `fromId` to the place of `toId` (drag and drop). */
export function moveBefore<T extends { id: string }>(items: T[], fromId: string, toId: string): T[] {
  const from = items.findIndex((i) => i.id === fromId);
  const to = items.findIndex((i) => i.id === toId);
  if (from < 0 || to < 0 || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
