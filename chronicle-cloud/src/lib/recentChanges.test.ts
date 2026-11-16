import { describe, expect, it } from 'vitest';
import { groupByDay, recentChanges, type RecentPage } from './recentChanges.ts';

const page = (id: string, published_at: string | null, type: RecentPage['type'] = 'location'): RecentPage => ({ id, slug: id, title: id.toUpperCase(), type, summary: '', published_at });

describe('recentChanges', () => {
  it('orders pages by their latest visible change and lists changed headings', () => {
    const r = recentChanges(
      [page('a', '2026-11-01T10:00:00Z'), page('b', '2026-11-10T10:00:00Z'), page('n', '2026-11-12T10:00:00Z', 'news')],
      [
        { article_id: 'a', heading: 'History', updated_at: '2026-11-14T09:00:00Z' },
        { article_id: 'a', heading: '[00:12:03] Notes', updated_at: '2026-11-13T09:00:00Z' },
        { article_id: 'b', heading: 'Overview', updated_at: '2026-11-10T10:00:20Z' },
        { article_id: 'n', heading: 'Story', updated_at: '2026-11-15T09:00:00Z' },
      ],
    );
    expect(r.map((e) => e.page.id)).toEqual(['a', 'b']);
    expect(r[0]).toMatchObject({ isNew: false, headings: ['History', 'Notes'], at: '2026-11-14T09:00:00Z' });
    // Sections written with the page when it was published: still a new page.
    expect(r[1]).toMatchObject({ isNew: true });
  });

  it('ignores sections of pages it was not given (the reader cannot read them)', () => {
    expect(recentChanges([page('a', null)], [{ article_id: 'hidden', heading: 'Secret', updated_at: '2026-11-14T09:00:00Z' }])).toEqual([]);
  });

  it('groups by day with Today and Yesterday', () => {
    const r = recentChanges([page('a', '2026-11-16T08:00:00'), page('b', '2026-11-15T08:00:00'), page('c', '2026-11-01T08:00:00')], []);
    const days = groupByDay(r, new Date('2026-11-16T12:00:00'), () => 'Earlier');
    expect(days.map((d) => [d.day, d.entries.length])).toEqual([['Today', 1], ['Yesterday', 1], ['Earlier', 1]]);
  });
});
