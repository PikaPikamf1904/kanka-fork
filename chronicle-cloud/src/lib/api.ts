// Data access. Every read goes through Row Level Security: the browser receives only rows the
// signed-in user may see, so nothing here filters secrets client-side.
import { MEDIA_BUCKET, supabase } from './supabase.ts';
import type {
  AccessCode, Article, ArticleRef, ArticleType, CampaignSettings, Category, CategoryCount, DmNote,
  InfoboxField, MapMarker, Media, Member, Relation, Revision, SearchHit, Section, TimelineEvent, WikiMap,
} from './types.ts';

function must<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

const ARTICLE_COLUMNS =
  'id, slug, type, title, subtitle, summary, hero_media_id, visibility, status, is_featured, is_party_member, importance, session_date, updated_at, published_at';

export async function getSettings(): Promise<CampaignSettings | null> {
  return must(await supabase.from('campaign_settings').select('title, tagline, overview, banner_media_id').maybeSingle());
}

export async function updateSettings(patch: Partial<CampaignSettings>) {
  must(await supabase.from('campaign_settings').update(patch).eq('id', true).select('title'));
}

export async function listArticles(opts: {
  type?: ArticleType; featured?: boolean; party?: boolean; limit?: number;
  order?: 'updated' | 'title' | 'importance' | 'session';
} = {}): Promise<Article[]> {
  let q = supabase.from('articles').select(ARTICLE_COLUMNS);
  if (opts.type) q = q.eq('type', opts.type);
  if (opts.featured) q = q.eq('is_featured', true);
  if (opts.party) q = q.eq('is_party_member', true);
  if (opts.order === 'title') q = q.order('title');
  else if (opts.order === 'importance') q = q.order('importance', { ascending: false }).order('title');
  else if (opts.order === 'session') q = q.order('session_date', { ascending: false, nullsFirst: false });
  else q = q.order('updated_at', { ascending: false });
  return must(await q.limit(opts.limit ?? 100));
}

export async function listAllArticleRefs(): Promise<(ArticleRef & { id: string; visibility: Article['visibility']; status: Article['status'] })[]> {
  return must(await supabase.from('articles').select('id, slug, title, type, visibility, status').order('title').limit(2000));
}

export async function resolveSlug(slug: string): Promise<{ slug: string; redirected_from: string | null } | null> {
  const rows = must(await supabase.rpc('resolve_slug', { p_slug: slug }));
  return (rows as { slug: string; redirected_from: string | null }[])[0] ?? null;
}

export interface ArticleBundle {
  article: Article;
  sections: Section[];
  infobox: InfoboxField[];
  categories: Category[];
  relations: (Relation & { other: ArticleRef; direction: 'out' | 'in' })[];
  backlinks: ArticleRef[];
}

