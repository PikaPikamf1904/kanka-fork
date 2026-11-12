// Data access. Every read goes through Row Level Security: the browser receives only rows the
// signed-in user may see, so nothing here filters secrets client-side.
import { toChronicleError } from './changeSets.ts';
import type { NewsReliability, NewsReviewState, NewsSection } from './gazette.ts';
import { MEDIA_BUCKET, supabase } from './supabase.ts';
import type {
  AccessCode, Article, ArticleRef, ArticleType, CampaignSettings, Category, CategoryCount, DmNote,
  InfoboxField, MapFogArea, MapMarker, Media, Member, Relation, Revision, SearchHit, Section, TimelineEvent, WikiMap,
} from './types.ts';

function must<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

/**
 * Read every row of a query in pages. The hosted Data API returns at most 1000 rows per request
 * whatever limit is asked for, so a single request silently truncates a large wiki. The query
 * must have a stable order. Capped so a runaway table cannot loop forever.
 */
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const batch = must(await page(i * PAGE_SIZE, (i + 1) * PAGE_SIZE - 1));
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

const ARTICLE_COLUMNS =
  'id, slug, type, title, subtitle, summary, hero_media_id, visibility, status, is_featured, is_party_member, importance, session_date, updated_at, published_at, version';

export async function getSettings(): Promise<CampaignSettings | null> {
  // The location page is embedded through Row Level Security: a page the reader may not see comes back null.
  return must(await supabase.from('campaign_settings').select('title, tagline, overview, banner_media_id, current_location_id, current_status, current_location:articles(slug, title, type)').maybeSingle());
}

export async function updateSettings(patch: Partial<CampaignSettings>) {
  const { current_location: _ignored, ...row } = patch;
  void _ignored;
  must(await supabase.from('campaign_settings').update(row).eq('id', true).select('title'));
}

/** Readable pages with these addresses (unknown or hidden ones are simply absent). */
export async function articlesBySlugs(slugs: string[]): Promise<(ArticleRef & { id: string; hero_media_id: string | null; summary: string })[]> {
  const unique = [...new Set(slugs)].filter((x) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(x)).slice(0, 200);
  if (unique.length === 0) return [];
  return must(await supabase.from('articles').select('id, slug, title, type, hero_media_id, summary').in('slug', unique));
}

/** Session journals in play order: by play date, then by when they were written. */
export async function listSessions(): Promise<Pick<Article, 'id' | 'slug' | 'title' | 'summary' | 'session_date' | 'status' | 'visibility' | 'updated_at'>[]> {
  const rows = must(await supabase.from('articles').select('id, slug, title, summary, session_date, status, visibility, updated_at, created_at').eq('type', 'session').limit(500)) as (Article & { created_at: string })[];
  return rows.sort((a, b) => (a.session_date ?? '9999').localeCompare(b.session_date ?? '9999') || a.created_at.localeCompare(b.created_at));
}

// ---------- The Goblin Gazette ----------
export interface NewsDetails {
  section: NewsSection;
  reliability: NewsReliability;
  reporter: string;
  dateline: string;
  in_world_date: string;
  issue_number: number | null;
  is_lead: boolean;
  corrects_article_id: string | null;
  review_state: NewsReviewState;
  reviewed_at: string | null;
}
export type NewsStory = Article & { news: NewsDetails | null };

/** Every story the reader may see: players get published stories only (Row Level Security). */
export async function listNews(): Promise<NewsStory[]> {
  const raw = must(await supabase.from('articles').select(`${ARTICLE_COLUMNS}, news:news_stories!news_stories_article_id_fkey(*)`).eq('type', 'news').limit(500)) as unknown as (Article & { news: NewsDetails | NewsDetails[] | null })[];
  // One story row per page; PostgREST may return it as an object or a one-element list.
  const rows: NewsStory[] = raw.map((r) => ({ ...r, news: Array.isArray(r.news) ? r.news[0] ?? null : r.news }));
  return rows.sort((a, b) => (b.news?.issue_number ?? 0) - (a.news?.issue_number ?? 0) || (b.published_at ?? b.updated_at).localeCompare(a.published_at ?? a.updated_at));
}

