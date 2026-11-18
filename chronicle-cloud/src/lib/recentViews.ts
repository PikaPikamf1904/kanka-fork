// "Recently viewed": the last pages this person opened on this device. Kept in the browser only,
// under a key that includes the signed-in user id, so people sharing a device never see each
// other's list. The list stores a page's id, address and title as the reader saw it, so it can
// hold the title of a page that is hidden later; that was readable by this person at the time, it
// never leaves the device, and "Clear" removes it. Nothing is written to the database.

export interface RecentView {
  id: string;
  slug: string;
  title: string;
}

export const RECENT_VIEWS_KEY = 'chronicle-recent-views';
export const RECENT_VIEWS_MAX = 20;

export const recentViewsKey = (userId: string) => `${RECENT_VIEWS_KEY}:${userId}`;

/** Put a view first, drop any earlier entry for the same page, and keep at most `max`. */
export function pushRecent(list: RecentView[], view: RecentView, max = RECENT_VIEWS_MAX): RecentView[] {
  return [view, ...list.filter((v) => v.id !== view.id)].slice(0, max);
}

const isView = (v: unknown): v is RecentView =>
  typeof v === 'object' && v !== null
  && typeof (v as RecentView).id === 'string' && typeof (v as RecentView).slug === 'string' && typeof (v as RecentView).title === 'string';

/** Read a stored list, ignoring anything that is not in the expected shape. */
export function parseRecent(raw: string | null): RecentView[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isView).slice(0, RECENT_VIEWS_MAX).map((v) => ({ id: v.id, slug: v.slug, title: v.title })) : [];
  } catch {
    return [];
  }
}

export function loadRecentViews(userId: string, storage: Pick<Storage, 'getItem'> = localStorage): RecentView[] {
  try {
    return parseRecent(storage.getItem(recentViewsKey(userId)));
  } catch {
    return [];
  }
}

export function recordRecentView(userId: string, view: RecentView, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) {
  try {
    storage.setItem(recentViewsKey(userId), JSON.stringify(pushRecent(loadRecentViews(userId, storage), view)));
  } catch {
    // Private mode or a full disk: the list just isn't kept.
  }
}

export function clearRecentViews(userId: string, storage: Pick<Storage, 'removeItem'> = localStorage) {
  try {
    storage.removeItem(recentViewsKey(userId));
  } catch {
    // Nothing to clear.
  }
}
