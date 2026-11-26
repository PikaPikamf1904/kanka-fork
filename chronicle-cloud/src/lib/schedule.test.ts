import { describe, expect, it } from 'vitest';
import { campaignDay, formatInZone, safeZone, utcToZoned, zonedToUtc } from './schedule.ts';
import { hash32, pickDaily } from './discovery.ts';

describe('campaign time zone', () => {
  it('reads wall-clock time in the campaign zone (winter and summer)', () => {
    expect(zonedToUtc('2026-12-01T09:00', 'America/Chicago')!.toISOString()).toBe('2026-12-01T15:00:00.000Z');
    expect(zonedToUtc('2026-07-01T09:00', 'America/Chicago')!.toISOString()).toBe('2026-07-01T14:00:00.000Z');
    expect(zonedToUtc('2026-12-01T09:00', 'Europe/London')!.toISOString()).toBe('2026-12-01T09:00:00.000Z');
    expect(zonedToUtc('2026-07-01T09:00', 'Europe/London')!.toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtc('2026-07-01T09:00', 'Australia/Sydney')!.toISOString()).toBe('2026-06-30T23:00:00.000Z');
    expect(zonedToUtc('2026-07-01T09:00', 'UTC')!.toISOString()).toBe('2026-07-01T09:00:00.000Z');
  });
  it('handles the daylight-saving gap and overlap', () => {
    // US spring forward 2026-03-08: 02:30 does not exist in Chicago; it moves forward to 03:30 CDT.
    expect(zonedToUtc('2026-03-08T02:30', 'America/Chicago')!.toISOString()).toBe('2026-03-08T08:30:00.000Z');
    // Autumn 2026-11-01: 01:30 happens twice; the earlier one (CDT, 06:30Z).
    expect(zonedToUtc('2026-11-01T01:30', 'America/Chicago')!.toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });
  it('round-trips and rejects nonsense', () => {
    const d = zonedToUtc('2026-12-24T18:45', 'Asia/Kolkata')!;
    expect(utcToZoned(d.toISOString(), 'Asia/Kolkata')).toBe('2026-12-24T18:45');
    expect(zonedToUtc('tomorrow', 'UTC')).toBeNull();
    expect(zonedToUtc('2026-13-40T99:99', 'UTC')).toBeNull();
    expect(safeZone('Not/AZone')).toBe('UTC');
    expect(safeZone(null)).toBe('UTC');
  });
  it('the campaign day changes at local midnight, not the device clock', () => {
    const t = new Date('2026-12-01T04:30:00Z');
    expect(campaignDay(t, 'America/Chicago')).toBe('2026-11-30');
    expect(campaignDay(t, 'UTC')).toBe('2026-12-01');
    expect(campaignDay(new Date('2026-12-01T06:00:00Z'), 'America/Chicago')).toBe('2026-12-01');
    expect(formatInZone('2026-12-01T15:00:00Z', 'America/Chicago')).toBe('Tue 1 Dec, 09:00 (America/Chicago)');
  });
});

describe('daily discovery', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `id-${i}`);
  it('is stable within a day and independent of list order', () => {
    const a = pickDaily(ids, '2026-12-01');
    expect(a).toBe(pickDaily([...ids].reverse(), '2026-12-01'));
    expect(a).toBe(pickDaily(ids, '2026-12-01'));
  });
  it('changes across days and covers the collection over time', () => {
    const picks = new Set(Array.from({ length: 120 }, (_, d) => pickDaily(ids, `2027-01-${String(d).padStart(3, '0')}`)));
    expect(picks.size).toBeGreaterThan(20);
  });
  it('handles empty and tiny collections', () => {
    expect(pickDaily([], '2026-12-01')).toBeNull();
    expect(pickDaily(['only'], '2026-12-01')).toBe('only');
    expect(['a', 'b']).toContain(pickDaily(['a', 'b'], '2026-12-01'));
  });
  it('adding a page rarely changes the pick', () => {
    let changed = 0;
    for (let d = 0; d < 200; d++) {
      const day = `2027-02-${d}`;
      if (pickDaily(ids, day) !== pickDaily([...ids, 'new-page'], day)) changed++;
    }
    expect(changed).toBeLessThan(15); // about 1 in 41 expected
  });
  it('hash is deterministic', () => {
    expect(hash32('abc')).toBe(hash32('abc'));
    expect(hash32('abc')).not.toBe(hash32('abd'));
  });
});