/** A revision of a printed story, waiting for the DM (only the DM can read these). */
export interface NewsPending { article_id: string; story: NewsDraft; review_state: NewsReviewState; updated_at: string }

export async function getNewsStory(slug: string): Promise<{ bundle: ArticleBundle; news: NewsDetails | null; pending: NewsPending | null } | null> {
  const bundle = await getArticle(slug);
  if (!bundle || bundle.article.type !== 'news') return null;
  const [news, pending] = await Promise.all([
    supabase.from('news_stories').select('*').eq('article_id', bundle.article.id).maybeSingle(),
    supabase.from('news_pending').select('*').eq('article_id', bundle.article.id).maybeSingle(),
  ]);
  return { bundle, news: must(news) as NewsDetails | null, pending: (pending.error ? null : pending.data) as NewsPending | null };
}

/** Which printed stories have a waiting revision, and in what state (DM only; players get none). */
export async function listNewsPending(): Promise<Map<string, NewsReviewState>> {
  const { data } = await supabase.from('news_pending').select('article_id, review_state');
  return new Map((data ?? []).map((r: { article_id: string; review_state: NewsReviewState }) => [r.article_id, r.review_state]));
}

export interface NewsDraft {
  article: { id?: string; slug: string; title: string; subtitle: string; summary: string; hero_media_id: string | null };
  sections: { id?: string; heading: string; body: string; visibility: 'players'; status: 'published' }[];
  details: Omit<NewsDetails, 'review_state' | 'reviewed_at'>;
}

/** Saves story and details in one transaction (website, DM only). Never publishes. A printed story
 *  is not changed: the save becomes its waiting revision (`pending: true`). */
export async function saveNewsStory(draft: NewsDraft, expectedVersion?: string): Promise<Article & { pending: boolean }> {
  const { data, error } = await supabase.rpc('save_news_story', { p_story: draft, p_expected_version: expectedVersion ?? null });
  if (error) throw toChronicleError(error);
  return data as Article & { pending: boolean };
}

export type NewsAction = 'submit' | 'approve' | 'return' | 'publish' | 'unpublish' | 'discard';
export async function newsTransition(articleId: string, action: NewsAction) {
  const { data, error } = await supabase.rpc('news_transition', { p_article: articleId, p_action: action });
  if (error) throw toChronicleError(error);
  return data as { review_state: NewsReviewState; status: Article['status']; visibility: Article['visibility']; pending: NewsReviewState | null };
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
  return fetchAll((from, to) =>
    supabase.from('articles').select('id, slug, title, type, visibility, status').order('title').order('id').range(from, to),
  );
}

