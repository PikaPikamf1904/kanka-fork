// One play order for session journals, used by the home page, the Sessions list and the
// previous/next pager. The database has no reliable order (pages are often created in bulk), so
// the order comes from facts the DM has written down, strongest first:
//   1. the page's play date (`session_date`), or a date in a "Date played" style infobox field;
//   2. an explicit session number ("Session" / "Session number" infobox field);
//   3. otherwise the title, which is stable but says nothing about when the session was played.
// Sessions with no key sort BEFORE keyed ones, so a page that is known to be later is never
// hidden behind one that is not. `orderIsKnown` says whether the order can be trusted.

export interface SessionOrderInput {
  title: string;
  slug?: string;
  session_date?: string | null;
  infobox?: { label: string; value: string }[] | null;
}

/** Infobox labels that hold a play date (the same set the session page reads). */
export const PLAY_DATE_LABELS = /^(date|played|play date|date played|session date)$/i;
/** Infobox labels that hold a session number. */
export const SESSION_NUMBER_LABELS = /^(session|session number|session no\.?|session #)$/i;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthOf = (word: string): number => {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return -1;
  return MONTHS.findIndex((m) => m === w || (w.length <= 4 && m.startsWith(w)) || (w === 'sept' && m === 'september'));
};

const pad = (n: number) => String(n).padStart(2, '0');
const valid = (y: number, m: number, d: number) => {
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/**
 * "2026-11-10", "November 10, 2026", "10 Nov 2026", "10th of November 2026" -> "2026-11-10".
 * Anything else (including free text such as "Session 3") is not a date: null. No locale guessing,
 * and no Date.parse, which accepts nonsense.
 */
export function parsePlayDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/\bof\b/gi, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = /^([A-Za-z.]+) (\d{1,2}) (\d{4})$/.exec(text);
  if (m) { const mo = monthOf(m[1]!); return mo < 0 ? null : valid(+m[3]!, mo + 1, +m[2]!); }
  m = /^(\d{1,2}) ([A-Za-z.]+) (\d{4})$/.exec(text);
  if (m) { const mo = monthOf(m[2]!); return mo < 0 ? null : valid(+m[3]!, mo + 1, +m[1]!); }
  return null;
}

/** "3", "#3", "No. 3", "Session 3" -> 3; anything else null. */
export function parseSessionNumber(value: string | null | undefined): number | null {
  const m = /^\s*(?:#|no\.?|session)?\s*(\d{1,4})\s*$/i.exec(value ?? '');
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export interface SessionKeys { date: string | null; number: number | null }

export function sessionKeys(s: SessionOrderInput): SessionKeys {
  const fields = s.infobox ?? [];
  const column = s.session_date ? parsePlayDate(s.session_date) : null;
  const date = column ?? parsePlayDate(fields.find((f) => PLAY_DATE_LABELS.test(f.label.trim()) && parsePlayDate(f.value))?.value);
  const number = parseSessionNumber(fields.find((f) => SESSION_NUMBER_LABELS.test(f.label.trim()) && parseSessionNumber(f.value) !== null)?.value);
  return { date, number };
}

const tier = (k: SessionKeys) => (k.date ? 2 : k.number !== null ? 1 : 0);
const byText = (a: SessionOrderInput, b: SessionOrderInput) =>
  a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' }) || (a.slug ?? '').localeCompare(b.slug ?? '');

export function compareSessions(a: SessionOrderInput, b: SessionOrderInput): number {
  const ka = sessionKeys(a);
  const kb = sessionKeys(b);
  const ta = tier(ka);
  const tb = tier(kb);
  if (ta !== tb) return ta - tb;
  if (ta === 2) {
    if (ka.date !== kb.date) return ka.date! < kb.date! ? -1 : 1;
    if (ka.number !== kb.number) return (ka.number ?? Infinity) - (kb.number ?? Infinity);
  } else if (ta === 1 && ka.number !== kb.number) {
    return ka.number! - kb.number!;
  }
  return byText(a, b);
}

/** A sorted copy, oldest first. */
export function sortSessions<T extends SessionOrderInput>(sessions: readonly T[]): T[] {
  return [...sessions].sort(compareSessions);
}

/** True when every session has a play date or a session number (zero or one session: nothing to order). */
export function orderIsKnown(sessions: readonly SessionOrderInput[]): boolean {
  if (sessions.length <= 1) return true;
  return sessions.every((s) => tier(sessionKeys(s)) > 0);
}
