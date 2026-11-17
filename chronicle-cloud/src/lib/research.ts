// Knowledge Studio data: research collections, sources and summaries. Every page is resolved under
// the reader's own RLS; nothing about a page is stored in the collection except its id.
import { supabase } from './supabase.ts';
import type { ResearchSummary, ResolvedSource } from './researchExport.ts';

export interface Collection {
  id: string;
  user_id: string;
  title: string;
  description: string;
  shared: boolean;
  created_at: string;
  updated_at: string;
}

const MISSING = new Set(['PGRST202', 'PGRST205', '42P01']);
function check<T>(r: { data: T | null; error: { code?: string; message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

/** The caller's collections and those other players shared; null when the feature is not installed. */
export async function listCollections(): Promise<Collection[] | null> {
  const r = await supabase.from('research_collections').select('id, user_id, title, description, shared, created_at, updated_at').order('updated_at', { ascending: false });
  if (r.error && MISSING.has(r.error.code)) return null;
  return check(r) as Collection[];
}

export async function getCollection(id: string): Promise<Collection | null> {
  return check(await supabase.from('research_collections').select('id, user_id, title, description, shared, created_at, updated_at').eq('id', id).maybeSingle()) as Collection | null;
}

export async function createCollection(title: string, description: string): Promise<string> {
  const row = check(await supabase.from('research_collections').insert({ title: title.trim(), description: description.trim() }).select('id').single()) as { id: string };
  return row.id;
}

export async function updateCollection(id: string, patch: Partial<Pick<Collection, 'title' | 'description' | 'shared'>>): Promise<void> {
  check(await supabase.from('research_collections').update(patch).eq('id', id));
}

export async function deleteCollection(id: string): Promise<void> {
  check(await supabase.from('research_collections').delete().eq('id', id));
}

export async function loadSources(collectionId: string): Promise<ResolvedSource[]> {
  const rows = check(await supabase.from('research_sources').select('id, article_id, topic, annotation, excerpt, position').eq('collection_id', collectionId)) as Omit<ResolvedSource, 'page'>[];
  const ids = [...new Set(rows.map((r) => r.article_id))];
  const pages = new Map<string, ResolvedSource['page']>();
  for (let i = 0; i < ids.length; i += 150) {
    const got = check(await supabase.from('articles').select('id, slug, title, type').in('id', ids.slice(i, i + 150))) as { id: string; slug: string; title: string; type: string }[];
    for (const p of got) pages.set(p.id, { slug: p.slug, title: p.title, type: p.type });
  }
  return rows.map((r) => ({ ...r, page: pages.get(r.article_id) ?? null }));
}

/** Add a page by its address; the database refuses pages the caller cannot read. */
export async function addSource(collectionId: string, slug: string, position: number): Promise<void> {
  const page = check(await supabase.from('articles').select('id').eq('slug', slug).maybeSingle()) as { id: string } | null;
  if (!page) throw new Error('That page could not be found.');
  const r = await supabase.from('research_sources').insert({ collection_id: collectionId, article_id: page.id, position });
  if (r.error?.code === '23505') throw new Error('That page is already in this collection.');
  check(r);
}

export async function updateSource(id: string, patch: Partial<Pick<ResolvedSource, 'topic' | 'annotation' | 'excerpt' | 'position'>>): Promise<void> {
  check(await supabase.from('research_sources').update(patch).eq('id', id));
}

export async function removeSource(id: string): Promise<void> {
  check(await supabase.from('research_sources').delete().eq('id', id));
}

export async function loadSummaries(collectionId: string): Promise<ResearchSummary[]> {
  return check(await supabase.from('research_notes').select('id, title, body, version, updated_at').eq('collection_id', collectionId).order('created_at')) as ResearchSummary[];
}

export async function addSummary(collectionId: string, title: string): Promise<void> {
  check(await supabase.from('research_notes').insert({ collection_id: collectionId, title: title.trim(), body: '' }));
}

/** Save only if nobody changed it since it was loaded; returns false on a conflict. */
export async function saveSummary(s: ResearchSummary, patch: { title: string; body: string }): Promise<boolean> {
  const r = check(await supabase.from('research_notes').update(patch).eq('id', s.id).eq('version', s.version).select('id')) as { id: string }[];
  return r.length === 1;
}

export async function deleteSummary(id: string): Promise<void> {
  check(await supabase.from('research_notes').delete().eq('id', id));
}

/** Pages connected to the sources (characters, places, events…) that the reader can see, not already sources. */
export async function relatedPages(articleIds: string[]): Promise<{ slug: string; title: string; type: string }[]> {
  if (articleIds.length === 0) return [];
  const ids = articleIds.slice(0, 150);
  const [out, inc] = await Promise.all([
    supabase.from('relations').select('target_article_id').in('source_article_id', ids),
    supabase.from('relations').select('source_article_id').in('target_article_id', ids),
  ]);
  const linked = new Set<string>([
    ...((check(out) as { target_article_id: string }[]).map((r) => r.target_article_id)),
    ...((check(inc) as { source_article_id: string }[]).map((r) => r.source_article_id)),
  ]);
  for (const id of articleIds) linked.delete(id);
  if (linked.size === 0) return [];
  const pages = check(await supabase.from('articles').select('slug, title, type').in('id', [...linked].slice(0, 150)).order('title')) as { slug: string; title: string; type: string }[];
  return pages;
}
