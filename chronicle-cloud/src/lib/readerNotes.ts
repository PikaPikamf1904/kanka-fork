// Saved pages, reading lists, the private scratchpad and character journals (migration 20261117000100).
// Rows hold only page ids: pages are resolved through Row Level Security (resolvePages), and a page
// that no longer comes back (hidden or deleted) is simply left out. No title is ever stored here.
import { toChronicleError } from './changeSetTypes.ts';
import type { JournalEntry } from './characterJournal.ts';
import { supabase } from './supabase.ts';
import type { ArticleRef } from './types.ts';

function must<T>(result: { data: T | null; error: { message: string; details?: string | null; code?: string } | null }, duplicate?: string): T {
  if (result.error) {
    if (duplicate && result.error.code === '23505') throw new Error(duplicate);
    throw toChronicleError(result.error);
  }
  return result.data as T;
}

/** Plain-English text for an error from these calls (the database's own message for known problems). */
export function noteErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message && error.message !== 'Chronicle could not complete the request.') return error.message;
  return 'That did not work. Check your connection and try again.';
}

// ---------- pages ----------

export type PageRef = ArticleRef & { id: string };

/** The pages with these ids that the signed-in person can read right now. Others are absent. */
export async function resolvePages(ids: string[]): Promise<Map<string, PageRef>> {
  const unique = [...new Set(ids)];
  const found = new Map<string, PageRef>();
  for (let i = 0; i < unique.length; i += 60) {
    const rows = must(await supabase.from('articles').select('id, slug, title, type').in('id', unique.slice(i, i + 60))) as PageRef[];
    for (const r of rows) found.set(r.id, r);
  }
  return found;
}

// ---------- reading lists and bookmarks ----------

export interface ReadingList { id: string; name: string; position: number }
export interface Bookmark { id: string; article_id: string; list_id: string | null; position: number }

export async function listReadingLists(): Promise<ReadingList[]> {
  return must(await supabase.from('reading_lists').select('id, name, position').order('position').order('created_at')) as ReadingList[];
}

export async function loadSaved(): Promise<{ lists: ReadingList[]; bookmarks: Bookmark[] }> {
  const [lists, bookmarks] = await Promise.all([
    listReadingLists(),
    supabase.from('bookmarks').select('id, article_id, list_id, position').order('position').order('created_at').limit(1000),
  ]);
  return { lists, bookmarks: must(bookmarks) as Bookmark[] };
}

export async function bookmarksForPage(articleId: string): Promise<Bookmark[]> {
  return must(await supabase.from('bookmarks').select('id, article_id, list_id, position').eq('article_id', articleId)) as Bookmark[];
}

/** One more than the last position in a list (null = unsorted), so a new or moved page lands at the end. */
async function endPosition(listId: string | null): Promise<number> {
  const q = supabase.from('bookmarks').select('position');
  const rows = must(await (listId ? q.eq('list_id', listId) : q.is('list_id', null)).order('position', { ascending: false }).limit(1)) as { position: number }[];
  return (rows[0]?.position ?? 0) + 1;
}

export async function savePage(articleId: string, listId: string | null): Promise<Bookmark> {
  const position = await endPosition(listId);
  return must(await supabase.from('bookmarks').insert({ article_id: articleId, list_id: listId, position }).select('id, article_id, list_id, position').single(), 'That page is already saved there.') as Bookmark;
}

export async function removeBookmark(id: string): Promise<void> {
  must(await supabase.from('bookmarks').delete().eq('id', id).select('id'));
}

export async function moveBookmark(id: string, listId: string | null): Promise<void> {
  const position = await endPosition(listId);
  must(await supabase.from('bookmarks').update({ list_id: listId, position }).eq('id', id).select('id'), 'That page is already saved in that list.');
}

export async function reorderBookmarks(listId: string | null, ids: string[]): Promise<void> {
  must(await supabase.rpc('reorder_bookmarks', { p_list: listId, p_ids: ids }));
}

export async function createList(name: string, position: number): Promise<ReadingList> {
  return must(await supabase.from('reading_lists').insert({ name, position }).select('id, name, position').single(), 'You already have a list with that name.') as ReadingList;
}

