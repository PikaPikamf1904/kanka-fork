import { describe, expect, it } from 'vitest';
import { breadcrumbTrail } from './breadcrumbs.ts';

const cats = [
  { slug: 'dm-secret', name: 'Aaa Secret', kind: 'category', visibility: 'dm' },
  { slug: 'tag-one', name: 'Aaa Tag', kind: 'tag', visibility: 'players' },
  { slug: 'sailors', name: 'Sailors', kind: 'category', visibility: 'players' },
];
describe('breadcrumbTrail', () => {
  it('goes Main page, kind, category, title', () => {
    expect(breadcrumbTrail({ type: 'character', title: 'Merrin', categories: cats }, false)).toEqual([
      { label: 'Main page', to: '/' }, { label: 'Characters', to: '/browse/character' }, { label: 'Sailors', to: '/category/sailors' }, { label: 'Merrin' },
    ]);
  });
  it('leaves out the category when there is none, and never offers a DM-only one to a player', () => {
    expect(breadcrumbTrail({ type: 'location', title: 'Port', categories: [] }, false).map((c) => c.label)).toEqual(['Main page', 'Locations', 'Port']);
    expect(breadcrumbTrail({ type: 'location', title: 'Port', categories: [cats[0]!] }, false).map((c) => c.label)).toEqual(['Main page', 'Locations', 'Port']);
    expect(breadcrumbTrail({ type: 'location', title: 'Port', categories: [cats[0]!] }, true).map((c) => c.label)).toEqual(['Main page', 'Locations', 'Aaa Secret', 'Port']);
  });
  it('only the last crumb has no link', () => {
    const t = breadcrumbTrail({ type: 'lore', title: 'X', categories: [] }, false);
    expect(t.slice(0, -1).every((c) => c.to)).toBe(true);
    expect(t.at(-1)!.to).toBeUndefined();
  });
});