export async function getArticle(slug: string): Promise<ArticleBundle | null> {
  const article = must(await supabase.from('articles').select(ARTICLE_COLUMNS).eq('slug', slug).maybeSingle()) as Article | null;
  if (!article) return null;
  const [sections, infobox, cats, relations, backlinks] = await Promise.all([
    supabase.from('article_sections').select('*').eq('article_id', article.id).order('position').order('id'),
    supabase.from('infobox_fields').select('*').eq('article_id', article.id).order('position').order('id'),
    supabase.from('article_categories').select('categories(id, slug, name, kind, description, visibility)').eq('article_id', article.id),
    supabase
      .from('relations')
      .select('*, source:articles!relations_source_article_id_fkey(slug, title, type), target:articles!relations_target_article_id_fkey(slug, title, type)')
      .or(`source_article_id.eq.${article.id},target_article_id.eq.${article.id}`),
    supabase.rpc('backlinks', { p_article: article.id }),
  ]);
  type RelRow = Relation & { source: ArticleRef | null; target: ArticleRef | null };
  return {
    article,
    sections: must(sections) as Section[],
    infobox: must(infobox) as InfoboxField[],
    categories: (must(cats) as unknown as { categories: Category | null }[])
      .map((row) => row.categories)
      .filter((c): c is Category => c !== null)
      .sort((a, b) => a.name.localeCompare(b.name)),
    relations: (must(relations) as RelRow[])
      .map((r) => {
        const out = r.source_article_id === article.id;
        const other = out ? r.target : r.source;
        return other ? { ...r, other, direction: (out ? 'out' : 'in') as 'out' | 'in' } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null),
    backlinks: must(backlinks) as ArticleRef[],
  };
}

export interface PlayerPreview {
  visible: boolean;
  article?: Pick<Article, 'id' | 'slug' | 'type' | 'title' | 'subtitle' | 'summary' | 'hero_media_id' | 'updated_at'>;
  sections?: { id: string; heading: string; body: string }[];
  infobox?: { label: string; value: string }[];
  categories?: { slug: string; name: string; kind: string }[];
  relations?: { kind: string; label: string; slug: string; title: string }[];
}

export async function previewAsPlayer(slug: string): Promise<PlayerPreview> {
  return must(await supabase.rpc('preview_article_as_player', { p_slug: slug })) as PlayerPreview;
}

export async function search(q: string): Promise<SearchHit[]> {
  return must(await supabase.rpc('search_wiki', { q, max_results: 25 })) as SearchHit[];
}

export async function suggest(prefix: string): Promise<ArticleRef[]> {
  return must(await supabase.rpc('suggest_articles', { prefix, max_results: 8 })) as ArticleRef[];
}

export async function categoryCounts(): Promise<CategoryCount[]> {
  return must(await supabase.rpc('category_counts')) as CategoryCount[];
}

export async function getCategory(slug: string): Promise<{ category: Category; articles: Article[] } | null> {
  const category = must(await supabase.from('categories').select('*').eq('slug', slug).maybeSingle()) as Category | null;
  if (!category) return null;
  const rows = must(
    await supabase.from('article_categories').select(`articles(${ARTICLE_COLUMNS})`).eq('category_id', category.id),
  ) as unknown as { articles: Article | null }[];
  const articles = rows.map((r) => r.articles).filter((a): a is Article => a !== null).sort((a, b) => a.title.localeCompare(b.title));
  return { category, articles };
}

export async function listCategories(): Promise<Category[]> {
  return must(await supabase.from('categories').select('*').order('kind').order('name'));
}

export async function timeline(): Promise<(TimelineEvent & { article: ArticleRef | null })[]> {
  return must(await supabase.from('timeline_events').select('*, article:articles(slug, title, type)').order('sort_key')) as (TimelineEvent & { article: ArticleRef | null })[];
}

export async function listMaps(): Promise<WikiMap[]> {
  return must(await supabase.from('maps').select('*').order('title'));
}

export async function getMap(slug: string): Promise<{ map: WikiMap; markers: (MapMarker & { article: ArticleRef | null })[]; children: WikiMap[]; parent: WikiMap | null } | null> {
  const map = must(await supabase.from('maps').select('*').eq('slug', slug).maybeSingle()) as WikiMap | null;
  if (!map) return null;
  const [markers, children, parent] = await Promise.all([
    supabase.from('map_markers').select('*, article:articles(slug, title, type)').eq('map_id', map.id).order('label'),
    supabase.from('maps').select('*').eq('parent_map_id', map.id).order('title'),
    map.parent_map_id ? supabase.from('maps').select('*').eq('id', map.parent_map_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  return {
    map,
    markers: must(markers) as (MapMarker & { article: ArticleRef | null })[],
    children: must(children) as WikiMap[],
    parent: must(parent) as WikiMap | null,
  };
}

export async function listRelations(): Promise<(Relation & { source: ArticleRef; target: ArticleRef })[]> {
  return must(
    await supabase
      .from('relations')
      .select('*, source:articles!relations_source_article_id_fkey(slug, title, type), target:articles!relations_target_article_id_fkey(slug, title, type)')
      .limit(2000),
  ) as (Relation & { source: ArticleRef; target: ArticleRef })[];
}

// ---------------------------------------------------------------------------------------------
// Media: private bucket, short-lived signed URLs, cached per page load.
// ---------------------------------------------------------------------------------------------
// Signed URLs cannot be revoked, so keep them short: a file hidden after a player loaded it stays
// reachable through that URL for at most SIGNED_URL_SECONDS. Cleared on every sign-in/out.
const SIGNED_URL_SECONDS = 600;
const signedCache = new Map<string, { url: string; expires: number }>();

export function clearMediaUrlCache() {
  signedCache.clear();
}

export async function mediaUrls(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return out;
  const rows = must(await supabase.from('media').select('id, path').in('id', wanted)) as { id: string; path: string }[];
  const now = Date.now();
  const missing = rows.filter((r) => {
    const hit = signedCache.get(r.path);
    if (hit && hit.expires > now + 60_000) {
      out.set(r.id, hit.url);
      return false;
    }
    return true;
  });
  if (missing.length > 0) {
    const signed = must(await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(missing.map((r) => r.path), SIGNED_URL_SECONDS));
    for (const row of missing) {
      const s = signed.find((x) => x.path === row.path);
      if (s?.signedUrl) {
        signedCache.set(row.path, { url: s.signedUrl, expires: now + SIGNED_URL_SECONDS * 1000 });
        out.set(row.id, s.signedUrl);
      }
    }
  }
  return out;
}

export async function mediaUrlForPath(path: string): Promise<string | null> {
  const hit = signedCache.get(path);
  if (hit && hit.expires > Date.now() + 60_000) return hit.url;
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data) return null;
  signedCache.set(path, { url: data.signedUrl, expires: Date.now() + SIGNED_URL_SECONDS * 1000 });
  return data.signedUrl;
}

export async function listMedia(): Promise<Media[]> {
  return must(await supabase.from('media').select('id, path, alt, width, height, visibility').order('created_at', { ascending: false }).limit(500));
}

/** DM only. Upload an already-resized image and register it (private by default). */
/** Uploads start DM-only (enforced by policy); the page that shows the image decides who sees it. */
export async function uploadMedia(blob: Blob, info: { alt: string; width: number; height: number }): Promise<Media> {
  const path = `media/${crypto.randomUUID()}.webp`;
  must(await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: 'image/webp', upsert: false }));
  return must(
    await supabase
      .from('media')
      .insert({ path, alt: info.alt, width: info.width, height: info.height, bytes: blob.size, content_type: 'image/webp' })
      .select('id, path, alt, width, height, visibility')
      .single(),
  );
}


// ---------------------------------------------------------------------------------------------
// DM writes. RLS refuses all of these for players; the UI only offers them to the DM.
// ---------------------------------------------------------------------------------------------
export interface ArticleDraft {
  article: Omit<Article, 'id' | 'updated_at' | 'published_at'> & { id?: string };
  sections: (Omit<Section, 'id' | 'article_id'> & { id?: string })[];
  infobox: (Omit<InfoboxField, 'id' | 'article_id'> & { id?: string })[];
  categoryIds: string[];
}

export async function getArticleForEdit(slug: string) {
  const bundle = await getArticle(slug);
  if (!bundle) return null;
  const [notes, revisions, redirects] = await Promise.all([
    supabase.from('dm_notes').select('*').eq('article_id', bundle.article.id).order('created_at'),
    supabase.from('revisions').select('id, article_id, note, created_at').eq('article_id', bundle.article.id).order('created_at', { ascending: false }).limit(50),
    supabase.from('redirects').select('*').eq('article_id', bundle.article.id).order('from_slug'),
  ]);
  return {
    ...bundle,
    notes: must(notes) as DmNote[],
    revisions: must(revisions) as Revision[],
    redirects: must(redirects) as { from_slug: string; article_id: string; visibility: 'players' | 'dm' }[],
  };
}

/** Save an article and its parts. Existing articles are snapshotted first, so every save can be undone. */
export async function saveArticle(draft: ArticleDraft, note: string): Promise<Article> {
  const { id, ...fields } = draft.article;
  if (id) {
    must(await supabase.rpc('snapshot_article', { p_article: id, p_note: note || 'Before save' }));
  }
  const article = must(
    id
      ? await supabase.from('articles').update(fields).eq('id', id).select(ARTICLE_COLUMNS).single()
      : await supabase.from('articles').insert(fields).select(ARTICLE_COLUMNS).single(),
  ) as Article;

  // Sections: delete removed ones, then upsert in order.
  const keepSections = draft.sections.map((s) => s.id).filter(Boolean) as string[];
  let del = supabase.from('article_sections').delete().eq('article_id', article.id);
  if (keepSections.length > 0) del = del.not('id', 'in', `(${keepSections.join(',')})`);
  must(await del.select('id'));
  for (const [index, s] of draft.sections.entries()) {
    const row = { article_id: article.id, position: index + 1, heading: s.heading, body: s.body, visibility: s.visibility, status: s.status };
    must(s.id ? await supabase.from('article_sections').update(row).eq('id', s.id).select('id') : await supabase.from('article_sections').insert(row).select('id'));
  }

  const keepFields = draft.infobox.map((f) => f.id).filter(Boolean) as string[];
  let delF = supabase.from('infobox_fields').delete().eq('article_id', article.id);
  if (keepFields.length > 0) delF = delF.not('id', 'in', `(${keepFields.join(',')})`);
  must(await delF.select('id'));
  for (const [index, f] of draft.infobox.entries()) {
    const row = { article_id: article.id, position: index + 1, label: f.label, value: f.value, visibility: f.visibility };
    must(f.id ? await supabase.from('infobox_fields').update(row).eq('id', f.id).select('id') : await supabase.from('infobox_fields').insert(row).select('id'));
  }

  must(await supabase.from('article_categories').delete().eq('article_id', article.id).select('article_id'));
  if (draft.categoryIds.length > 0) {
    must(await supabase.from('article_categories').insert(draft.categoryIds.map((category_id) => ({ article_id: article.id, category_id }))).select('article_id'));
  }
  return article;
}

export async function deleteArticle(id: string) {
  must(await supabase.from('articles').delete().eq('id', id).select('id'));
}

export async function restoreRevision(revisionId: string) {
  must(await supabase.rpc('restore_revision', { p_revision: revisionId }));
}

export async function createCategory(c: Pick<Category, 'slug' | 'name' | 'kind' | 'visibility'>): Promise<Category> {
  return must(await supabase.from('categories').insert(c).select('*').single());
}

export async function addRelation(r: Omit<Relation, 'id'>) {
  must(await supabase.from('relations').insert(r).select('id'));
}

export async function updateRelation(id: string, patch: Partial<Relation>) {
  must(await supabase.from('relations').update(patch).eq('id', id).select('id'));
}

export async function deleteRelation(id: string) {
  must(await supabase.from('relations').delete().eq('id', id).select('id'));
}

export async function addRedirect(fromSlug: string, articleId: string, visibility: 'players' | 'dm') {
  must(await supabase.from('redirects').insert({ from_slug: fromSlug, article_id: articleId, visibility }).select('from_slug'));
}

export async function deleteRedirect(fromSlug: string) {
  must(await supabase.from('redirects').delete().eq('from_slug', fromSlug).select('from_slug'));
}

export async function saveNote(note: { id?: string; article_id: string | null; title: string; body: string }) {
  const { id, ...row } = note;
  must(id ? await supabase.from('dm_notes').update(row).eq('id', id).select('id') : await supabase.from('dm_notes').insert(row).select('id'));
}

export async function deleteNote(id: string) {
  must(await supabase.from('dm_notes').delete().eq('id', id).select('id'));
}

export async function listNotes(): Promise<(DmNote & { article: ArticleRef | null })[]> {
  return must(await supabase.from('dm_notes').select('*, article:articles(slug, title, type)').order('updated_at', { ascending: false }).limit(200)) as (DmNote & { article: ArticleRef | null })[];
}

export async function listDrafts(): Promise<Article[]> {
  return must(await supabase.from('articles').select(ARTICLE_COLUMNS).or('status.eq.draft,visibility.eq.dm').order('updated_at', { ascending: false }).limit(50));
}

export async function saveTimelineEvent(e: Omit<TimelineEvent, 'id'> & { id?: string }) {
  const { id, ...row } = e;
  must(id ? await supabase.from('timeline_events').update(row).eq('id', id).select('id') : await supabase.from('timeline_events').insert(row).select('id'));
}

export async function deleteTimelineEvent(id: string) {
  must(await supabase.from('timeline_events').delete().eq('id', id).select('id'));
}

export async function saveMap(m: Omit<WikiMap, 'id'> & { id?: string }): Promise<WikiMap> {
  const { id, ...row } = m;
  return must(id ? await supabase.from('maps').update(row).eq('id', id).select('*').single() : await supabase.from('maps').insert(row).select('*').single());
}

export async function saveMarker(m: Omit<MapMarker, 'id'> & { id?: string }) {
  const { id, ...row } = m;
  must(id ? await supabase.from('map_markers').update(row).eq('id', id).select('id') : await supabase.from('map_markers').insert(row).select('id'));
}

export async function deleteMarker(id: string) {
  must(await supabase.from('map_markers').delete().eq('id', id).select('id'));
}

export async function listMembers(): Promise<Member[]> {
  return must(await supabase.from('campaign_members').select('user_id, role, display_name, created_at, last_seen_at, revoked_at').order('created_at'));
}

export async function listAccessCodes(): Promise<AccessCode[]> {
  return must(await supabase.from('access_codes').select('id, label, created_at, expires_at, revoked_at, max_uses, use_count').order('created_at', { ascending: false }));
}

export async function createAccessCode(code: string, label: string, rotate: boolean) {
  must(rotate ? await supabase.rpc('rotate_access_code', { p_code: code, p_label: label }) : await supabase.rpc('create_access_code', { p_code: code, p_label: label }));
}

export async function revokeAccessCode(id: string) {
  must(await supabase.rpc('revoke_access_code', { p_id: id }));
}

export async function revokeMember(userId: string) {
  must(await supabase.rpc('revoke_member', { p_user: userId }));
}

export async function revokeAllPlayers(): Promise<number> {
  return must(await supabase.rpc('revoke_all_players')) as number;
}

export async function renameMember(userId: string, displayName: string) {
  must(await supabase.from('campaign_members').update({ display_name: displayName }).eq('user_id', userId).select('user_id'));
}