/** Race, class and status of the given characters, as far as the reader may see them (one request). */
export async function listCharacterFacts(ids: string[]): Promise<Map<string, { race?: string; class?: string; status?: string }>> {
  const out = new Map<string, { race?: string; class?: string; status?: string }>();
  for (let i = 0; i < ids.length; i += 150) {
    const rows = must(await supabase.from('infobox_fields').select('article_id, label, value').in('article_id', ids.slice(i, i + 150)).in('label', ['Race', 'Species', 'Class', 'Status'])) as { article_id: string; label: string; value: string }[];
    for (const r of rows) {
      if (!r.value.trim()) continue;
      const entry = out.get(r.article_id) ?? {};
      entry[(r.label === 'Species' ? 'race' : r.label.toLowerCase()) as 'race' | 'class' | 'status'] = r.value.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
      out.set(r.article_id, entry);
    }
  }
  return out;
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

export type MapMarkerView = MapMarker & { article: ArticleRef | null; submap: { slug: string; title: string } | null };

export async function getMap(slug: string): Promise<{ map: WikiMap; markers: MapMarkerView[]; children: WikiMap[]; parent: WikiMap | null; fog: MapFogArea[] } | null> {
  const map = must(await supabase.from('maps').select('*').eq('slug', slug).maybeSingle()) as WikiMap | null;
  if (!map) return null;
  const [markers, children, parent, fog] = await Promise.all([
    supabase.from('map_markers').select('*, article:articles(slug, title, type)').eq('map_id', map.id).order('label'),
    supabase.from('maps').select('*').eq('parent_map_id', map.id).order('title'),
    map.parent_map_id ? supabase.from('maps').select('*').eq('id', map.parent_map_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    // Players receive only revealed areas (Row Level Security); the DM receives all of them.
    supabase.from('map_fog_areas').select('id, map_id, label, points, visibility').eq('map_id', map.id).order('created_at'),
  ]);
  const markerRows = must(markers) as (MapMarker & { article: ArticleRef | null })[];
  const childMaps = must(children) as WikiMap[];
  // A pin linked to a page (a town) opens the map attached to that same page, if the reader may
  // see one. Maps under this one win over maps elsewhere; Row Level Security hides the rest.
  const articleIds = [...new Set(markerRows.map((m) => m.article_id).filter((id): id is string => !!id))];
  const linked = articleIds.length === 0 ? [] : must(await supabase.from('maps').select('id, slug, title, article_id, parent_map_id').in('article_id', articleIds).neq('id', map.id).order('title')) as Pick<WikiMap, 'id' | 'slug' | 'title' | 'article_id' | 'parent_map_id'>[];
  const submapFor = (articleId: string | null) => {
    if (!articleId) return null;
    const candidates = linked.filter((m) => m.article_id === articleId);
    const pick = candidates.find((m) => m.parent_map_id === map.id) ?? candidates[0];
    return pick ? { slug: pick.slug, title: pick.title } : null;
  };
  return {
    map,
    markers: markerRows.map((m) => ({ ...m, submap: submapFor(m.article_id) })),
    children: childMaps,
    parent: must(parent) as WikiMap | null,
    fog: must(fog) as MapFogArea[],
  };
}

export async function listRelations(): Promise<(Relation & { source: ArticleRef; target: ArticleRef })[]> {
  return (await fetchAll((from, to) =>
    supabase
      .from('relations')
      .select('*, source:articles!relations_source_article_id_fkey(slug, title, type), target:articles!relations_target_article_id_fkey(slug, title, type)')
      .order('id')
      .range(from, to),
  )) as (Relation & { source: ArticleRef; target: ArticleRef })[];
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
  article: Omit<Article, 'id' | 'updated_at' | 'published_at' | 'version'> & { id?: string };
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

/**
 * Save an article and all its parts in one database transaction (snapshot first, so every save can
 * be undone). If the article changed elsewhere since `expectedVersion`, nothing is written and a
 * ChronicleError with code CONFLICT is thrown.
 */
export async function saveArticle(draft: ArticleDraft, note: string, expectedVersion?: number): Promise<Article> {
  const { data, error } = await supabase.rpc('save_article', {
    p_draft: {
      article: draft.article,
      sections: draft.sections.map((s) => ({ id: s.id ?? null, heading: s.heading, body: s.body, visibility: s.visibility, status: s.status })),
      infobox: draft.infobox.map((f) => ({ id: f.id ?? null, label: f.label, value: f.value, visibility: f.visibility })),
      categoryIds: draft.categoryIds,
    },
    p_expected_version: expectedVersion === undefined ? null : `v${expectedVersion}`,
    p_note: note || 'Before save',
  });
  if (error) throw toChronicleError(error);
  const row = data as Omit<Article, 'version'> & { version: string };
  return { ...row, version: Number(String(row.version).replace(/^v/, '')) };
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
  // Every hidden page, not just the newest 50: after an import the review queue can be long.
  return fetchAll((from, to) =>
    supabase.from('articles').select(ARTICLE_COLUMNS).or('status.eq.draft,visibility.eq.dm')
      .order('updated_at', { ascending: false }).order('id').range(from, to),
  );
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

export async function setMapFog(mapId: string, enabled: boolean) {
  must(await supabase.from('maps').update({ fog_enabled: enabled }).eq('id', mapId).select('id'));
}

export async function saveFogArea(a: Omit<MapFogArea, 'id'> & { id?: string }) {
  const { id, ...row } = a;
  must(id ? await supabase.from('map_fog_areas').update(row).eq('id', id).select('id') : await supabase.from('map_fog_areas').insert(row).select('id'));
}

export async function deleteFogArea(id: string) {
  must(await supabase.from('map_fog_areas').delete().eq('id', id).select('id'));
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
