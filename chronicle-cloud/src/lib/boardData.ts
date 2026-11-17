// Investigation board data access (migration 20261117000300). Everything is read under the signed-in
// person's Row Level Security. A pin holds only a kind and an id; resolvePins() looks each one up
// again, and a pin whose target no longer comes back is shown as "no longer available".
import { supabase } from './supabase.ts';

export type CardKind = 'pin' | 'note' | 'theory';
export type RefType = 'article' | 'map' | 'map_marker' | 'timeline_event' | 'media' | 'clue';

export interface BoardItem {
  id: string; kind: CardKind; ref_type: RefType | null; ref_id: string | null; group_id: string | null;
  title: string; body: string; colour: string; marks: string[]; theory_status: string | null;
  x: number; y: number; version: number; created_by: string | null; author_name: string; is_dm: boolean; created_at: string;
}
export interface BoardLink { id: string; from_item: string; to_item: string; label: string; created_by: string | null }
export interface BoardGroup { id: string; title: string; colour: string; position: number; created_by: string | null }
export interface BoardActivity { id: number; at: string; actor_name: string; action: string; item_kind: string; detail: string }
export interface Board { items: BoardItem[]; links: BoardLink[]; groups: BoardGroup[]; activity: BoardActivity[] }

/** Plain-English text for a failed board call. */
export function boardError(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return '';
  if (error.code === '42501') return /pinned|party can see/i.test(error.message ?? '') ? 'That page cannot be pinned because the whole party cannot see it.' : 'You cannot change that card. Only the person who wrote it, or the DM, can edit its text.';
  if (error.code === '54000') return error.message || 'The board has reached a limit.';
  if (error.code === '23505') return 'Those two cards are already connected.';
  return 'That did not work. Check your connection and try again.';
}

function check<T>(r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new Error(boardError(r.error));
  return r.data as T;
}

export async function loadBoard(): Promise<Board> {
  const [items, links, groups, activity] = await Promise.all([
    supabase.from('board_items').select('*').order('created_at').limit(1000),
    supabase.from('board_links').select('id, from_item, to_item, label, created_by').limit(1000),
    supabase.from('board_groups').select('id, title, colour, position, created_by').order('position').order('created_at'),
    supabase.from('board_activity').select('id, at, actor_name, action, item_kind, detail').order('id', { ascending: false }).limit(25),
  ]);
  return { items: check(items) as BoardItem[], links: check(links) as BoardLink[], groups: check(groups) as BoardGroup[], activity: check(activity) as BoardActivity[] };
}

export interface NewCard {
  kind: CardKind; ref_type?: RefType; ref_id?: string; title?: string; body?: string; colour?: string; group_id?: string | null;
  x: number; y: number;
}
export async function addCard(c: NewCard): Promise<BoardItem> {
  const row = {
    kind: c.kind, ref_type: c.ref_type ?? null, ref_id: c.ref_id ?? null, title: c.title ?? '', body: c.body ?? '',
    colour: c.colour ?? (c.kind === 'note' ? 'amber' : c.kind === 'theory' ? 'violet' : 'parchment'),
    group_id: c.group_id ?? null, theory_status: c.kind === 'theory' ? 'unresolved' : null, x: Math.round(c.x), y: Math.round(c.y),
  };
  return check(await supabase.from('board_items').insert(row).select('*').single()) as BoardItem;
}

export type CardPatch = Partial<Pick<BoardItem, 'x' | 'y' | 'title' | 'body' | 'colour' | 'marks' | 'theory_status' | 'group_id'>>;
export type UpdateResult = { ok: true; item: BoardItem } | { ok: false; reason: 'conflict' } | { ok: false; reason: 'error'; message: string };

/** Change a card only if nobody else changed it since it was loaded (`version`). Zero rows back means someone did. */
export async function updateCard(item: Pick<BoardItem, 'id' | 'version'>, patch: CardPatch): Promise<UpdateResult> {
  const { data, error } = await supabase.from('board_items').update(patch).eq('id', item.id).eq('version', item.version).select('*');
  if (error) return { ok: false, reason: 'error', message: boardError(error) };
  const row = (data as BoardItem[] | null)?.[0];
  return row ? { ok: true, item: row } : { ok: false, reason: 'conflict' };
}

export async function deleteCard(id: string): Promise<void> {
  check(await supabase.from('board_items').delete().eq('id', id).select('id'));
}

