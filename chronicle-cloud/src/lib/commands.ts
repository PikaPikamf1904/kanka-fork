// The command palette's list: site commands matched by a forgiving word-start / in-order search,
// merged with page suggestions from the server. Pure, unit-tested.

export interface PaletteCommand { id: string; label: string; to: string; keywords?: string; dmOnly?: boolean }
export interface PaletteItem { key: string; label: string; to: string; hint: string }

const norm = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** Score a label against a query: 3 = starts with it, 2 = a word starts with it, 1 = letters in order, 0 = no match. */
export function score(label: string, query: string): number {
  const l = norm(label);
  const q = norm(query.trim());
  if (!q) return 1;
  if (l.startsWith(q)) return 3;
  if (l.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) return 2;
  let i = 0;
  for (const c of l) if (c === q[i]) i++;
  return i === q.length ? 1 : 0;
}

export function paletteItems(query: string, commands: PaletteCommand[], pages: { slug: string; title: string; typeLabel: string }[], isDm: boolean, max = 12): PaletteItem[] {
  const cmd = commands
    .filter((c) => isDm || !c.dmOnly)
    .map((c) => ({ c, s: Math.max(score(c.label, query), c.keywords ? Math.min(2, score(c.keywords, query)) : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.c.label.localeCompare(b.c.label))
    .map(({ c }) => ({ key: `cmd:${c.id}`, label: c.label, to: c.to, hint: c.dmOnly ? 'DM' : 'Go to' }));
  const pg = pages.map((p) => ({ key: `page:${p.slug}`, label: p.title, to: `/wiki/${p.slug}`, hint: p.typeLabel }));
  // With a query, pages first (that is usually what is wanted); without one, the commands.
  const merged = query.trim() ? [...pg, ...cmd] : cmd;
  const seen = new Set<string>();
  return merged.filter((i) => !seen.has(i.to) && seen.add(i.to)).slice(0, max);
}
