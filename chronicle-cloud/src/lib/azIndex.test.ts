import { describe, expect, it } from 'vitest';
import { defaultLetter, firstLetter, indexSearch, lettersWithEntries, likeLiteral, parseIndexParams, snippet } from './azIndex.ts';

describe('firstLetter', () => {
  it('files by English letter, any case; the rest (digits, accents, a leading space) under #', () => {
    expect(firstLetter('apple')).toBe('A');
    expect(firstLetter('zed')).toBe('Z');
    expect(firstLetter(' Zed')).toBe('#');
    expect(firstLetter('3 Coins')).toBe('#');
    expect(firstLetter('Élan')).toBe('#');
    expect(firstLetter('')).toBe('#');
  });
});

describe('lettersWithEntries / defaultLetter', () => {
  it('collects letters and picks the first in order, # last', () => {
    const s = lettersWithEntries(['Beta', 'beta two', '7 Seas', 'Alpha']);
    expect([...s].sort()).toEqual(['#', 'A', 'B']);
    expect(defaultLetter(s)).toBe('A');
    expect(defaultLetter(new Set(['#']))).toBe('#');
    expect(defaultLetter(new Set())).toBeNull();
  });
});

describe('index address', () => {
  const types = ['character', 'location'];
  it('parses and validates', () => {
    expect(parseIndexParams(new URLSearchParams('letter=b&type=character&q=hi'), types)).toEqual({ letter: 'B', type: 'character', q: 'hi' });
    expect(parseIndexParams(new URLSearchParams('letter=%23&type=wizard&q='), types)).toEqual({ letter: '#', type: null, q: '' });
    expect(parseIndexParams(new URLSearchParams('letter=BB'), types).letter).toBeNull();
  });
  it('writes only what is set, and round-trips', () => {
    expect(indexSearch({})).toBe('');
    expect(indexSearch({ letter: '#', type: 'location', q: ' x y ' })).toBe('?letter=%23&type=location&q=x+y');
    expect(parseIndexParams(new URLSearchParams(indexSearch({ letter: '#', q: 'x y' })), types)).toMatchObject({ letter: '#', q: 'x y' });
  });
});

describe('likeLiteral / snippet', () => {
  it('escapes wildcards', () => {
    expect(likeLiteral('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
  it('strips markup and cuts at a word', () => {
    expect(snippet('A [[Harbour|port]] of **old** [ships](x).')).toBe('A port of old ships.');
    const long = `${'word '.repeat(60)}`;
    const s = snippet(long, 50);
    expect(s.endsWith('…')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(51);
  });
});
