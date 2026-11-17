import { describe, expect, it } from 'vitest';
import {
  addSaved, clearHistory, excerpt, highlightSegments, historyKey, loadHistory, loadSaved, parseHistory, parseSaved, pushHistory, queryTerms, recordSearch,
  removeSaved, savedKey, storeSaved,
} from './searchHistory.ts';

const mem = () => {
  const d = new Map<string, string>();
  return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v), removeItem: (k: string) => void d.delete(k) };
};

describe('history', () => {
  it('keeps the newest ten without repeats', () => {
    expect(pushHistory(['b', 'a'], ' A  ')).toEqual(['A', 'b']);
    let l: string[] = [];
    for (let i = 0; i < 15; i++) l = pushHistory(l, `q${i}`);
    expect(l).toHaveLength(10);
    expect(l[0]).toBe('q14');
    expect(pushHistory(['a'], '   ')).toEqual(['a']);
  });
  it('is stored per person and can be cleared', () => {
    const s = mem();
    recordSearch('u1', 'harbour', s);
    recordSearch('u1', 'captain', s);
    recordSearch('u2', 'secret', s);
    expect(loadHistory('u1', s)).toEqual(['captain', 'harbour']);
    expect(loadHistory('u2', s)).toEqual(['secret']);
    expect(historyKey('u1')).toBe('chronicle-search-history:u1');
    clearHistory('u1', s);
    expect(loadHistory('u1', s)).toEqual([]);
    expect(loadHistory('u2', s)).toHaveLength(1);
  });
  it('ignores damaged storage and storage that throws', () => {
    expect(parseHistory('nope')).toEqual([]);
    expect(parseHistory('{"a":1}')).toEqual([]);
    expect(parseHistory('["a",3,"", "b"]')).toEqual(['a', 'b']);
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(loadHistory('u', broken)).toEqual([]);
    expect(() => recordSearch('u', 'a', broken)).not.toThrow();
    expect(() => clearHistory('u', broken)).not.toThrow();
  });
});

describe('saved searches', () => {
  it('adds, replaces by name, removes, and falls back to the query as a name', () => {
    let l = addSaved([], 'Ports', 'type:location harbour');
    l = addSaved(l, '', 'captain');
    l = addSaved(l, 'ports', 'type:location port');
    expect(l).toEqual([{ name: 'captain', query: 'captain' }, { name: 'ports', query: 'type:location port' }]);
    expect(removeSaved(l, 'captain')).toEqual([{ name: 'ports', query: 'type:location port' }]);
    expect(addSaved(l, 'x', '  ')).toBe(l);
  });
  it('is stored per person', () => {
    const s = mem();
    storeSaved('u1', [{ name: 'a', query: 'b' }], s);
    expect(loadSaved('u1', s)).toEqual([{ name: 'a', query: 'b' }]);
    expect(loadSaved('u2', s)).toEqual([]);
    expect(savedKey('u1')).toBe('chronicle-saved-searches:u1');
    expect(parseSaved('[{"name":"a"},{"name":"b","query":"c","x":1}]')).toEqual([{ name: 'b', query: 'c' }]);
  });
});

describe('highlighting', () => {
  it('takes plain words out of a query', () => {
    expect(queryTerms('"red hand" -dragon type:character harbour or port')).toEqual(['red', 'hand', 'harbour', 'port']);
    expect(queryTerms('a')).toEqual([]);
  });
  it('marks matches without changing the text', () => {
    const segs = highlightSegments('The Harbour master met the harbour guard.', ['harbour']);
    expect(segs.map((s) => s.text).join('')).toBe('The Harbour master met the harbour guard.');
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(['Harbour', 'harbour']);
    expect(highlightSegments('plain', [])).toEqual([{ text: 'plain', hit: false }]);
    expect(highlightSegments('a.b (c)', ['(c)']).filter((s) => s.hit).map((s) => s.text)).toEqual(['(c)']);
  });
  it('takes a window of text around the first match', () => {
    const long = `${'x '.repeat(200)}needle ${'y '.repeat(200)}`;
    const e = excerpt(long, ['needle'], 120);
    expect(e).toContain('needle');
    expect(e.length).toBeLessThan(140);
    expect(excerpt('short text', ['short'])).toBe('short text');
  });
});
