// Mystery Studio and clue data access (migration 20261117000200). Players read clues under Row Level
// Security, which already hides everything unreleased, undiscovered-prerequisite or attached to a page
// they cannot read. The DM's account can read everything, so the DM's "view as a player" screens
// filter again on the client (see lib/clues.ts) - only the DM ever sees that data.
import type { MysteryStatus, Timed } from './clues.ts';
import { supabase } from './supabase.ts';

function check<T>(r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new Error(r.error.code === '42501' ? 'You are not allowed to do that.' : 'That did not work. Check your connection and try again.');
  return r.data as T;
}

export interface Hint extends Timed { id: string; clue_id: string; position: number; body: string }
export interface Clue extends Timed {
  id: string; mystery_id: string; kind: string; title: string; body: string; source_line: string;
  attach_article_id: string | null; attach_map_id: string | null; requires_clue_id: string | null; position: number;
}
export interface Mystery {
  id: string; title: string; player_title: string; summary: string; dm_notes: string; status: MysteryStatus; colour: string; created_at: string;
}

const CLUE_COLS = 'id, mystery_id, kind, title, body, source_line, attach_article_id, attach_map_id, requires_clue_id, release_at, released_at, position';
const HINT_COLS = 'id, clue_id, position, body, release_at, released_at';

// ---------- player side ----------

export interface ClueWithHints extends Clue { hints: Hint[]; mystery_status: string | null }

/** Clues attached to one page or map that this person may see now, with their released hints. */
export async function cluesFor(attach: 'article' | 'map', id: string): Promise<ClueWithHints[]> {
  const col = attach === 'article' ? 'attach_article_id' : 'attach_map_id';
  const rows = check(await supabase.from('clues').select(`${CLUE_COLS}, clue_hints(${HINT_COLS}), mysteries(status)`).eq(col, id).order('position')) as unknown as
    (Clue & { clue_hints: Hint[]; mysteries: { status: string } | null })[];
  return rows.map(({ clue_hints, mysteries, ...c }) => ({ ...c, hints: [...clue_hints].sort((a, b) => a.position - b.position), mystery_status: mysteries?.status ?? null }));
}

export async function discoveredAmong(clueIds: string[]): Promise<Set<string>> {
  if (clueIds.length === 0) return new Set();
  const rows = check(await supabase.from('clue_discoveries').select('clue_id').in('clue_id', clueIds)) as { clue_id: string }[];
  return new Set(rows.map((r) => r.clue_id));
}

/** Record that this person opened a clue. A second time is not an error. */
export async function recordDiscovery(clueId: string): Promise<void> {
  const { error } = await supabase.from('clue_discoveries').insert({ clue_id: clueId });
  if (error && error.code !== '23505') throw new Error('Could not record that you found this.');
}

export interface MysteryIndexRow { id: string; title: string; colour: string; status: string; clues: number; discovered: number }
export async function mysteryIndex(): Promise<MysteryIndexRow[]> {
  const rows = check(await supabase.rpc('mystery_index')) as { id: string; title: string; colour: string; status: string; clues: number | string; discovered: number | string }[];
  return rows.map((r) => ({ ...r, clues: Number(r.clues), discovered: Number(r.discovered) }));
}

export async function visibleClues(mysteryIds: string[]): Promise<ClueWithHints[]> {
  if (mysteryIds.length === 0) return [];
  const rows = check(await supabase.from('clues').select(`${CLUE_COLS}, clue_hints(${HINT_COLS}), mysteries(status)`).in('mystery_id', mysteryIds).order('position')) as unknown as
    (Clue & { clue_hints: Hint[]; mysteries: { status: string } | null })[];
  return rows.map(({ clue_hints, mysteries, ...c }) => ({ ...c, hints: [...clue_hints].sort((x, y) => x.position - y.position), mystery_status: mysteries?.status ?? null }));
}

/** Titles and addresses of the pages and maps clues are attached to (only those the reader can read come back). */
export async function attachNames(articleIds: string[], mapIds: string[]): Promise<Map<string, { title: string; href: string }>> {
  const out = new Map<string, { title: string; href: string }>();
  const [a, m] = await Promise.all([
    articleIds.length ? supabase.from('articles').select('id, slug, title').in('id', [...new Set(articleIds)]) : Promise.resolve({ data: [], error: null }),
    mapIds.length ? supabase.from('maps').select('id, slug, title').in('id', [...new Set(mapIds)]) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of (check(a) ?? []) as { id: string; slug: string; title: string }[]) out.set(r.id, { title: r.title, href: `/wiki/${r.slug}` });
  for (const r of (check(m) ?? []) as { id: string; slug: string; title: string }[]) out.set(r.id, { title: r.title, href: `/maps/${r.slug}` });
  return out;
}

// ---------- DM side ----------

export async function listMysteries(): Promise<Mystery[]> {
  return check(await supabase.from('mysteries').select('*').order('created_at', { ascending: false })) as Mystery[];
}
export async function saveMystery(m: Partial<Mystery> & { title: string }): Promise<Mystery> {
  const { id, created_at: _c, ...rest } = m;
  void _c;
  return check(id
    ? await supabase.from('mysteries').update(rest).eq('id', id).select('*').single()
    : await supabase.from('mysteries').insert(rest).select('*').single()) as Mystery;
}
export async function deleteMystery(id: string): Promise<void> {
  check(await supabase.from('mysteries').delete().eq('id', id).select('id'));
}

export async function listClues(mysteryId?: string): Promise<(Clue & { clue_hints: Hint[] })[]> {
  const q = supabase.from('clues').select(`${CLUE_COLS}, clue_hints(${HINT_COLS})`).order('position').order('created_at');
  return check(await (mysteryId ? q.eq('mystery_id', mysteryId) : q)) as unknown as (Clue & { clue_hints: Hint[] })[];
}
export async function saveClue(c: Partial<Clue> & { mystery_id: string; title: string }): Promise<Clue> {
  const { id, ...rest } = c;
  return check(id
    ? await supabase.from('clues').update(rest).eq('id', id).select(CLUE_COLS).single()
    : await supabase.from('clues').insert(rest).select(CLUE_COLS).single()) as unknown as Clue;
}
export async function deleteClue(id: string): Promise<void> {
  check(await supabase.from('clues').delete().eq('id', id).select('id'));
}
export async function saveHint(h: Partial<Hint> & { clue_id: string; body: string }): Promise<void> {
  const { id, ...rest } = h;
  check(id ? await supabase.from('clue_hints').update(rest).eq('id', id).select('id') : await supabase.from('clue_hints').insert(rest).select('id'));
}
export async function deleteHint(id: string): Promise<void> {
  check(await supabase.from('clue_hints').delete().eq('id', id).select('id'));
}

export async function allDiscoveries(): Promise<{ clue_id: string; user_id: string; discovered_at: string }[]> {
  return check(await supabase.from('clue_discoveries').select('clue_id, user_id, discovered_at').order('discovered_at', { ascending: false })) as { clue_id: string; user_id: string; discovered_at: string }[];
}

export async function previewClues(userId: string): Promise<{ id: string; mystery_id: string; title: string; discovered: boolean }[]> {
  return check(await supabase.rpc('dm_preview_clues', { p_user: userId })) as { id: string; mystery_id: string; title: string; discovered: boolean }[];
}
