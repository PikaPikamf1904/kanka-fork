// "Who's at the table?": the five seats on the first screen. A seat is only a shortcut to a way of
// signing in. It never signs anyone in by itself: players continue from their own saved sign-in on
// this device, or prove themselves with the table code or their invitation link; the DM goes through
// the DM screen passcode and then the DM's own account.
import type { SavedAccount } from './accounts.ts';

export interface Seat {
  id: string;
  player: string;
  character: string;
}

export const SEATS: readonly Seat[] = [
  { id: 'weston', player: 'Weston', character: 'Bob' },
  { id: 'sybil', player: 'Sybil', character: 'Swift Claw' },
  { id: 'charity', player: 'Charity', character: 'Gears/Robo' },
  { id: 'eliza', player: 'Eliza', character: 'Frost' },
];

const firstWord = (name: string) => name.trim().split(/[^\p{L}]+/u).find(Boolean)?.toLowerCase() ?? '';

/** A saved sign-in belongs to a seat when its name starts with the seat's player name ("Weston", "Weston (Bob)"). */
export const accountMatchesSeat = (account: Pick<SavedAccount, 'name'>, seat: Seat) => firstWord(account.name) === seat.player.toLowerCase();

export function accountForSeat(accounts: readonly SavedAccount[], seat: Seat): SavedAccount | undefined {
  return accounts.find((a) => accountMatchesSeat(a, seat));
}
