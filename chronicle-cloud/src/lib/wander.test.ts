import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearWanderHistory, loadRecent, pickWander, randomOffset, remember, saveRecent } from './wander.ts';

const slugs = ['a', 'b', 'c', 'd', 'e'];
const at = (n: number) => Promise.resolve(slugs[n] ?? null);
const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]!; };

describe('randomOffset', () => {
  it('stays inside the range, even for a random value of 1', () => {
    expect(randomOffset(5, () => 0)).toBe(0);
    expect(randomOffset(5, () => 0.999)).toBe(4);
    expect(randomOffset(5, () => 1)).toBe(4);
  });
});

describe('remember', () => {
  it('moves a repeat to the end and caps the list', () => {
    expect(remember(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']);
    expect(remember(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });
});

describe('pickWander', () => {
  it('returns null for an empty wiki', async () => {
    expect(await pickWander({ count: 0, at, recent: [] })).toBeNull();
  });
  it('returns the first roll when it is new', async () => {
    expect(await pickWander({ count: 5, at, recent: ['a'], random: seq(0.5) })).toBe('c');
  });
  it('re-rolls past recent pages', async () => {
    expect(await pickWander({ count: 5, at, recent: ['a', 'b'], random: seq(0, 0.2, 0.8) })).toBe('e');
  });
  it('never looks at the same offset twice and falls back to a non-latest repeat', async () => {
    const calls: number[] = [];
    const slug = await pickWander({ count: 3, at: (n) => { calls.push(n); return at(n); }, recent: ['a', 'b', 'c'], random: seq(0) });
    expect(new Set(calls).size).toBe(calls.length);
    expect(slug).not.toBe('c'); // c was visited last; the others are older repeats
    expect(slug).toBe('b');
  });
  it('with a single page it returns that page', async () => {
    expect(await pickWander({ count: 1, at, recent: ['a'], random: seq(0.5) })).toBe('a');
  });
  it('skips offsets that returned nothing (a page removed meanwhile)', async () => {
    expect(await pickWander({ count: 5, at: (n) => (n < 2 ? Promise.resolve(null) : at(n)), recent: [], random: seq(0, 0.2, 0.6) })).toBe('d');
  });
});

describe('recent storage', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  });
  it('round-trips, clears and tolerates garbage', () => {
    saveRecent(['a', 'b']);
    expect(loadRecent()).toEqual(['a', 'b']);
    clearWanderHistory();
    expect(loadRecent()).toEqual([]);
    sessionStorage.setItem('chronicle-wander-recent', '{oops');
    expect(loadRecent()).toEqual([]);
  });
});
