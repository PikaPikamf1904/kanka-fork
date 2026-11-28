// Where a page is named in text the reader can already read (database function `mentions`, see
// supabase/migrations/20261128000100_mentions.sql). It complements backlinks(), which only finds
// [[links]]. The database applies the reader's own row-level security, so a player only ever gets
// pages and text they may read.
import { supabase } from './supabase.ts';
import type { ArticleRef } from './types.ts';

/** Pages that mention this one by name. Empty if the database function is not installed yet. */
export async function loadMentions(articleId: string): Promise<ArticleRef[]> {
  const { data, error } = await supabase.rpc('mentions', { p_article: articleId });
  if (error) {
    // The website may be deployed before the migration: the page still works, just without mentions.
    if (error.code === 'PGRST202' || error.code === '42883') return [];
    throw new Error(error.message);
  }
  return (data ?? []) as ArticleRef[];
}

/** Pages this page's own visible text names (never Gazette stories). Empty if not installed yet. */
export async function loadNamedIn(articleId: string): Promise<ArticleRef[]> {
  const { data, error } = await supabase.rpc('named_in', { p_article: articleId });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return [];
    throw new Error(error.message);
  }
  return (data ?? []) as ArticleRef[];
}
