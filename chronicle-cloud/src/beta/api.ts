// Read-only queries for beta features. Row Level Security decides what each reader receives,
// exactly as for the rest of the site; nothing here writes to the database.
import { supabase } from '../lib/supabase.ts';
import type { ArticleType } from '../lib/types.ts';

export interface Preview {
  slug: string;
  title: string;
  type: ArticleType;
  subtitle: string;
  summary: string;
  hero_media_id: string | null;
}

const previews = new Map<string, Promise<Preview | null>>();

/** A page's card (title, type, subtitle, summary, picture), cached for the visit. Null if not readable. */
export function getPreview(slug: string): Promise<Preview | null> {
  let hit = previews.get(slug);
  if (!hit) {
    hit = (async () => {
      const cols = 'slug, title, type, subtitle, summary, hero_media_id';
      const { data } = await supabase.from('articles').select(cols).eq('slug', slug).maybeSingle();
      if (data) return data as Preview;
      // Old addresses and [[Title]] links may go through a redirect.
      const { data: moved } = await supabase.rpc('resolve_slug', { p_slug: slug });
      const target = (moved as { slug: string }[] | null)?.[0]?.slug;
      if (!target || target === slug) return null;
      const { data: again } = await supabase.from('articles').select(cols).eq('slug', target).maybeSingle();
      return (again as Preview | null) ?? null;
    })().catch(() => null);
    previews.set(slug, hit);
  }
  return hit;
}

let index: { at: number; list: Promise<IndexEntry[]> } | null = null;

export interface IndexEntry { slug: string; title: string; type: ArticleType }

/** Every page title the reader may see, for Quick jump; refreshed after five minutes. */
export function pageIndex(): Promise<IndexEntry[]> {
  if (!index || Date.now() - index.at > 5 * 60_000) {
    const list = (async () => {
      const out: IndexEntry[] = [];
      for (let from = 0; from < 20_000; from += 1000) {
        const { data, error } = await supabase.from('articles').select('slug, title, type').order('title').order('id').range(from, from + 999);
        if (error) throw new Error(error.message);
        out.push(...((data ?? []) as IndexEntry[]));
        if ((data ?? []).length < 1000) break;
      }
      return out;
    })();
    index = { at: Date.now(), list };
    list.catch(() => { index = null; });
  }
  return index.list;
}

/** Called on every sign-in and sign-out: cached pages belong to the previous identity. */
export function clearBetaCaches() {
  previews.clear();
  index = null;
}

export interface Change {
  slug: string;
  title: string;
  type: ArticleType;
  updated_at: string;
  published_at: string | null;
}

/** Pages the reader can see that changed after `since` (newest first). */
export async function changedSince(since: string, limit = 40): Promise<Change[]> {
  const { data, error } = await supabase
    .from('articles')
    .select('slug, title, type, updated_at, published_at')
    .gt('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as Change[];
}
