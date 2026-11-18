import { describe, expect, it } from 'vitest';
import { focusMarker, mapChipHref, mapChips, placeChips, type PlaceRelationRow } from './placeChips.ts';

const loc = (id: string, title: string) => ({ id, slug: title.toLowerCase(), title, type: 'location' as const });
const person = { id: 'p', slug: 'p', title: 'P', type: 'character' as const };
const rel = (s: string, t: string, source: PlaceRelationRow['source'], target: PlaceRelationRow['target'], kind = 'resides_in'): PlaceRelationRow => ({ kind, source_article_id: s, target_article_id: t, source, target });

describe('placeChips', () => {
  it('takes locations from both directions, once each, sorted', () => {
    const rows = [
      rel('a', 'z', person, loc('z', 'Zed')),
      rel('b', 'a', loc('b', 'Bay'), person, 'controls'),
      rel('a', 'z', person, loc('z', 'Zed'), 'owns'),
    ];
    expect(placeChips('a', rows).map((c) => c.title)).toEqual(['Bay', 'Zed']);
  });
  it('ignores non-locations, unreadable (null) ends and itself', () => {
    expect(placeChips('a', [rel('a', 'p', person, person), rel('a', 'x', person, null), rel('a', 'a', loc('a', 'Self'), loc('a', 'Self'))])).toEqual([]);
  });
  it('caps the number of chips', () => {
    const rows = Array.from({ length: 20 }, (_, i) => rel('a', `l${i}`, person, loc(`l${i}`, `Loc ${String(i).padStart(2, '0')}`)));
    expect(placeChips('a', rows)).toHaveLength(8);
  });
});

describe('mapChips', () => {
  const places = [{ id: 'l1', slug: 'harbour', title: 'Harbour', kind: 'resides_in' }];
  it('links a marker to its pin and a bare map to the map; a marker wins over the map', () => {
    const chips = mapChips('a', 'Self', places,
      [{ id: 'm1', article_id: 'l1', map: { slug: 'coast', title: 'Coast' } }],
      [{ slug: 'coast', title: 'Coast', article_id: 'l1' }, { slug: 'town', title: 'Town', article_id: 'a' }]);
    expect(chips.map((c) => [c.mapSlug, c.markerId, c.placeTitle])).toEqual([['town', null, 'Self'], ['coast', 'm1', 'Harbour']]);
    expect(mapChipHref(chips[1]!)).toBe('/maps/coast?marker=m1');
    expect(mapChipHref(chips[0]!)).toBe('/maps/town');
  });
  it('ignores markers and maps of other pages, and markers without a readable map', () => {
    expect(mapChips('a', 'Self', places, [{ id: 'm', article_id: 'other', map: { slug: 's', title: 'S' } }, { id: 'n', article_id: 'l1', map: null }], [{ slug: 'x', title: 'X', article_id: null }])).toEqual([]);
  });
});

describe('focusMarker', () => {
  const ms = [{ id: '1', article: { slug: 'a' } }, { id: '2', article: null }, { id: '3', article: { slug: 'b' } }];
  it('finds by id, then by page address; unknown gives null', () => {
    expect(focusMarker(ms, { marker: '2' })?.id).toBe('2');
    expect(focusMarker(ms, { focus: 'b' })?.id).toBe('3');
    expect(focusMarker(ms, { marker: 'nope', focus: 'a' })).toBeNull();
    expect(focusMarker(ms, {})).toBeNull();
  });
});