export async function renameList(id: string, name: string): Promise<void> {
  must(await supabase.from('reading_lists').update({ name }).eq('id', id).select('id'), 'You already have a list with that name.');
}

export async function deleteList(id: string): Promise<void> {
  must(await supabase.from('reading_lists').delete().eq('id', id).select('id'));
}

// ---------- private scratchpad ----------

export interface Scratchpad { id: string; article_id: string | null; body: string; version: number }

export async function loadScratchpad(articleId: string | null): Promise<Scratchpad | null> {
  const q = supabase.from('scratchpad_notes').select('id, article_id, body, version');
  const { data, error } = await (articleId ? q.eq('article_id', articleId) : q.is('article_id', null)).maybeSingle();
  if (error) throw toChronicleError(error);
  return data as Scratchpad | null;
}

/** Save with the version that was loaded (null when no note was loaded). A stale version is refused with CONFLICT. */
export async function saveScratchpad(articleId: string | null, body: string, expectedVersion: number | null): Promise<Scratchpad> {
  return must(await supabase.rpc('save_scratchpad', { p_article: articleId, p_body: body, p_expected_version: expectedVersion })) as Scratchpad;
}

export async function deleteScratchpad(id: string): Promise<void> {
  must(await supabase.from('scratchpad_notes').delete().eq('id', id).select('id'));
}

// ---------- journal ----------

interface JournalRow {
  id: string; user_id: string; title: string; body: string; entry_date: string; tags: string[]; version: number; created_at: string;
  journal_entry_links: { article_id: string }[];
}
const JOURNAL_SELECT = 'id, user_id, title, body, entry_date, tags, version, created_at, journal_entry_links(article_id)';
const toEntry = (r: JournalRow): JournalEntry => ({
  id: r.id, user_id: r.user_id, title: r.title, body: r.body, entry_date: r.entry_date, tags: r.tags, version: r.version,
  created_at: r.created_at, article_ids: r.journal_entry_links.map((l) => l.article_id),
});

async function allJournalRows(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<JournalEntry[]> {
  const rows: JournalEntry[] = [];
  for (let page = 0; page < 5; page++) {
    const batch = must(await build(page * 1000, page * 1000 + 999)) as JournalRow[];
    rows.push(...batch.map(toEntry));
    if (batch.length < 1000) break;
  }
  return rows;
}

/** The signed-in person's own entries. (The DM's database role can read everyone's, so this always filters by owner.) */
export function loadMyJournal(userId: string): Promise<JournalEntry[]> {
  return allJournalRows((from, to) =>
    supabase.from('journal_entries').select(JOURNAL_SELECT).eq('user_id', userId).order('entry_date', { ascending: false }).order('id').range(from, to));
}

/** Every entry in the campaign. Only the DM's account gets rows back. */
export function loadAllJournals(): Promise<JournalEntry[]> {
  return allJournalRows((from, to) =>
    supabase.from('journal_entries').select(JOURNAL_SELECT).order('entry_date', { ascending: false }).order('id').range(from, to));
}

export interface JournalDraft { id: string | null; title: string; body: string; entry_date: string; tags: string[]; article_ids: string[]; version: number | null }

/** Create or change an entry and its links. A stale version is refused with CONFLICT. */
export async function saveJournalEntry(d: JournalDraft): Promise<{ id: string; version: number }> {
  const row = must(await supabase.rpc('save_journal_entry', {
    p_id: d.id, p_title: d.title, p_body: d.body, p_date: d.entry_date, p_tags: d.tags, p_articles: d.article_ids, p_expected_version: d.version,
  })) as { id: string; version: number };
  return { id: row.id, version: row.version };
}

export async function deleteJournalEntry(id: string): Promise<void> {
  must(await supabase.from('journal_entries').delete().eq('id', id).select('id'));
}

export async function memberNames(): Promise<Map<string, string>> {
  const rows = must(await supabase.from('campaign_members').select('user_id, display_name')) as { user_id: string; display_name: string }[];
  return new Map(rows.map((r) => [r.user_id, r.display_name]));
}
