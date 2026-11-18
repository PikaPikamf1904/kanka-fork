import { describe, expect, it } from 'vitest';
import { fromLocalInput, isReleased, mysteryShowsClues, pendingReleases, releaseState, releaseText, sortClues, toLocalInput } from './clues.ts';

const now = new Date('2026-11-17T12:00:00Z');
describe('release state', () => {
  it('released by hand wins, a past time releases, a future time is scheduled, nothing is hidden', () => {
    expect(releaseState({ released_at: '2026-11-01T00:00:00Z', release_at: '2030-01-01T00:00:00Z' }, now)).toBe('released');
    expect(releaseState({ released_at: null, release_at: '2026-11-17T11:59:00Z' }, now)).toBe('released');
    expect(releaseState({ released_at: null, release_at: '2026-11-17T12:01:00Z' }, now)).toBe('scheduled');
    expect(releaseState({ released_at: null, release_at: null }, now)).toBe('hidden');
    expect(isReleased({ released_at: null, release_at: null }, now)).toBe(false);
  });
  it('lists pending releases soonest first', () => {
    const items = [
      { id: 'b', released_at: null, release_at: '2026-12-01T00:00:00Z' },
      { id: 'a', released_at: null, release_at: '2026-11-20T00:00:00Z' },
      { id: 'c', released_at: '2026-11-01T00:00:00Z', release_at: null },
    ];
    expect(pendingReleases(items, now).map((i) => i.id)).toEqual(['a', 'b']);
  });
  it('describes it in words', () => {
    expect(releaseText({ released_at: null, release_at: null }, now)).toBe('Not released');
    expect(releaseText({ released_at: 'x', release_at: null }, now)).toBe('Released');
    expect(releaseText({ released_at: null, release_at: '2026-12-01T09:30:00Z' }, now)).toMatch(/^Scheduled for /);
  });
});

describe('local time inputs', () => {
  it('round-trips a time', () => {
    const iso = '2026-12-01T09:30:00.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(toLocalInput(null)).toBe('');
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('nonsense')).toBeNull();
  });
});

describe('ordering and mystery state', () => {
  it('sorts by position then title', () => {
    expect(sortClues([{ position: 2, title: 'a' }, { position: 1, title: 'z' }, { position: 1, title: 'b' }]).map((c) => c.title)).toEqual(['b', 'z', 'a']);
  });
  it('only active or concluded mysteries show clues (a player gets no mystery row at all)', () => {
    expect([undefined, null, 'active', 'concluded'].every(mysteryShowsClues)).toBe(true);
    expect(['draft', 'archived'].some(mysteryShowsClues)).toBe(false);
  });
});
