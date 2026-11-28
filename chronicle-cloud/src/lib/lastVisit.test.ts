import { describe, expect, it } from 'vitest';
import { isNewSince, nextVisits, parseVisits, touchVisit, VISIT_GAP_MS } from './lastVisit.ts';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

describe('last visit', () => {
  it('the first visit marks nothing', () => {
    const s = memory();
    expect(touchVisit('u1', new Date('2026-12-01T10:00:00Z'), s)).toBeNull();
  });
  it('reading around within the gap keeps the same previous visit', () => {
    const s = memory();
    touchVisit('u1', new Date('2026-12-01T10:00:00Z'), s);
    const later = new Date(Date.parse('2026-12-03T09:00:00Z'));
    expect(touchVisit('u1', later, s)).toBe('2026-12-01T10:00:00.000Z');
    // An hour later, still the same visit: the marks do not disappear.
    expect(touchVisit('u1', new Date(later.getTime() + 60 * 60 * 1000), s)).toBe('2026-12-01T10:00:00.000Z');
    // After a long gap, the visit that began on the 3rd becomes the previous one.
    expect(touchVisit('u1', new Date(later.getTime() + VISIT_GAP_MS + 1), s)).toBe('2026-12-03T09:00:00.000Z');
  });
  it('keeps people sharing a device apart', () => {
    const s = memory();
    touchVisit('a', new Date('2026-12-01T10:00:00Z'), s);
    expect(touchVisit('b', new Date('2026-12-05T10:00:00Z'), s)).toBeNull();
  });
  it('survives broken or blocked storage', () => {
    expect(parseVisits('not json')).toBeNull();
    expect(parseVisits('{"current":"nonsense"}')).toBeNull();
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(touchVisit('u', new Date(), broken)).toBeNull();
    expect(nextVisits(null, new Date('2026-12-01T00:00:00Z')).previous).toBeNull();
  });
  it('a page is new only when first published after the previous visit began', () => {
    expect(isNewSince('2026-12-02T00:00:00Z', '2026-12-01T00:00:00Z')).toBe(true);
    expect(isNewSince('2026-11-30T00:00:00Z', '2026-12-01T00:00:00Z')).toBe(false);
    expect(isNewSince(null, '2026-12-01T00:00:00Z')).toBe(false);
    expect(isNewSince('2026-12-02T00:00:00Z', null)).toBe(false);
  });
});
