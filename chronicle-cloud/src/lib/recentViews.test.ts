import { describe, expect, it } from 'vitest';
import { clearRecentViews, loadRecentViews, parseRecent, pushRecent, recentViewsKey, recordRecentView, RECENT_VIEWS_MAX } from './recentViews.ts';

const mem = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
};
const v = (n: number) => ({ id: `id-${n}`, slug: `page-${n}`, title: `Page ${n}` });

describe('recent views', () => {
  it('puts the latest first and moves a repeat view to the front', () => {
    expect(pushRecent([v(1), v(2)], v(2)).map((x) => x.id)).toEqual(['id-2', 'id-1']);
    expect(pushRecent([v(1)], v(3)).map((x) => x.id)).toEqual(['id-3', 'id-1']);
  });
  it('keeps at most 20', () => {
    let list: ReturnType<typeof v>[] = [];
    for (let i = 0; i < 30; i++) list = pushRecent(list, v(i));
    expect(list).toHaveLength(RECENT_VIEWS_MAX);
    expect(list[0]!.id).toBe('id-29');
  });
  it('ignores anything stored that is not a list of views', () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('not json')).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent(JSON.stringify([v(1), { id: 3 }, 'x', { id: 'a', slug: 'b', title: 'c', extra: 1 }]))).toEqual([v(1), { id: 'a', slug: 'b', title: 'c' }]);
  });
  it('is kept per signed-in user, and cleared on request', () => {
    const s = mem();
    recordRecentView('user-a', v(1), s);
    recordRecentView('user-a', v(2), s);
    recordRecentView('user-b', v(9), s);
    expect(loadRecentViews('user-a', s).map((x) => x.id)).toEqual(['id-2', 'id-1']);
    expect(loadRecentViews('user-b', s).map((x) => x.id)).toEqual(['id-9']);
    expect(recentViewsKey('user-a')).toBe('chronicle-recent-views:user-a');
    clearRecentViews('user-a', s);
    expect(loadRecentViews('user-a', s)).toEqual([]);
    expect(loadRecentViews('user-b', s)).toHaveLength(1);
  });
  it('survives storage that throws', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(() => recordRecentView('u', v(1), broken)).not.toThrow();
    expect(loadRecentViews('u', broken)).toEqual([]);
    expect(() => clearRecentViews('u', broken)).not.toThrow();
  });
});
