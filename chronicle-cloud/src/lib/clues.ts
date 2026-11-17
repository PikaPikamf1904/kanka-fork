// Pure helpers for clues (Mystery Studio). The database decides what a player may receive; these only
// describe state for the DM and hide unreleased clues in the DM's own "view as a player" screens,
// where the database returns everything.

export const CLUE_KINDS = [
  { value: 'letter', label: 'Letter' },
  { value: 'document', label: 'Document' },
  { value: 'notice', label: 'Notice' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'symbol', label: 'Symbol' },
  { value: 'note', label: 'Note' },
] as const;
export const kindLabel = (k: string) => CLUE_KINDS.find((c) => c.value === k)?.label ?? 'Clue';

export const MYSTERY_STATUS = ['draft', 'active', 'concluded', 'archived'] as const;
export type MysteryStatus = (typeof MYSTERY_STATUS)[number];
export const statusName = (s: string) => ({ draft: 'Draft', active: 'Active', concluded: 'Concluded', archived: 'Archived' }[s] ?? s);

export interface Timed { released_at: string | null; release_at: string | null }

export type ReleaseState = 'hidden' | 'scheduled' | 'released';

/** Not released at all, waiting for a future time, or out. */
export function releaseState(t: Timed, now: Date = new Date()): ReleaseState {
  if (t.released_at) return 'released';
  if (t.release_at) return new Date(t.release_at).getTime() <= now.getTime() ? 'released' : 'scheduled';
  return 'hidden';
}
export const isReleased = (t: Timed, now: Date = new Date()) => releaseState(t, now) === 'released';

/** Scheduled items, soonest first. */
export function pendingReleases<T extends Timed>(items: T[], now: Date = new Date()): T[] {
  return items.filter((i) => releaseState(i, now) === 'scheduled').sort((a, b) => a.release_at!.localeCompare(b.release_at!));
}

/** <input type="datetime-local"> value (local time) from an ISO time, and back. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function releaseText(t: Timed, now: Date = new Date()): string {
  const s = releaseState(t, now);
  if (s === 'released') return t.released_at ? 'Released' : 'Released on schedule';
  if (s === 'scheduled') return `Scheduled for ${new Date(t.release_at!).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`;
  return 'Not released';
}

/** Order clues for display: position, then title. */
export const sortClues = <T extends { position: number; title: string }>(c: T[]) =>
  [...c].sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));

/** Whether the DM's own view should treat a mystery as showing its clues to players. */
export const mysteryShowsClues = (status: string | null | undefined) => status === undefined || status === null || status === 'active' || status === 'concluded';