export async function addLink(from: string, to: string, label: string): Promise<BoardLink> {
  return check(await supabase.from('board_links').insert({ from_item: from, to_item: to, label: label.trim() }).select('id, from_item, to_item, label, created_by').single()) as BoardLink;
}
export async function deleteLink(id: string): Promise<void> {
  check(await supabase.from('board_links').delete().eq('id', id).select('id'));
}

export async function addGroup(title: string, colour: string, position: number): Promise<BoardGroup> {
  return check(await supabase.from('board_groups').insert({ title: title.trim(), colour, position }).select('id, title, colour, position, created_by').single()) as BoardGroup;
}
export async function deleteGroup(id: string): Promise<void> {
  check(await supabase.from('board_groups').delete().eq('id', id).select('id'));
}

/** Is this thing already pinned? (Used by the "Pin this page" buttons.) */
export async function existingPin(refType: RefType, refId: string): Promise<string | null> {
  const rows = check(await supabase.from('board_items').select('id').eq('kind', 'pin').eq('ref_type', refType).eq('ref_id', refId).limit(1)) as { id: string }[];
  return rows[0]?.id ?? null;
}

/** Pin a thing at a spread-out spot. The database refuses anything the whole party cannot see. */
export async function pinThing(refType: RefType, refId: string): Promise<BoardItem> {
  return addCard({ kind: 'pin', ref_type: refType, ref_id: refId, x: Math.round(Math.random() * 600), y: Math.round(Math.random() * 400) });
}

// ---------- resolving pins ----------

export interface PinTarget {
  type: RefType; id: string; title: string; subtitle: string; href: string | null; summary: string; mediaId: string | null;
}

/** Look every pinned thing up again under the reader's own access. Anything that does not come back is absent. */
export async function resolvePins(items: BoardItem[]): Promise<Map<string, PinTarget>> {
  const ids = (t: RefType) => [...new Set(items.filter((i) => i.kind === 'pin' && i.ref_type === t && i.ref_id).map((i) => i.ref_id!))];
  const out = new Map<string, PinTarget>();
  const [a, m, mk, ev, md, cl] = [ids('article'), ids('map'), ids('map_marker'), ids('timeline_event'), ids('media'), ids('clue')];
  const q = async <T,>(table: string, cols: string, list: string[]): Promise<T[]> =>
    list.length === 0 ? [] : (check(await supabase.from(table).select(cols).in('id', list)) as unknown as T[]);
  const [articles, maps, markers, events, media, clues] = await Promise.all([
    q<{ id: string; slug: string; title: string; summary: string; type: string; hero_media_id: string | null }>('articles', 'id, slug, title, summary, type, hero_media_id', a),
    q<{ id: string; slug: string; title: string; description: string }>('maps', 'id, slug, title, description', m),
    q<{ id: string; label: string; map_id: string }>('map_markers', 'id, label, map_id', mk),
    q<{ id: string; title: string; date_label: string }>('timeline_events', 'id, title, date_label', ev),
    q<{ id: string }>('media', 'id', md),
    q<{ id: string; title: string; kind: string }>('clues', 'id, title, kind', cl),
  ]);
  for (const r of articles) out.set(r.id, { type: 'article', id: r.id, title: r.title, subtitle: 'Page', href: `/wiki/${r.slug}`, summary: r.summary, mediaId: r.hero_media_id });
  for (const r of maps) out.set(r.id, { type: 'map', id: r.id, title: r.title, subtitle: 'Map', href: `/maps/${r.slug}`, summary: r.description, mediaId: null });
  for (const r of markers) out.set(r.id, { type: 'map_marker', id: r.id, title: r.label, subtitle: 'Map marker', href: null, summary: '', mediaId: null });
  for (const r of events) out.set(r.id, { type: 'timeline_event', id: r.id, title: r.title, subtitle: r.date_label || 'Timeline event', href: '/timeline', summary: '', mediaId: null });
  for (const r of media) out.set(r.id, { type: 'media', id: r.id, title: 'Picture', subtitle: 'Picture', href: null, summary: '', mediaId: r.id });
  for (const r of clues) out.set(r.id, { type: 'clue', id: r.id, title: r.title, subtitle: 'Clue', href: '/mysteries', summary: '', mediaId: null });
  return out;
}
