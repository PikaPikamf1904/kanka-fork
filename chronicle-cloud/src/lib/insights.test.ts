import { describe, expect, it } from 'vitest';
import { buildInsights, type InsightEntry } from './insights.ts';

const e = (id: string, user: string, date: string, tags: string[], pages: string[] = []): InsightEntry => ({
  id, user_id: user, title: `Entry ${id}`, body: '', entry_date: date, tags, article_ids: pages,
});
const players = [{ user_id: 'u1', display_name: 'Eliza' }, { user_id: 'u2', display_name: 'Sybil' }, { user_id: 'u3', display_name: 'Weston' }];
const pages = [
  { id: 'p1', slug: 'captain', title: 'The Captain', type: 'character' },
  { id: 'p2', slug: 'port', title: 'Port Vellmoor', type: 'location' },
];

describe('buildInsights', () => {
  const insights = buildInsights(
    [
      e('a', 'u1', '2026-11-10', ['goal', 'suspicion'], ['p1', 'p1']),
      e('b', 'u2', '2026-11-12', ['question'], ['p1', 'p2']),
      e('c', 'u1', '2026-09-01', ['theory'], ['p2', 'gone']),
    ],
    [
      { id: 't1', title: 'The steel goes north', body: '', theory_status: 'unresolved', author_name: 'Sybil', updated_at: '2026-11-11' },
      { id: 't2', title: 'Solved one', body: '', theory_status: 'solved', author_name: 'Eliza', updated_at: '2026-11-12' },
    ],
    players, pages, '2026-11-17',
  );

  it('groups entries by tag with the player\'s name, newest first', () => {
    expect(insights.byTag.goal.map((x) => [x.id, x.player])).toEqual([['a', 'Eliza']]);
    expect(insights.byTag.question.map((x) => x.player)).toEqual(['Sybil']);
    expect(insights.byTag.theory).toHaveLength(1);
  });

  it('counts each page once per entry, ignores pages the DM did not receive, and splits characters and places', () => {
    expect(insights.mentionedPages.map((m) => [m.page.slug, m.count, m.players])).toEqual([
      ['port', 2, ['Eliza', 'Sybil']],
      ['captain', 2, ['Eliza', 'Sybil']],
    ]);
    expect(insights.frequentCharacters.map((m) => m.page.slug)).toEqual(['captain']);
    expect(insights.recentPlaces.map((m) => [m.page.slug, m.lastDate])).toEqual([['port', '2026-11-12']]);
  });

  it('lists only unresolved theories and per-player activity, including quiet players', () => {
    expect(insights.openTheories.map((t) => t.id)).toEqual(['t1']);
    expect(insights.activity).toEqual([
      { player: 'Eliza', entries: 2, last: '2026-11-10', last30: 1 },
      { player: 'Sybil', entries: 1, last: '2026-11-12', last30: 1 },
      { player: 'Weston', entries: 0, last: null, last30: 0 },
    ]);
  });
});
