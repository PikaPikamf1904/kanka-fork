// Read-only queries for beta features. Row Level Security decides what each reader receives,
// exactly as for the rest of the site; nothing here writes to the database.
import { supabase } from '../lib/supabase.ts';
import { listAllArticleRefs, resolveSlug } from '../lib/api.ts';
import type { ArticleRef, ArticleType } from '../lib/types.ts';

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
    const one = async (s: string) =>
      ((await supabase.from('articles').select('slug, title, type, subtitle, summary, hero_media_id').eq('slug', s).maybeSingle()).data as Preview | null);
    // Old addresses and [[Title]] links may go through a redirect.
    hit = (async () => (await one(slug)) ?? (await resolveSlug(slug).then((r) => (r && r.slug !== slug ? one(r.slug) : null))))().catch(() => null);
    previews.set(slug, hit);
  }
  return hit;
}

let index: { at: number; list: Promise<ArticleRef[]> } | null = null;


/** Every page title the reader may see, for Quick jump; refreshed after five minutes. */
export function pageIndex(): Promise<ArticleRef[]> {
  if (!index || Date.now() - index.at > 5 * 60_000) {
    const list = listAllArticleRefs();
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
