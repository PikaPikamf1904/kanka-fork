import { describe, expect, it } from 'vitest';
import { SEATS, accountForSeat, accountMatchesSeat } from './table.ts';

const acct = (name: string, userId = name) => ({ userId, name, refreshToken: 'r', savedAt: 1 });

describe('seats', () => {
  it('are the four players and their characters, in table order', () => {
    expect(SEATS.map((s) => `${s.player} — ${s.character}`)).toEqual([
      'Weston — Bob', 'Sybil — Swift Claw', 'Charity — Gears/Robo', 'Eliza — Frost',
    ]);
  });

  it('match a saved sign-in by the player name only', () => {
    const weston = SEATS[0]!;
    expect(accountMatchesSeat(acct('Weston'), weston)).toBe(true);
    expect(accountMatchesSeat(acct('weston (Bob)'), weston)).toBe(true);
    expect(accountMatchesSeat(acct('  Weston  '), weston)).toBe(true);
    expect(accountMatchesSeat(acct('Westonia'), weston)).toBe(false);
    expect(accountMatchesSeat(acct('Bob'), weston)).toBe(false);
    expect(accountMatchesSeat(acct('Eliza'), weston)).toBe(false);
  });

  it('pick the right saved account, or none', () => {
    const list = [acct('Eliza', 'u1'), acct('Sybil', 'u2')];
    expect(accountForSeat(list, SEATS[3]!)?.userId).toBe('u1');
    expect(accountForSeat(list, SEATS[1]!)?.userId).toBe('u2');
    expect(accountForSeat(list, SEATS[0]!)).toBeUndefined();
  });
});
