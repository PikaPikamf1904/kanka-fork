import { describe, expect, it } from 'vitest';
import { longDate } from './dates.ts';

describe('longDate', () => {
  it('writes the month out and keeps the calendar day of a plain date', () => {
    const text = longDate('2026-10-17');
    expect(text).toMatch(/17/);
    expect(text).toMatch(/2026/);
    expect(text).not.toMatch(/^\d+\/\d+\/\d+$/);
  });

  it('returns nothing for missing or invalid dates rather than "Invalid Date"', () => {
    expect(longDate(null)).toBe('');
    expect(longDate(undefined)).toBe('');
    expect(longDate('')).toBe('');
    expect(longDate('not a date')).toBe('');
  });
});
