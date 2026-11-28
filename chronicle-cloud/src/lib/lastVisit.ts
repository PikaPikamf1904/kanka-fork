// "New since your last visit": which recently published pages appeared after the reader's previous
// visit. Kept in this browser only, per signed-in user (like recentViews.ts); nothing is sent anywhere.
// A visit lasts until the reader has been away for VISIT_GAP_MS, so reading around for an hour does not
// clear the marks. The first visit on a device marks nothing (everything would look new).

export const LAST_VISIT_KEY = 'chronicle-visits';
/** Away this long and the next home-page load starts a new visit. */
export const VISIT_GAP_MS = 2 * 60 * 60 * 1000;

export interface Visits {
  /** When the current visit started (ISO). */
  current: string;
  /** When the visit before it started (ISO), or null on the first visit. */
  previous: string | null;
}

const visitsKey = (userId: string) => `${LAST_VISIT_KEY}:${userId}`;

export function parseVisits(raw: string | null): Visits | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Visits>;
    if (typeof v.current !== 'string' || Number.isNaN(Date.parse(v.current))) return null;
    const previous = typeof v.previous === 'string' && !Number.isNaN(Date.parse(v.previous)) ? v.previous : null;
    return { current: v.current, previous };
  } catch {
    return null;
  }
}

/** The visits after loading the home page at `now`: a new visit starts after a long enough gap. */
export function nextVisits(stored: Visits | null, now: Date): Visits {
  if (!stored) return { current: now.toISOString(), previous: null };
  const away = now.getTime() - Date.parse(stored.current);
  return away >= VISIT_GAP_MS ? { current: now.toISOString(), previous: stored.current } : stored;
}

/** Record this home-page load and return when the reader's previous visit started (null: none known). */
export function touchVisit(userId: string, now = new Date(), storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): string | null {
  try {
    const next = nextVisits(parseVisits(storage.getItem(visitsKey(userId))), now);
    storage.setItem(visitsKey(userId), JSON.stringify(next));
    return next.previous;
  } catch {
    // Private browsing or blocked storage: no marks, the page still works.
    return null;
  }
}

/** A page is new to this reader when it was first published after their previous visit began. */
export const isNewSince = (publishedAt: string | null | undefined, previous: string | null) =>
  Boolean(previous && publishedAt && Date.parse(publishedAt) > Date.parse(previous));
