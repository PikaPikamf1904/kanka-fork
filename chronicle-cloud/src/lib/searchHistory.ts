// Search history and saved searches. Both live in this browser only (localStorage), under keys that
// include the signed-in user id so people sharing a device never see each other's. Nothing is sent
// to the server, and "Clear" / "Remove" delete them from the device. A query is text the person typed,
// not page content, so it holds no page titles.

export const HISTORY_KEY = 'chronicle-search-history';
export const SAVED_KEY = 'chronicle-saved-searches';
export const HISTORY_MAX = 10;
export const SAVED_MAX = 20;

export interface SavedSearch { name: string; query: string }

export const historyKey = (userId: string) => `${HISTORY_KEY}:${userId}`;
export const savedKey = (userId: string) => `${SAVED_KEY}:${userId}`;

/** Newest first, no repeats (ignoring case and extra spaces), at most `max`. Empty queries are not kept. */
export function pushHistory(list: string[], query: string, max = HISTORY_MAX): string[] {
  const q = query.replace(/\s+/g, ' ').trim();
  if (!q) return list;
  return [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, max);
}

/** Add or replace (by name, ignoring case) a saved search. A blank name falls back to the query. */
export function addSaved(list: SavedSearch[], name: string, query: string, max = SAVED_MAX): SavedSearch[] {
  const q = query.replace(/\s+/g, ' ').trim();
  const n = (name.trim() || q).slice(0, 60);
  if (!q) return list;
  return [...list.filter((s) => s.name.toLowerCase() !== n.toLowerCase()), { name: n, query: q }].slice(-max);
}

export const removeSaved = (list: SavedSearch[], name: string) => list.filter((s) => s.name !== name);

export function parseHistory(raw: string | null): string[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

export function parseSaved(raw: string | null): SavedSearch[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is SavedSearch => typeof x === 'object' && x !== null && typeof (x as SavedSearch).name === 'string' && typeof (x as SavedSearch).query === 'string')
      .map((x) => ({ name: x.name, query: x.query }))
      .slice(0, SAVED_MAX);
  } catch {
    return [];
  }
}

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const read = <T,>(parse: (r: string | null) => T, key: string, s: Reader, empty: T): T => {
  try { return parse(s.getItem(key)); } catch { return empty; }
};

export const loadHistory = (userId: string, s: Reader = localStorage) => read(parseHistory, historyKey(userId), s, [] as string[]);
export const loadSaved = (userId: string, s: Reader = localStorage) => read(parseSaved, savedKey(userId), s, [] as SavedSearch[]);

export function recordSearch(userId: string, query: string, s: Writer = localStorage): string[] {
  const next = pushHistory(loadHistory(userId, s), query);
  try { s.setItem(historyKey(userId), JSON.stringify(next)); } catch { /* not kept */ }
  return next;
}
export function clearHistory(userId: string, s: Writer = localStorage) {
  try { s.removeItem(historyKey(userId)); } catch { /* nothing to clear */ }
}
export function storeSaved(userId: string, list: SavedSearch[], s: Writer = localStorage) {
  try { s.setItem(savedKey(userId), JSON.stringify(list)); } catch { /* not kept */ }
}

// ---------- highlighting the words searched for ----------

/** The plain words of a query: operators, quotes, "or" and excluded (-word) terms removed. */
export function queryTerms(text: string): string[] {
  const words = text
    .replace(/(^|\s)(type|kind|category|cat):(?:"[^"]*"|\S+)/gi, ' ')
    .replace(/(^|\s)-\S+/g, ' ')
    .replace(/["“”]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && w.toLowerCase() !== 'or');
  return [...new Set(words.map((w) => w.toLowerCase()))];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Split text into pieces, marking those that match a searched word (case-insensitive). Text is never changed. */
export function highlightSegments(text: string, terms: string[]): { text: string; hit: boolean }[] {
  if (terms.length === 0 || !text) return [{ text, hit: false }];
  const re = new RegExp(`(${terms.map(esc).sort((a, b) => b.length - a.length).join('|')})`, 'gi');
  return text.split(re).filter((p) => p !== '').map((p) => ({ text: p, hit: terms.some((t) => t === p.toLowerCase()) }));
}

/** A short window of text around the first match, for results that have no database snippet. */
export function excerpt(text: string, terms: string[], width = 200): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= width) return clean;
  const at = terms.map((t) => clean.toLowerCase().indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(at - 40, clean.length - width));
  return `${start > 0 ? '…' : ''}${clean.slice(start, start + width).trim()}${start + width < clean.length ? '…' : ''}`;
}
