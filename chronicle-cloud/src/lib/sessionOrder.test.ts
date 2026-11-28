import { describe, expect, it } from 'vitest';
import { compareSessions, orderIsKnown, parsePlayDate, parseSessionNumber, sessionKeys, sortSessions } from './sessionOrder.ts';

const s = (title: string, extra: Partial<{ session_date: string | null; infobox: { label: string; value: string }[]; slug: string }> = {}) => ({ title, ...extra });
const titles = (list: { title: string }[]) => list.map((x) => x.title);

describe('parsePlayDate', () => {
  it('reads ISO and written dates', () => {
    expect(parsePlayDate('2026-11-10')).toBe('2026-11-10');
    expect(parsePlayDate('2026-1-5')).toBe('2026-01-05');
    expect(parsePlayDate('November 10, 2026')).toBe('2026-11-10');
    expect(parsePlayDate('10 Nov 2026')).toBe('2026-11-10');
    expect(parsePlayDate('10th of November, 2026')).toBe('2026-11-10');
    expect(parsePlayDate('Sept. 3 2026')).toBe('2026-09-03');
  });
  it('rejects anything that is not a date', () => {
    for (const bad of ['', '  ', 'Session 3', 'Foo 3 2026', 'February 30, 2026', '2026-13-01', 'Tuesday', '3/4/2026', 'Marchy 3 2026', null, undefined]) {
      expect(parsePlayDate(bad as never)).toBeNull();
    }
  });
});

describe('parseSessionNumber', () => {
  it('accepts whole numbers only', () => {
    expect(parseSessionNumber('3')).toBe(3);
    expect(parseSessionNumber(' #12 ')).toBe(12);
    expect(parseSessionNumber('Session 4')).toBe(4);
    expect(parseSessionNumber('3.5')).toBeNull();
    expect(parseSessionNumber('three')).toBeNull();
    expect(parseSessionNumber('Session 3: Bridge')).toBeNull();
    expect(parseSessionNumber(null)).toBeNull();
  });
});

describe('sessionKeys', () => {
  it('prefers the session_date column over the infobox', () => {
    expect(sessionKeys(s('A', { session_date: '2026-01-02', infobox: [{ label: 'Date played', value: 'March 3, 2026' }] })).date).toBe('2026-01-02');
  });
  it('reads the infobox labels, ignoring unparsable values and other labels', () => {
    const k = sessionKeys(s('A', { infobox: [{ label: 'In-game date', value: '5 Mirthul' }, { label: 'Date', value: 'soon' }, { label: ' Date played ', value: 'November 10, 2026' }, { label: 'Session', value: '4' }] }));
    expect(k).toEqual({ date: '2026-11-10', number: 4 });
  });
  it('ignores an unparsable column value and falls back', () => {
    expect(sessionKeys(s('A', { session_date: 'garbage', infobox: [{ label: 'Played', value: '2026-02-03' }] })).date).toBe('2026-02-03');
  });
});

describe('ordering', () => {
  it('sorts by date, then number, then title', () => {
    const list = [
      s('C', { session_date: '2026-03-01' }),
      s('A', { infobox: [{ label: 'Date played', value: 'January 5, 2026' }] }),
      s('B', { session_date: '2026-03-01', infobox: [{ label: 'Session', value: '1' }] }),
      s('D', { session_date: '2026-03-01', infobox: [{ label: 'Session', value: '2' }] }),
    ];
    expect(titles(sortSessions(list))).toEqual(['A', 'B', 'D', 'C']);
  });
  it('orders numbered sessions numerically, not as text', () => {
    const list = ['10', '2', '1'].map((n) => s(`S${n}`, { infobox: [{ label: 'Session number', value: n }] }));
    expect(titles(sortSessions(list))).toEqual(['S1', 'S2', 'S10']);
  });
  it('puts unkeyed sessions first (in title order) so a keyed one is never hidden behind them', () => {
    const list = [s('Z', { session_date: '2026-01-01' }), s('b'), s('a'), s('N', { infobox: [{ label: 'Session', value: '1' }] })];
    expect(titles(sortSessions(list))).toEqual(['a', 'b', 'N', 'Z']);
  });
  it('uses title with numeric awareness, then slug, as the stable fallback', () => {
    expect(titles(sortSessions([s('Part 10'), s('Part 2')]))).toEqual(['Part 2', 'Part 10']);
    expect(sortSessions([s('Same', { slug: 'b' }), s('Same', { slug: 'a' })]).map((x) => x.slug)).toEqual(['a', 'b']);
  });
  it('is deterministic whatever the input order, does not mutate, and is antisymmetric', () => {
    const list = [s('x'), s('y', { session_date: '2026-01-01' }), s('z', { infobox: [{ label: 'Session', value: '3' }] })];
    const copy = [...list];
    const a = titles(sortSessions(list));
    expect(titles(sortSessions([...list].reverse()))).toEqual(a);
    expect(list).toEqual(copy);
    expect(Math.sign(compareSessions(list[0]!, list[1]!))).toBe(-Math.sign(compareSessions(list[1]!, list[0]!)));
  });
  it('handles null and missing infobox', () => {
    expect(titles(sortSessions([s('b', { infobox: undefined, session_date: null }), s('a')]))).toEqual(['a', 'b']);
  });
});

describe('orderIsKnown', () => {
  it('is true for none or one session', () => {
    expect(orderIsKnown([])).toBe(true);
    expect(orderIsKnown([s('A')])).toBe(true);
  });
  it('needs every session to have a date or a number', () => {
    expect(orderIsKnown([s('A', { session_date: '2026-01-01' }), s('B', { infobox: [{ label: 'Session', value: '2' }] })])).toBe(true);
    expect(orderIsKnown([s('A', { session_date: '2026-01-01' }), s('B')])).toBe(false);
    expect(orderIsKnown([s('A'), s('B')])).toBe(false);
    expect(orderIsKnown([s('A', { session_date: 'garbage' }), s('B', { session_date: '2026-01-01' })])).toBe(false);
  });
});
