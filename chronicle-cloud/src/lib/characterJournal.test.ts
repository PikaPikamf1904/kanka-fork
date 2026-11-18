import { describe, expect, it } from 'vitest';
import { dayLabel, filterEntries, groupByMonth, localDate, monthLabel, sortEntries, tagLabel } from './characterJournal.ts';

const e = (id: string, entry_date: string, created_at = '2026-01-01T00:00:00Z', title = id, body = '', tags: string[] = []) => ({ id, entry_date, created_at, title, body, tags });

describe('journal dates', () => {
  it('labels months and days without a time zone', () => {
    expect(monthLabel('2026-11-03')).toBe('November 2026');
    expect(dayLabel('2026-01-31')).toBe('31 January 2026');
    expect(monthLabel('nonsense')).toBe('nonsense');
    expect(dayLabel('2026-13-01')).toBe('2026-13-01');
  });
  it('formats the local calendar day', () => {
    expect(localDate(new Date(2026, 10, 3, 23, 59))).toBe('2026-11-03');
    expect(localDate(new Date(2026, 0, 9, 0, 0))).toBe('2026-01-09');
  });
});

describe('sortEntries and groupByMonth', () => {
  it('puts the newest entry date first, then the newest written', () => {
    const sorted = sortEntries([e('a', '2026-10-30'), e('b', '2026-11-02', '2026-11-02T08:00:00Z'), e('c', '2026-11-02', '2026-11-02T09:00:00Z')]);
    expect(sorted.map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
  it('groups by month of the entry date, newest month first', () => {
    const groups = groupByMonth([e('a', '2026-10-30'), e('b', '2026-11-02'), e('c', '2026-11-30'), e('d', '2025-12-31')]);
    expect(groups.map((g) => [g.key, g.label, g.entries.map((x) => x.id)])).toEqual([
      ['2026-11', 'November 2026', ['c', 'b']],
      ['2026-10', 'October 2026', ['a']],
      ['2025-12', 'December 2025', ['d']],
    ]);
  });
  it('does not change the input and handles none', () => {
    const input = [e('a', '2026-01-01'), e('b', '2026-02-01')];
    groupByMonth(input);
    expect(input.map((x) => x.id)).toEqual(['a', 'b']);
    expect(groupByMonth([])).toEqual([]);
  });
});

describe('filterEntries', () => {
  const list = [
    e('1', '2026-11-01', 'x', 'The harbourmaster', 'He lied about the tide.', ['suspicion']),
    e('2', '2026-11-02', 'x', 'Find the key', 'Ask the smith.', ['goal', 'question']),
  ];
  it('matches every word in the title or text, ignoring case', () => {
    expect(filterEntries(list, 'TIDE lied', null).map((x) => x.title)).toEqual(['The harbourmaster']);
    expect(filterEntries(list, 'smith key', null).map((x) => x.title)).toEqual(['Find the key']);
    expect(filterEntries(list, 'tide smith', null)).toEqual([]);
    expect(filterEntries(list, '   ', null)).toHaveLength(2);
  });
  it('filters by tag, together with the words', () => {
    expect(filterEntries(list, '', 'goal').map((x) => x.title)).toEqual(['Find the key']);
    expect(filterEntries(list, 'tide', 'goal')).toEqual([]);
    expect(filterEntries(list, '', 'theory')).toEqual([]);
  });
  it('names tags in plain English', () => {
    expect(tagLabel('suspicion')).toBe('Suspicion');
    expect(tagLabel('other')).toBe('other');
  });
});
