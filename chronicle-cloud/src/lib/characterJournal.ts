// Pure logic for the character journal: tags, grouping by month, searching and filtering.
// Dates are plain "YYYY-MM-DD" strings end to end, so no time zone can move an entry to another day.

export const JOURNAL_TAGS = [
  { value: 'theory', label: 'Theory' },
  { value: 'goal', label: 'Goal' },
  { value: 'suspicion', label: 'Suspicion' },
  { value: 'question', label: 'Question' },
  { value: 'note', label: 'Note' },
] as const;
export type JournalTag = (typeof JOURNAL_TAGS)[number]['value'];

export const tagLabel = (tag: string) => JOURNAL_TAGS.find((t) => t.value === tag)?.label ?? tag;

export interface JournalEntry {
  id: string;
  user_id: string;
  title: string;
  body: string;
  entry_date: string;
  tags: string[];
  version: number;
  created_at: string;
  /** Pages this entry links to (ids only; resolve them under Row Level Security to show them). */
  article_ids: string[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-11-03" -> "November 2026". Anything else is returned unchanged. */
export function monthLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${m[1]}` : date;
}

/** "2026-11-03" -> "3 November 2026". */
export function dayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${Number(m[3])} ${name} ${m[1]}` : date;
}

/** Today's date on the reader's own calendar, as YYYY-MM-DD. */
export function localDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Newest entry first: by entry date, then by when it was written, then by id so the order is stable. */
export function sortEntries<T extends Pick<JournalEntry, 'id' | 'entry_date' | 'created_at'>>(entries: T[]): T[] {
  return [...entries].sort((a, b) =>
    b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
}

/** Entries grouped by calendar month of their entry date, newest month first, newest entry first. */
export function groupByMonth<T extends Pick<JournalEntry, 'id' | 'entry_date' | 'created_at'>>(entries: T[]): { key: string; label: string; entries: T[] }[] {
  const groups: { key: string; label: string; entries: T[] }[] = [];
  for (const e of sortEntries(entries)) {
    const key = e.entry_date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(e);
    else groups.push({ key, label: monthLabel(e.entry_date), entries: [e] });
  }
  return groups;
}

/** Title or text contains every word typed (any case), and, when a tag is chosen, the entry carries it. */
export function filterEntries<T extends Pick<JournalEntry, 'title' | 'body' | 'tags'>>(entries: T[], query: string, tag: string | null): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (tag && !e.tags.includes(tag)) return false;
    const hay = `${e.title}\n${e.body}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
