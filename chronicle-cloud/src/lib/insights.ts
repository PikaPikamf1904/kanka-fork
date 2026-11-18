// DM Player Insights: storytelling opportunities gathered from Character Journals and the party's
// board theories. Pure functions, so the rules are testable. Everything here is the players' own
// writing and speculation; nothing is treated or shown as established fact. Private scratchpads,
// saved pages, private research and feedback are never inputs.

export interface InsightEntry {
  id: string;
  user_id: string;
  title: string;
  body: string;
  entry_date: string;
  tags: string[];
  article_ids: string[];
}

export interface InsightTheory {
  id: string;
  title: string;
  body: string;
  theory_status: string | null;
  author_name: string;
  updated_at: string;
}

export interface PageInfo { id: string; slug: string; title: string; type: string }

export interface Insights {
  byTag: Record<'goal' | 'question' | 'suspicion' | 'theory', (InsightEntry & { player: string })[]>;
  mentionedPages: { page: PageInfo; count: number; players: string[]; lastDate: string }[];
  frequentCharacters: { page: PageInfo; count: number; players: string[]; lastDate: string }[];
  recentPlaces: { page: PageInfo; count: number; players: string[]; lastDate: string }[];
  openTheories: InsightTheory[];
  activity: { player: string; entries: number; last: string | null; last30: number }[];
}

const TAGS = ['goal', 'question', 'suspicion', 'theory'] as const;

export function buildInsights(
  entries: InsightEntry[],
  theories: InsightTheory[],
  players: { user_id: string; display_name: string }[],
  pages: PageInfo[],
  today: string,
): Insights {
  const name = new Map(players.map((p) => [p.user_id, p.display_name]));
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const sorted = [...entries].sort((a, b) => b.entry_date.localeCompare(a.entry_date) || a.id.localeCompare(b.id));
  const withPlayer = sorted.map((e) => ({ ...e, player: name.get(e.user_id) ?? 'A former player' }));

  const byTag = Object.fromEntries(TAGS.map((t) => [t, withPlayer.filter((e) => e.tags.includes(t))])) as Insights['byTag'];

  const counts = new Map<string, { count: number; players: Set<string>; lastDate: string }>();
  for (const e of withPlayer) {
    for (const id of new Set(e.article_ids)) {
      if (!pageById.has(id)) continue;
      const c = counts.get(id) ?? { count: 0, players: new Set<string>(), lastDate: '' };
      c.count++;
      c.players.add(e.player);
      if (e.entry_date > c.lastDate) c.lastDate = e.entry_date;
      counts.set(id, c);
    }
  }
  const mentioned = [...counts.entries()]
    .map(([id, c]) => ({ page: pageById.get(id)!, count: c.count, players: [...c.players].sort(), lastDate: c.lastDate }))
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate) || a.page.title.localeCompare(b.page.title));

  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
  const activity = players.map((p) => {
    const mine = withPlayer.filter((e) => e.user_id === p.user_id);
    return { player: p.display_name, entries: mine.length, last: mine[0]?.entry_date ?? null, last30: mine.filter((e) => e.entry_date >= cutoff).length };
  }).sort((a, b) => b.entries - a.entries || a.player.localeCompare(b.player));

  return {
    byTag,
    mentionedPages: mentioned.slice(0, 30),
    frequentCharacters: mentioned.filter((m) => m.page.type === 'character').slice(0, 15),
    recentPlaces: mentioned.filter((m) => m.page.type === 'location').sort((a, b) => b.lastDate.localeCompare(a.lastDate)).slice(0, 15),
    openTheories: theories.filter((t) => t.theory_status === 'unresolved').sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    activity,
  };
}
