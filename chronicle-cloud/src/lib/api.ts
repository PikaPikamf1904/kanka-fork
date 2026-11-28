// Data access. Every read goes through Row Level Security: the browser receives only rows the
// signed-in user may see, so nothing here filters secrets client-side.
import { toChronicleError } from './changeSets.ts';
import type { NewsReliability, NewsReviewState, NewsSection } from './gazette.ts';
// Types only: importing a value from loreImport.ts would put the whole importer in every visitor's first download.
import type { Decisions, ProgressEntry, StagedImport, WikiIndex } from './loreImport.ts';
import { mapChips, placeChips, type MapChip, type PlaceChip, type PlaceMapRow, type PlaceMarkerRow, type PlaceRelationRow } from './placeChips.ts';
import { likeLiteral } from './azIndex.ts';
import { pickWander } from './wander.ts';
import { slugify } from './slug.ts';
import { orderIsKnown, sortSessions } from './sessionOrder.ts';
import { pickDaily } from './discovery.ts';
import { safeZone } from './schedule.ts';
import type { AuditData } from './visibilityAudit.ts';
import type { OrgRel } from './orgChart.ts';
import type { GraphInput } from './knowledgeGraph.ts';
import type { RecentPage, RecentSection } from './recentChanges.ts';
import { FAMILY_KINDS, MAX_GENERATIONS, MAX_PEOPLE, type FamilyEdge, type FamilyPerson } from './familyTree.ts';
import { minLengthPattern, STUB_LONG_SECTION, STUB_MEDIUM_SECTION, type TidyArticle, type TidyData } from './wikiTidy.ts';
import { MEDIA_BUCKET, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from './supabase.ts';
import type {
  AccessCode, Article, ArticleRef, ArticleType, CampaignSettings, Category, CategoryCount, DmNote,
  InfoboxField, MapFogArea, MapMarker, Media, Member, PublishStatus, Relation, Revision, SearchHit, Section, TimelineEvent, Visibility, WikiMap,
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

const LEGACY_SETTINGS =
  'title, tagline, overview, banner_media_id, current_location_id, current_status, current_location:articles(slug, title, type)';

/**
 * The layout and the home page ask for the settings at the same moment; they share one request.
 * Only the request in flight is shared, nothing is kept afterwards, and it is dropped when the
 * signed-in person changes (clearSettingsRequest), so one reader never gets another's answer.
 */
let settingsInFlight: Promise<CampaignSettings | null> | null = null;
export function getSettings(): Promise<CampaignSettings | null> {
  settingsInFlight ??= loadSettings().finally(() => {
    settingsInFlight = null;
  });
  return settingsInFlight;
}
export function clearSettingsRequest() {
  settingsInFlight = null;
}

async function loadSettings(): Promise<CampaignSettings | null> {
  // Where the party is comes from campaign_location(): the DM always gets it, a player only when the
  // page is published to players (20261116000100). Before that migration the function does not
  // exist and the column is read directly, with the page embedded through Row Level Security.
  // Asked again on every call, so a tab opened before the migration recovers once it is applied.
  const [settings, loc] = await Promise.all([
    supabase.from('campaign_settings').select('title, tagline, overview, banner_media_id, current_status').maybeSingle(),
    supabase.rpc('campaign_location'),
  ]);
  if (loc.error) {
    if (loc.error.code !== 'PGRST202' && !/campaign_location/.test(loc.error.message)) throw new Error(loc.error.message);
    return must(await supabase.from('campaign_settings').select(LEGACY_SETTINGS).maybeSingle());
  }
  const s = must(settings) as Omit<CampaignSettings, 'current_location_id' | 'current_location'> | null;
  if (!s) return null;
  const place = ((loc.data ?? []) as { id: string; slug: string; title: string; type: ArticleRef['type'] }[])[0] ?? null;
  return { ...s, current_location_id: place?.id ?? null, current_location: place ? { slug: place.slug, title: place.title, type: place.type } : null } as CampaignSettings;
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

/** A session page with what the play order is read from (see sessionOrder.ts). */
export type SessionListItem = Article & { created_at: string; infobox: { label: string; value: string }[] };

/**
 * Session journals in play order, oldest first: by play date, then session number, then title
 * (src/lib/sessionOrder.ts). One query; the infobox fields come through Row Level Security like
 * everything else, so a player only receives the fields players may read.
 */
export async function listSessions(): Promise<SessionListItem[]> {
  const rows = must(await supabase.from('articles').select(`${ARTICLE_COLUMNS}, created_at, infobox:infobox_fields(label, value)`).eq('type', 'session').limit(500)) as unknown as (Article & { created_at: string; infobox: { label: string; value: string }[] | null })[];
  return sortSessions(rows.map((r) => ({ ...r, infobox: r.infobox ?? [] })));
}

/** The newest session in play order, whether that order is known, and how many sessions there are; null when none. */
export async function latestSession(): Promise<{ session: SessionListItem; orderKnown: boolean; count: number } | null> {
  const all = await listSessions();
  const session = all[all.length - 1];
  return session ? { session, orderKnown: orderIsKnown(all), count: all.length } : null;
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
  /** Letters from Krynn only (section 'letters'). */
  letter_from?: string;
  letter_to?: string;
  letter_signature?: string;
}
export type NewsStory = Article & { news: NewsDetails | null };

const NEWS_SELECT = `${ARTICLE_COLUMNS}, news:news_stories!news_stories_article_id_fkey(*)`;

/**
 * Newest printing first; the issue number only breaks ties (stories printed together). A story
 * scheduled for today must read as the newest even when its issue number is blank. One story row per
 * page (PostgREST may return it as a list).
 */
function newsInOrder(raw: (Article & { news: NewsDetails | NewsDetails[] | null })[]): NewsStory[] {
  const rows: NewsStory[] = raw.map((r) => ({ ...r, news: Array.isArray(r.news) ? r.news[0] ?? null : r.news }));
  const when = (r: NewsStory) => new Date(r.published_at ?? r.updated_at).getTime();
  return rows.sort((a, b) => when(b) - when(a) || (b.news?.issue_number ?? 0) - (a.news?.issue_number ?? 0));
}

/** Every story the reader may see: players get published stories only (Row Level Security). */
export async function listNews(): Promise<NewsStory[]> {
  return newsInOrder(must(await supabase.from('articles').select(NEWS_SELECT).eq('type', 'news').limit(500)) as never);
}

/**
 * The most recently printed player stories (optionally one section), newest issue first. Issues are
 * numbered as they are printed, so the newest issues are among the newest printings. Used by the
 * front page and the home headline instead of downloading every story.
 */
export async function listPrintedNews(opts: { section?: NewsSection | null; limit: number }): Promise<NewsStory[]> {
  // Letters from Krynn have their own page: they are not newspaper stories.
  const select = opts.section ? `${ARTICLE_COLUMNS}, news:news_stories!news_stories_article_id_fkey!inner(*)` : NEWS_SELECT;
  let q = supabase.from('articles').select(select).eq('type', 'news').eq('status', 'published').eq('visibility', 'players');
  // (Filtered here rather than in the query, so a database without the 'letters' value still works.)
  if (opts.section) q = q.eq('news.section', opts.section);
  const rows = newsInOrder(must(await q.order('published_at', { ascending: false, nullsFirst: false }).limit(opts.limit)) as never);
  return opts.section ? rows : rows.filter((r) => r.news?.section !== 'letters');
}

/** The home page's headline: the first story of the front page's order. */
export async function latestHeadline(): Promise<NewsStory | null> {
  return (await listPrintedNews({ limit: 30 }))[0] ?? null;
}

/** The archive's list: every printed story, with only the fields the list shows (no story text). */
export async function listNewsIndex(): Promise<NewsStory[]> {
  return newsInOrder(must(await supabase.from('articles')
    .select('id, slug, title, status, visibility, published_at, updated_at, news:news_stories!news_stories_article_id_fkey(section, reliability, reporter, issue_number, in_world_date)')
    .eq('type', 'news').eq('status', 'published').eq('visibility', 'players').limit(2000)) as never).filter((r) => r.news?.section !== 'letters');
}

/** Printed Letters from Krynn, newest first (only what this reader may read). */
export async function listLetters(limit = 100): Promise<NewsStory[]> {
  // Before the Living World migration the 'letters' value does not exist: there are simply no letters.
  const res = await supabase.from('articles')
    .select(`${ARTICLE_COLUMNS}, news:news_stories!news_stories_article_id_fkey!inner(*)`)
    .eq('type', 'news').eq('status', 'published').eq('visibility', 'players').eq('news.section', 'letters')
    .order('published_at', { ascending: false, nullsFirst: false }).limit(limit);
  if (res.error) return [];
  const rows = res.data as never as (Article & { news: NewsDetails | NewsDetails[] | null })[];
  return rows.map((r) => ({ ...r, news: Array.isArray(r.news) ? r.news[0] ?? null : r.news }));
}

/** DM: stories not yet printed to players, with their review state (for the newsroom strip). */
export async function listUnprintedNews(): Promise<NewsStory[]> {
  return newsInOrder(must(await supabase.from('articles')
    .select('id, slug, title, status, visibility, published_at, updated_at, news:news_stories!news_stories_article_id_fkey(review_state)')
    .eq('type', 'news').or('status.neq.published,visibility.neq.players').limit(500)) as never);
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

/** Which printed stories have a waiting revision, in what state, and when it was last saved (DM only; players get none). */
export async function listNewsPending(): Promise<Map<string, { review_state: NewsReviewState; updated_at: string }>> {
  const { data } = await supabase.from('news_pending').select('article_id, review_state, updated_at');
  return new Map((data ?? []).map((r: { article_id: string; review_state: NewsReviewState; updated_at: string }) => [r.article_id, { review_state: r.review_state, updated_at: r.updated_at }]));
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

/** A story an assistant proposed; only the DM, here, can accept it (as a private draft) or dismiss it. */
export interface NewsProposal {
  id: string; title: string; subtitle: string; summary: string; body: string; section: NewsSection; reliability: NewsReliability; reporter: string;
  dateline: string; in_world_date: string; based_on: string[]; warnings: string[]; created_at: string; created_via: string;
  /** When the assistant suggested it should appear. Only a suggestion: the DM decides. */
  suggested_publish_at: string | null;
}
const PROPOSAL_COLUMNS = 'id, title, subtitle, summary, body, section, reliability, reporter, dateline, in_world_date, based_on, warnings, created_at, created_via';
export async function listNewsProposals(): Promise<NewsProposal[]> {
  const ask = (cols: string) => supabase.from('news_proposals').select(cols).eq('status', 'pending').order('created_at', { ascending: true }).limit(50);
  let { data, error } = await ask(`${PROPOSAL_COLUMNS}, suggested_publish_at`);
  // Before migration 20261127000100 there is no suggested time: read the rest.
  if (error && (error.code === '42703' || error.code === 'PGRST204')) ({ data, error } = await ask(PROPOSAL_COLUMNS));
  // Before migration 20261116000200 the table does not exist: there are simply no proposals.
  if (error) return error.code === '42P01' || error.code === 'PGRST205' ? [] : Promise.reject(new Error(error.message));
  return (data as unknown as NewsProposal[]).map((p) => ({ ...p, suggested_publish_at: p.suggested_publish_at ?? null }));
}
/** Every headline already on the news desk (waiting proposals) or in the Gazette, for duplicate checks (DM). */
export async function listGazetteHeadlines(): Promise<string[]> {
  const [props, arts] = await Promise.all([
    supabase.from('news_proposals').select('title').eq('status', 'pending').limit(200),
    supabase.from('articles').select('title').eq('type', 'news').limit(2000),
  ]);
  return [...((props.data ?? []) as { title: string }[]), ...(must(arts) as { title: string }[])].map((r) => r.title);
}
export interface ImportedStory {
  title: string; subtitle: string; body: string; section: NewsSection; reliability: NewsReliability; reporter: string; suggested_publish_at: string | null;
}
/**
 * The DM imports stories from a Gazette package: they become waiting proposals (one statement, all or
 * nothing), then go through the same read, approve and schedule step as an assistant's. Nothing is
 * published here. Only the DM can insert proposals (Row Level Security).
 */
export async function importGazetteStories(stories: ImportedStory[]): Promise<number> {
  const rows = must(await supabase.from('news_proposals').insert(stories.map((s) => ({ ...s, summary: '', dateline: '', in_world_date: '' }))).select('id')) as { id: string }[];
  return rows.length;
}
export interface ProposalDecision { id: string; at: string | null; print_now: boolean }
/**
 * The DM, on the website: accept, approve and schedule (or print) the chosen proposals in one step. All
 * or nothing. Each step is the existing DM-only function; nothing here can run for an assistant.
 */
export async function scheduleNewsProposals(items: ProposalDecision[]): Promise<{ proposal_id: string; slug: string; state: 'scheduled' | 'printed' | 'approved'; publish_at: string | null }[]> {
  const { data, error } = await supabase.rpc('schedule_news_proposals', { p_items: items });
  if (error) throw toChronicleError(error);
  return data as never;
}
export async function acceptNewsProposal(id: string): Promise<{ id: string; slug: string }> {
  const { data, error } = await supabase.rpc('accept_news_proposal', { p_id: id });
  if (error) throw toChronicleError(error);
  return data as { id: string; slug: string };
}
export async function dismissNewsProposal(id: string) {
  must(await supabase.from('news_proposals').update({ status: 'dismissed' }).eq('id', id).select('id'));
}

export type NewsAction = 'submit' | 'approve' | 'return' | 'publish' | 'unpublish' | 'discard';
/**
 * Moves a story through review. `seen` is what the DM was looking at (the page version and, for a
 * printed story, when its waiting revision was last saved): if either changed in another tab, the
 * database refuses with CONFLICT instead of approving or printing text the DM has not seen.
 */
export async function newsTransition(articleId: string, action: NewsAction, seen: { version: number; revision?: string | null }) {
  const { data, error } = await supabase.rpc('news_transition', {
    p_article: articleId, p_action: action, p_expected_version: `v${seen.version}`, p_expected_revision: seen.revision ?? null,
  });
  if (error) throw toChronicleError(error);
  return data as { review_state: NewsReviewState; status: Article['status']; visibility: Article['visibility']; pending: NewsReviewState | null };
}

// ---------- Scheduled publication (Living World) ----------
let lastRelease = 0;
/**
 * Asks the database to print every approved story or letter whose scheduled time has passed. The
 * database clock decides; this only prompts it. Throttled, tolerant of a database that does not have
 * the function yet, and never throws: a failure just means the next visit tries again.
 */
export async function releaseDueStories(force = false): Promise<number> {
  if (!force && Date.now() - lastRelease < 30_000) return 0;
  lastRelease = Date.now();
  try {
    const { data, error } = await supabase.rpc('release_due_stories');
    return error ? 0 : Number(data ?? 0);
  } catch {
    return 0;
  }
}

/** DM: the scheduled time of each approved, unprinted story (empty before the migration). */
export async function listScheduled(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('articles').select('id, publish_at').eq('type', 'news').not('publish_at', 'is', null);
  if (error) return new Map();
  return new Map((data as { id: string; publish_at: string }[]).map((r) => [r.id, r.publish_at]));
}

/** DM, website only: schedule (future time) or cancel (null) an approved, unprinted story. */
export async function scheduleStory(articleId: string, at: Date | null, version?: number): Promise<void> {
  const { error } = await supabase.rpc('news_schedule', { p_article: articleId, p_at: at ? at.toISOString() : null, p_expected_version: version === undefined ? null : `v${version}` });
  if (error) throw toChronicleError(error);
}

/** The campaign's time zone (IANA name); 'UTC' until the DM sets one or before the migration. */
let zoneCache: Promise<string> | null = null;
export function getCampaignZone(): Promise<string> {
  zoneCache ??= (async () => {
    const { data, error } = await supabase.from('campaign_settings').select('timezone').maybeSingle();
    return error ? 'UTC' : safeZone((data as { timezone?: string } | null)?.timezone);
  })();
  return zoneCache;
}
export function clearCampaignZone() { zoneCache = null; }
/** DM: set the campaign's time zone. */
export async function setCampaignZone(tz: string) {
  must(await supabase.from('campaign_settings').update({ timezone: tz }).eq('id', true).select('title'));
  zoneCache = null;
}

// ---------- Daily Discovery ----------
const DISCOVERY_TYPES = ['lore', 'character', 'location', 'faction', 'item', 'quest', 'session', 'event', 'news'] as const;

/**
 * Today's highlighted page, or null. Only pages players can read (published, for players) count,
 * even for the DM, so what the DM sees is what players see. Row Level Security still applies.
 */
export async function dailyDiscovery(day: string): Promise<{ slug: string; title: string; type: ArticleType; summary: string; hero_media_id: string | null; news: boolean } | null> {
  const rows = must(await supabase.from('articles')
    .select('id, news:news_stories!news_stories_article_id_fkey(section)')
    .eq('status', 'published').eq('visibility', 'players').in('type', DISCOVERY_TYPES as never).limit(3000)) as never as { id: string; news: { section: string } | { section: string }[] | null }[];
  const ids = rows.filter((r) => { const n = Array.isArray(r.news) ? r.news[0] : r.news; return n?.section !== 'letters'; }).map((r) => r.id);
  const pick = pickDaily(ids, day);
  if (!pick) return null;
  const a = must(await supabase.from('articles').select('slug, title, type, summary, hero_media_id').eq('id', pick).maybeSingle());
  return a ? { ...(a as { slug: string; title: string; type: ArticleType; summary: string; hero_media_id: string | null }), news: (a as { type: string }).type === 'news' } : null;
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
  else if (opts.order === 'session') q = q.order('session_date', { ascending: true, nullsFirst: true }).order('title');
  else q = q.order('updated_at', { ascending: false });
  return must(await q.limit(opts.limit ?? 100));
}

export async function listAllArticleRefs(): Promise<(ArticleRef & { id: string; visibility: Article['visibility']; status: Article['status'] })[]> {
  return fetchAll((from, to) =>
    supabase.from('articles').select('id, slug, title, type, visibility, status').order('title').order('id').range(from, to),
  );
}

/**
 * Everything the "Tidy up the wiki" report needs, in a few parallel paged queries. No section text
 * is downloaded: sections with a non-blank body are found by a filter on the server.
 */
/**
 * Everything the DM's visibility audit needs, in parallel paged queries. Only the bodies of sections
 * that are themselves published to players are downloaded (only those can give anything away), and
 * of the summary only whether it has text is kept. The DM can read all of this already.
 */
export async function loadVisibilityAuditData(): Promise<AuditData> {
  const [articles, sections, bodies, links, redirects, fields, categories, articleCategories, media] = await Promise.all([
    fetchAll<{ id: string; slug: string; title: string; type: ArticleType; visibility: Visibility; status: PublishStatus; summary: string; subtitle: string }>((from, to) =>
      supabase.from('articles').select('id, slug, title, type, visibility, status, summary, subtitle').order('id').range(from, to)),
    fetchAll<AuditData['sections'][number]>((from, to) =>
      supabase.from('article_sections').select('id, article_id, heading, visibility, status').order('id').range(from, to)),
    fetchAll<AuditData['visibleBodies'][number]>((from, to) =>
      supabase.from('article_sections').select('id, article_id, body').eq('visibility', 'players').eq('status', 'published').order('id').range(from, to)),
    fetchAll<AuditData['links'][number]>((from, to) =>
      supabase.from('article_links').select('source_section_id, target_slug').order('source_section_id').order('target_slug').range(from, to)),
    fetchAll<AuditData['redirects'][number]>((from, to) => supabase.from('redirects').select('from_slug, article_id').order('from_slug').range(from, to)),
    fetchAll<AuditData['visibleFields'][number] & { id: string }>((from, to) =>
      supabase.from('infobox_fields').select('id, article_id, label, value').eq('visibility', 'players').order('id').range(from, to)),
    fetchAll<AuditData['categories'][number]>((from, to) => supabase.from('categories').select('id, name, visibility').order('id').range(from, to)),
    fetchAll<AuditData['articleCategories'][number]>((from, to) =>
      supabase.from('article_categories').select('article_id, category_id').order('article_id').order('category_id').range(from, to)),
    fetchAll<{ path: string; visibility: Visibility }>((from, to) => supabase.from('media').select('path, visibility').order('path').range(from, to)),
  ]);
  const readable = (a: { visibility: Visibility; status: PublishStatus }) => a.visibility === 'players' && a.status === 'published';
  return {
    media,
    articles: articles.map(({ summary, subtitle, ...a }) => ({
      ...a, has_summary: summary.trim() !== '',
      // Only text players can read is checked for leaks.
      summary: readable(a) ? summary : '', subtitle: readable(a) ? subtitle : '',
    })),
    sections, visibleBodies: bodies, links, redirects,
    visibleFields: fields.map(({ article_id, label, value }) => ({ article_id, label, value })),
    categories, articleCategories,
  };
}

/**
 * A character's family, breadth-first from the character through family connections, a few round
 * trips at most. Everything is read under the reader's Row Level Security: a hidden person or a
 * hidden connection never comes back, so it can never be drawn.
 */
export async function loadFamily(slug: string): Promise<{ rootId: string; people: FamilyPerson[]; edges: FamilyEdge[] } | null> {
  type Ref = { id: string; slug: string; title: string; hero_media_id: string | null };
  const root = must(await supabase.from('articles').select('id, slug, title, hero_media_id').eq('slug', slug).maybeSingle()) as Ref | null;
  if (!root) return null;
  const people = new Map<string, FamilyPerson>([[root.id, { id: root.id, slug: root.slug, title: root.title, heroMediaId: root.hero_media_id }]]);
  const edges = new Map<string, FamilyEdge>();
  let frontier = [root.id];
  const asked = new Set<string>();
  // Each round reaches one more step out; generations up and down plus spouses and siblings.
  for (let round = 0; round < MAX_GENERATIONS * 2 + 2 && frontier.length && people.size < MAX_PEOPLE; round++) {
    frontier.forEach((id) => asked.add(id));
    const list = frontier.join(',');
    const rows = must(await supabase
      .from('relations')
      .select('id, kind, source_article_id, target_article_id, source:articles!relations_source_article_id_fkey(id, slug, title, hero_media_id), target:articles!relations_target_article_id_fkey(id, slug, title, hero_media_id)')
      .in('kind', [...FAMILY_KINDS])
      .or(`source_article_id.in.(${list}),target_article_id.in.(${list})`)
      .limit(500)) as unknown as { id: string; kind: FamilyEdge['kind']; source: Ref | null; target: Ref | null }[];
    const next: string[] = [];
    for (const r of rows) {
      if (!r.source || !r.target) continue;
      for (const a of [r.source, r.target]) {
        if (!people.has(a.id) && people.size < MAX_PEOPLE) {
          people.set(a.id, { id: a.id, slug: a.slug, title: a.title, heroMediaId: a.hero_media_id });
        }
        if (people.has(a.id) && !asked.has(a.id) && !next.includes(a.id)) next.push(a.id);
      }
      if (people.has(r.source.id) && people.has(r.target.id)) edges.set(r.id, { kind: r.kind, source: r.source.id, target: r.target.id });
    }
    frontier = next;
  }
  return { rootId: root.id, people: [...people.values()], edges: [...edges.values()] };
}

/**
 * Material for "Recently updated": the newest section edits and publications the reader can read.
 * Players get only what Row Level Security lets them read; `readerView` narrows the DM's own view to
 * the same. Page timestamps are not used, because editing hidden text also moves them.
 */
/** `shown` is how many pages the Recent page lists (one entry each). */
export async function loadRecentChanges(readerView: boolean, shown = 200): Promise<{ pages: RecentPage[]; sections: RecentSection[] }> {
  let sq = supabase.from('article_sections').select('article_id, heading, updated_at').order('updated_at', { ascending: false }).limit(400);
  if (readerView) sq = sq.eq('visibility', 'players').eq('status', 'published');
  let pq = supabase.from('articles').select('id, slug, title, type, published_at').neq('type', 'news').not('published_at', 'is', null).order('published_at', { ascending: false }).limit(100);
  if (readerView) pq = pq.eq('visibility', 'players').eq('status', 'published');
  const [sections, published] = await Promise.all([sq, pq]);
  const secs = must(sections) as RecentSection[];
  const pages = new Map((must(published) as RecentPage[]).map((p) => [p.id, p]));
  // A page can only make the list through its sections if it is among the `shown` most recently
  // edited pages, so only those are looked up (summaries were never shown and are not fetched).
  const recentIds = [...new Set(secs.map((s) => s.article_id))].slice(0, shown);
  const missing = recentIds.filter((id) => !pages.has(id));
  if (missing.length) {
    let q = supabase.from('articles').select('id, slug, title, type, published_at').in('id', missing);
    if (readerView) q = q.eq('visibility', 'players').eq('status', 'published');
    for (const p of must(await q) as RecentPage[]) pages.set(p.id, p);
  }
  return { pages: [...pages.values()], sections: secs };
}

/**
 * Pages sharing one infobox value (label and value compared case-insensitively), plus every value
 * used under that label, for "Infobox field browse". Row Level Security decides which fields come
 * back, so a DM-only field never lists a page for a player.
 */
export async function loadFacts(label: string, value: string): Promise<{ pages: Pick<Article, 'id' | 'slug' | 'title' | 'type' | 'summary'>[]; values: string[] }> {
  const [matches, values] = await Promise.all([
    supabase.from('infobox_fields').select('article_id, article:articles(id, slug, title, type, summary)')
      .ilike('label', likeLiteral(label.trim())).ilike('value', likeLiteral(value.trim())).limit(500),
    supabase.from('infobox_fields').select('value').ilike('label', likeLiteral(label.trim())).limit(3000),
  ]);
  const rows = must(matches) as unknown as { article: Pick<Article, 'id' | 'slug' | 'title' | 'type' | 'summary'> | null }[];
  const pages = new Map(rows.filter((r) => r.article && r.article.type !== 'news').map((r) => [r.article!.id, r.article!]));
  return {
    pages: [...pages.values()].sort((a, b) => a.title.localeCompare(b.title)),
    values: (must(values) as { value: string }[]).map((v) => v.value),
  };
}

/**
 * Everything the Knowledge Graph draws, in parallel paged queries of ids and short fields only.
 * Row Level Security decides what comes back; `readerView` narrows the DM's own view to what
 * players receive ("View as a player").
 */
export async function loadGraphData(readerView: boolean): Promise<GraphInput> {
  const [pages, relations, links, redirects] = await Promise.all([
    fetchAll<GraphInput['pages'][number]>((from, to) => {
      // Gazette stories are included so a saved connection to one can be drawn; buildGraph drops the rest.
      let q = supabase.from('articles').select('id, slug, title, type');
      if (readerView) q = q.eq('visibility', 'players').eq('status', 'published');
      return q.order('id').range(from, to);
    }),
    // The id keeps two identical saved connections as two lines, as on the Connections page.
    fetchAll<GraphInput['relations'][number]>((from, to) => {
      let q = supabase.from('relations').select('id, source_article_id, target_article_id, kind, label');
      if (readerView) q = q.eq('visibility', 'players');
      return q.order('id').range(from, to);
    }),
    // Each link carries its section's page id (embedded, under the sections' own Row Level Security),
    // so the sections themselves are no longer downloaded just to map links to pages.
    fetchAll<{ target_slug: string; section: { article_id: string } | { article_id: string }[] | null }>((from, to) => {
      let q = supabase.from('article_links').select('target_slug, section:article_sections!inner(article_id)');
      if (readerView) q = q.eq('section.visibility', 'players').eq('section.status', 'published');
      return q.order('source_section_id').order('target_slug').range(from, to);
    }),
    fetchAll<GraphInput['redirects'][number]>((from, to) => {
      let q = supabase.from('redirects').select('from_slug, article_id');
      if (readerView) q = q.eq('visibility', 'players');
      return q.order('from_slug').range(from, to);
    }),
  ]);
  return {
    pages,
    relations,
    // A link belongs to exactly one section; PostgREST returns it as an object (or a one-item list).
    links: links.flatMap((l) => {
      const section = Array.isArray(l.section) ? l.section[0] : l.section;
      return section ? [{ article_id: section.article_id, target_slug: l.target_slug }] : [];
    }),
    redirects,
  };
}

/** A page's summary for the graph's preview card (Row Level Security applies). */
export async function getPagePreview(id: string): Promise<{ summary: string; hero_media_id: string | null } | null> {
  return must(await supabase.from('articles').select('summary, hero_media_id').eq('id', id).maybeSingle()) as { summary: string; hero_media_id: string | null } | null;
}

/** "Member of" connections into a faction and its sub-factions (two levels), under Row Level Security. */
export async function loadOrg(factionId: string): Promise<OrgRel[]> {
  type Row = { label: string; source: OrgRel['source'] | null; target: OrgRel['target'] | null };
  const out: OrgRel[] = [];
  let frontier = [factionId];
  const asked = new Set<string>();
  for (let level = 0; level < 3 && frontier.length; level++) {
    frontier.forEach((id) => asked.add(id));
    const rows = must(await supabase
      .from('relations')
      .select('label, source:articles!relations_source_article_id_fkey(id, slug, title, type), target:articles!relations_target_article_id_fkey(id, slug, title, type)')
      .eq('kind', 'member_of')
      .in('target_article_id', frontier)
      .limit(500)) as unknown as Row[];
    const next: string[] = [];
    for (const r of rows) {
      if (!r.source || !r.target) continue;
      out.push({ label: r.label ?? '', source: r.source, target: r.target });
      if (r.source.type === 'faction' && !asked.has(r.source.id) && !next.includes(r.source.id)) next.push(r.source.id);
    }
    frontier = next;
  }
  return out;
}

export async function loadWikiTidyData(): Promise<TidyData> {
  // Section lengths without downloading bodies: the server filters with a regular expression
  // ("." also matches line breaks in PostgreSQL; one repetition is capped at 255, hence minLengthPattern), so only ids come back. See STUB_* in wikiTidy.ts.
  const [articles, sections, withText, links, redirects, relations, long, medium, notes] = await Promise.all([
    fetchAll<TidyArticle>((from, to) =>
      supabase.from('articles').select('id, slug, title, type, summary, hero_media_id, visibility, status').order('id').range(from, to)),
    fetchAll<{ id: string; article_id: string }>((from, to) => supabase.from('article_sections').select('id, article_id').order('id').range(from, to)),
    fetchAll<{ id: string; article_id: string }>((from, to) =>
      supabase.from('article_sections').select('id, article_id').filter('body', 'match', '\\S').order('id').range(from, to)),
    fetchAll<{ source_section_id: string; target_slug: string }>((from, to) =>
      supabase.from('article_links').select('source_section_id, target_slug').order('source_section_id').order('target_slug').range(from, to)),
    fetchAll<{ from_slug: string; article_id: string }>((from, to) => supabase.from('redirects').select('from_slug, article_id').order('from_slug').range(from, to)),
    fetchAll<{ id: string; source_article_id: string; target_article_id: string }>((from, to) =>
      supabase.from('relations').select('id, source_article_id, target_article_id').order('id').range(from, to)),
    fetchAll<{ id: string; article_id: string }>((from, to) =>
      supabase.from('article_sections').select('id, article_id').filter('body', 'match', minLengthPattern(STUB_LONG_SECTION)).order('id').range(from, to)),
    fetchAll<{ id: string; article_id: string }>((from, to) =>
      supabase.from('article_sections').select('id, article_id').filter('body', 'match', minLengthPattern(STUB_MEDIUM_SECTION)).order('id').range(from, to)),
    // DM notes attached to a page: only the title is read, never the body.
    fetchAll<{ id: string; article_id: string; title: string }>((from, to) =>
      supabase.from('dm_notes').select('id, article_id, title').not('article_id', 'is', null).order('id').range(from, to)),
  ]);
  return {
    articles, sections, articlesWithText: [...new Set(withText.map((s) => s.article_id))], links, redirects, relations,
    longTextArticles: [...new Set(long.map((s) => s.article_id))],
    mediumSections: medium.map((s) => ({ article_id: s.article_id })),
    notes: notes.map((n) => ({ article_id: n.article_id, title: n.title })),
  };
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

/**
 * Search with operators (see searchQuery.ts): the remaining text goes to the database's search,
 * and kind and category filters are applied to results that already passed Row Level Security.
 * With only filters and no text, it lists the matching pages by title.
 */
export async function searchWithOperators(p: { text: string; types: ArticleType[]; categories: string[] }): Promise<SearchHit[]> {
  let hits: SearchHit[];
  if (p.text) {
    hits = must(await supabase.rpc('search_wiki', { q: p.text, max_results: 50 })) as SearchHit[];
  } else {
    let q = supabase.from('articles').select('id, slug, title, type, summary').neq('type', 'news').order('title').limit(100);
    if (p.types.length) q = q.in('type', p.types);
    hits = (must(await q) as { id: string; slug: string; title: string; type: ArticleType; summary: string }[])
      .map((a) => ({ article_id: a.id, slug: a.slug, title: a.title, type: a.type, summary: a.summary, snippet: null, rank: 0 }) as SearchHit);
  }
  if (p.types.length) hits = hits.filter((h) => p.types.includes(h.type));
  if (p.categories.length) {
    // Match by address or by name ("Silver Quill" and silver-quill both work).
    const all = must(await supabase.from('categories').select('id, slug, name').limit(2000)) as { id: string; slug: string; name: string }[];
    const cats = all.filter((c) => p.categories.includes(c.slug) || p.categories.includes(slugify(c.name)));
    const inCats = cats.length
      ? new Set((must(await supabase.from('article_categories').select('article_id').in('category_id', cats.map((c) => c.id)).limit(5000)) as { article_id: string }[]).map((r) => r.article_id))
      : new Set<string>();
    hits = hits.filter((h) => inCats.has(h.article_id));
  }
  return hits;
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

/**
 * The places an article is connected to and the maps that show them, for the "place" chips. Three
 * small queries, all under the reader's Row Level Security: a location, pin or map the reader may
 * not see simply returns no row, so it can never become a chip.
 */
export async function getPlaceChips(articleId: string, title: string): Promise<{ places: PlaceChip[]; maps: MapChip[] }> {
  const rels = must(
    await supabase
      .from('relations')
      .select('kind, source_article_id, target_article_id, source:articles!relations_source_article_id_fkey(id, slug, title, type), target:articles!relations_target_article_id_fkey(id, slug, title, type)')
      .or(`source_article_id.eq.${articleId},target_article_id.eq.${articleId}`)
      .limit(300),
  ) as unknown as PlaceRelationRow[];
  const places = placeChips(articleId, rels);
  const ids = [articleId, ...places.map((p) => p.id)];
  const [markers, maps] = await Promise.all([
    supabase.from('map_markers').select('id, article_id, map:maps(slug, title)').in('article_id', ids).limit(200),
    supabase.from('maps').select('slug, title, article_id').in('article_id', ids).limit(100),
  ]);
  return {
    places,
    maps: mapChips(articleId, title, places, must(markers) as unknown as PlaceMarkerRow[], must(maps) as PlaceMapRow[]),
  };
}

/**
 * One random page the reader may read, for "Wander". Never downloads the wiki: an exact count
 * (HEAD request) under Row Level Security, then single rows by offset in a stable (slug) order.
 * News stories are left out (they live under /news). `readerView` narrows the DM's own view to
 * what players receive. Returns null when there is nothing to wander to.
 */
export async function wanderToSlug(opts: { type?: ArticleType; readerView: boolean; recent: string[] }): Promise<string | null> {
  const base = () => {
    let q = supabase.from('articles').select('slug').neq('type', 'news');
    if (opts.type) q = q.eq('type', opts.type);
    if (opts.readerView) q = q.eq('visibility', 'players').eq('status', 'published');
    return q;
  };
  let counter = supabase.from('articles').select('id', { count: 'exact', head: true }).neq('type', 'news');
  if (opts.type) counter = counter.eq('type', opts.type);
  if (opts.readerView) counter = counter.eq('visibility', 'players').eq('status', 'published');
  const { count, error } = await counter;
  if (error) throw new Error(error.message);
  return pickWander({
    count: count ?? 0,
    recent: opts.recent,
    at: async (n) => {
      const rows = must(await base().order('slug').range(n, n)) as { slug: string }[];
      return rows[0]?.slug ?? null;
    },
  });
}

/** Every title and type the reader can see, titles only (no bodies), to know which letters of the A-Z index have entries. */
export async function listIndexTitles(): Promise<{ title: string; type: ArticleType }[]> {
  return fetchAll((from, to) => supabase.from('articles').select('title, type').neq('type', 'news').order('title').order('id').range(from, to));
}

export type IndexEntry = Pick<Article, 'id' | 'slug' | 'type' | 'title' | 'summary' | 'visibility' | 'status'>;

/**
 * Pages for the A-Z index, from the server: one letter (titles starting with it; "#" = not A-Z) or
 * titles containing `contains`, optionally of one type. Row Level Security decides what comes back.
 */
export async function listIndexEntries(opts: { letter?: string; contains?: string; type?: ArticleType | null }): Promise<IndexEntry[]> {
  const build = (from: number, to: number) => {
    let q = supabase.from('articles').select('id, slug, type, title, summary, visibility, status').neq('type', 'news');
    if (opts.type) q = q.eq('type', opts.type);
    if (opts.contains) q = q.ilike('title', `%${likeLiteral(opts.contains)}%`);
    else if (opts.letter === '#') q = q.filter('title', 'match', '^[^A-Za-z]');
    else if (opts.letter) q = q.ilike('title', `${opts.letter}%`);
    return q.order('title').order('id').range(from, to);
  };
  // A search is capped (it is for finding a page, not listing); a letter is read in full.
  if (opts.contains) return must(await build(0, 99)) as IndexEntry[];
  return fetchAll<IndexEntry>(build);
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

/** Drops a link that stopped working (expired, or the file's visibility changed). */
export function forgetMediaUrl(url: string) {
  for (const [path, hit] of signedCache) if (hit.url === url) signedCache.delete(path);
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


// ---------------------------------------------------------------------------------------------
// Photos. Every new photo is stored twice: an optimized, uncropped "source" (sources/<id>.webp,
// always DM-only, kept for cropping again later) and the picture pages show (media/<id>.webp).
// Both files are uploaded first; register_photo then records them in one transaction and only if
// the files really arrived. If anything fails, the uploaded files are removed again.
// ---------------------------------------------------------------------------------------------
export interface PhotoCrop { x: number; y: number; w: number; h: number; aspect: string }
export interface UploadProgress { stage: 'uploading' | 'saving'; fraction: number }

/** Uploads one file to the private bucket, reporting progress (supabase-js cannot). */
async function uploadFile(path: string, blob: Blob, onProgress?: (fraction: number) => void): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You are signed out. Sign in again and retry.');
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${MEDIA_BUCKET}/${path}`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader('content-type', 'image/webp');
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('cache-control', 'max-age=3600');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = '';
      try {
        message = (JSON.parse(xhr.responseText) as { message?: string }).message ?? '';
      } catch {
        /* not JSON */
      }
      reject(new Error(xhr.status === 413 || /size/i.test(message) ? 'This picture is too large to upload.' : `The upload was refused${message ? `: ${message}` : ''}.`));
    };
    xhr.onerror = () => reject(new Error('The upload failed. Check the connection and try again.'));
    xhr.ontimeout = xhr.onerror;
    xhr.timeout = 120_000;
    xhr.send(blob);
  });
}

/**
 * Removes files that were (or may have been) uploaded but are not in the library. Never throws.
 * Storage reports failures in its result rather than by throwing, so both are checked, and a path
 * counts as handled only when it was removed or is confirmed absent. Returns what is left over.
 */
async function discardFiles(paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  const bucket = supabase.storage.from(MEDIA_BUCKET);
  let removed = new Set<string>();
  try {
    const { data, error } = await bucket.remove(paths);
    if (!error) removed = new Set((data ?? []).map((o) => o.name));
  } catch {
    /* fall through: check each path below */
  }
  const left: string[] = [];
  for (const path of paths.filter((p) => !removed.has(p))) {
    try {
      const { data: there, error } = await bucket.exists(path);
      if (error || there) left.push(path); // an unknown answer counts as still there
    } catch {
      left.push(path);
    }
  }
  return left;
}

const LEFTOVER_NOTE = ' A partly uploaded file could not be removed; Media library › Unfinished uploads can remove it later.';

export interface SavePhotoInput {
  display: { blob: Blob; width: number; height: number };
  /** A new full-frame source, or the id of the existing one when cropping again. */
  source?: { blob: Blob; width: number; height: number } | { id: string };
  crop?: PhotoCrop;
  alt: string;
  credit?: string;
  originalName?: string;
  onProgress?: (p: UploadProgress) => void;
}

/** DM, website only: uploads and registers a photo. Starts DM-only; pages decide who sees it. */
export async function savePhoto(input: SavePhotoInput): Promise<Media & { source_id: string | null }> {
  const displayPath = `media/${crypto.randomUUID()}.webp`;
  const newSource = input.source && 'blob' in input.source ? input.source : null;
  const sourcePath = newSource ? `sources/${crypto.randomUUID()}.webp` : null;
  const total = input.display.blob.size + (newSource?.blob.size ?? 0);
  let done = 0;
  // Every path is recorded BEFORE its upload starts: a timeout or network error does not prove
  // the file did not arrive, so cleanup must consider every attempted path.
  const attempted: string[] = [];
  const progress = (bytes: number) => (f: number) => input.onProgress?.({ stage: 'uploading', fraction: total ? (done + f * bytes) / total : 1 });
  try {
    if (newSource && sourcePath) {
      attempted.push(sourcePath);
      await uploadFile(sourcePath, newSource.blob, progress(newSource.blob.size));
      done += newSource.blob.size;
    }
    attempted.push(displayPath);
    await uploadFile(displayPath, input.display.blob, progress(input.display.blob.size));
    input.onProgress?.({ stage: 'saving', fraction: 1 });
    const { data, error } = await supabase.rpc('register_photo', {
      p: {
        display: { path: displayPath, alt: input.alt.slice(0, 500), width: input.display.width, height: input.display.height, bytes: input.display.blob.size },
        ...(newSource && sourcePath ? { source: { path: sourcePath, width: newSource.width, height: newSource.height, bytes: newSource.blob.size } } : {}),
        ...(input.source && 'id' in input.source ? { source_id: input.source.id } : {}),
        ...(input.crop ? { crop: input.crop } : {}),
        credit: (input.credit ?? '').slice(0, 200),
        original_name: (input.originalName ?? '').slice(0, 200),
      },
    });
    if (error) throw toChronicleError(error);
    return data as Media & { source_id: string | null };
  } catch (err) {
    // The registration may have succeeded even though its answer was lost: then it is a success.
    const registered = await supabase.from('media').select('id, path, alt, width, height, visibility').eq('path', displayPath).maybeSingle();
    if (registered.data) {
      const source = sourcePath ? await supabase.from('media').select('id').eq('path', sourcePath).maybeSingle() : null;
      return { ...(registered.data as Media), source_id: (source?.data as { id: string } | null)?.id ?? null };
    }
    // Nothing refers to these files, so Storage allows removing them.
    const left = await discardFiles(attempted);
    if (left.length) throw new Error(`${err instanceof Error ? err.message : 'The upload failed.'}${LEFTOVER_NOTE}`, { cause: err });
    throw err;
  }
}

/** DM: an already-resized image without a separate source (map images). */
export async function uploadMedia(blob: Blob, info: { alt: string; width: number; height: number }): Promise<Media> {
  return savePhoto({ display: { blob, width: info.width, height: info.height }, alt: info.alt });
}

export interface MediaItem extends Media {
  credit: string;
  original_name: string;
  bytes: number | null;
  created_at: string;
  source: { id: string; path: string; width: number | null; height: number | null } | null;
  crop: PhotoCrop | null;
}

const ITEM_COLUMNS =
  'id, path, alt, width, height, visibility, bytes, created_at, private:media_private!media_private_media_id_fkey(credit, original_name, crop, source:media!media_private_source_media_id_fkey(id, path, width, height))';
interface RawPrivate { credit: string; original_name: string; crop: PhotoCrop | null; source: MediaItem['source'] }
type RawItem = Omit<MediaItem, 'credit' | 'original_name' | 'source' | 'crop'> & { private: RawPrivate | RawPrivate[] | null };
const toItem = (r: RawItem): MediaItem => {
  const p = Array.isArray(r.private) ? r.private[0] : r.private;
  const { private: _omit, ...rest } = r;
  void _omit;
  return { ...rest, credit: p?.credit ?? '', original_name: p?.original_name ?? '', crop: p?.crop ?? null, source: p?.source ?? null };
};

/** DM: every picture in the library (not the private full-frame sources), newest first. */
export async function listMedia(): Promise<MediaItem[]> {
  const rows = must(await supabase.from('media').select(ITEM_COLUMNS).eq('role', 'display').order('created_at', { ascending: false }).limit(1000)) as unknown as RawItem[];
  return rows.map(toItem);
}

export async function getMediaItem(id: string): Promise<MediaItem | null> {
  const row = must(await supabase.from('media').select(ITEM_COLUMNS).eq('id', id).maybeSingle()) as unknown as RawItem | null;
  return row ? toItem(row) : null;
}

export async function getMediaByPath(path: string): Promise<MediaItem | null> {
  const row = must(await supabase.from('media').select(ITEM_COLUMNS).eq('path', path).maybeSingle()) as unknown as RawItem | null;
  return row ? toItem(row) : null;
}

export async function updateMedia(id: string, patch: { alt?: string; credit?: string }): Promise<void> {
  if (patch.alt !== undefined) must(await supabase.from('media').update({ alt: patch.alt.slice(0, 500) }).eq('id', id).select('id').single());
  if (patch.credit !== undefined) {
    must(await supabase.from('media_private').upsert({ media_id: id, credit: patch.credit.slice(0, 200) }, { onConflict: 'media_id' }).select('media_id').single());
  }
}

/** The file itself, for adjusting a library picture. Only works for files the reader may see. */
export async function downloadMedia(path: string): Promise<Blob> {
  return must(await supabase.storage.from(MEDIA_BUCKET).download(path));
}

export interface MediaUse {
  label: string;
  to: string;
}

/** DM: where each library file is used (by media id), so nothing in use can be deleted by mistake. */
export async function mediaUsage(): Promise<Map<string, MediaUse[]>> {
  const [heroes, maps, settings, sections, pending, media] = await Promise.all([
    supabase.from('articles').select('slug, title, type, hero_media_id').not('hero_media_id', 'is', null),
    supabase.from('maps').select('slug, title, media_id').not('media_id', 'is', null),
    supabase.from('campaign_settings').select('banner_media_id').limit(1),
    supabase.from('article_sections').select('body, article:articles!inner(slug, title, type)').like('body', '%media:%'),
    supabase.from('news_pending').select('story, article:articles!inner(slug, title)'),
    supabase.from('media').select('id, path'),
  ]);
  for (const r of [heroes, maps, settings, sections, pending, media]) if (r.error) throw new Error(r.error.message);
  const byPath = new Map((media.data ?? []).map((m: { id: string; path: string }) => [m.path, m.id]));
  const out = new Map<string, MediaUse[]>();
  const add = (id: string | null | undefined, use: MediaUse) => {
    if (!id) return;
    const list = out.get(id) ?? [];
    if (!list.some((u) => u.label === use.label)) list.push(use);
    out.set(id, list);
  };
  const pageLink = (a: { slug: string; type?: string }) => (a.type === 'news' ? `/news/${a.slug}` : `/wiki/${a.slug}`);
  for (const a of (heroes.data ?? []) as { slug: string; title: string; type: string; hero_media_id: string }[]) {
    add(a.hero_media_id, { label: `Main picture of “${a.title}”`, to: pageLink(a) });
  }
  for (const m of (maps.data ?? []) as { slug: string; title: string; media_id: string }[]) {
    add(m.media_id, { label: `Map “${m.title}”`, to: `/maps/${m.slug}` });
  }
  add((settings.data?.[0] as { banner_media_id: string | null } | undefined)?.banner_media_id, { label: 'Main page banner', to: '/' });
  const pathsIn = (text: string) => [...text.matchAll(/media:([a-z0-9][a-z0-9/_.-]*[a-z0-9])/g)].map((m) => m[1]!);
  for (const s of (sections.data ?? []) as unknown as { body: string; article: { slug: string; title: string; type: string } }[]) {
    for (const p of pathsIn(s.body)) add(byPath.get(p), { label: `In the text of “${s.article.title}”`, to: pageLink(s.article) });
  }
  for (const r of (pending.data ?? []) as unknown as { story: unknown; article: { slug: string; title: string } }[]) {
    const story = r.story as { article?: { hero_media_id?: string | null } };
    add(story.article?.hero_media_id, { label: `Waiting revision of “${r.article.title}”`, to: `/dm/news/edit/${r.article.slug}` });
    for (const p of pathsIn(JSON.stringify(r.story))) add(byPath.get(p), { label: `Waiting revision of “${r.article.title}”`, to: `/dm/news/edit/${r.article.slug}` });
  }
  return out;
}

/**
 * DM: removes a library picture that nothing uses, then its full-frame source if no other
 * picture still uses it. The database refuses deleting anything in use, whatever the caller.
 */
export async function deleteMedia(item: { id: string; path: string; source?: { id: string; path: string } | null }): Promise<{ leftover: number }> {
  const { error } = await supabase.from('media').delete().eq('id', item.id);
  if (error) throw toChronicleError(error);
  signedCache.delete(item.path);
  const left = await discardFiles([item.path]);
  if (item.source) {
    // Refused (and kept) while another picture still uses this full-size copy.
    const { error: sourceError } = await supabase.from('media').delete().eq('id', item.source.id);
    if (!sourceError) left.push(...(await discardFiles([item.source.path])));
  }
  return { leftover: left.length };
}

/** DM: files in the bucket that are not in the library and older than ten minutes (interrupted uploads). */
export async function listUnfinishedUploads(): Promise<string[]> {
  const cutoff = Date.now() - 10 * 60_000;
  const found: string[] = [];
  for (const folder of ['media', 'sources']) {
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).list(folder, { limit: 1000, sortBy: { column: 'created_at', order: 'asc' } });
    if (error) throw new Error(error.message);
    for (const o of data ?? []) {
      if (o.id && Date.parse(o.created_at ?? '') < cutoff) found.push(`${folder}/${o.name}`);
    }
  }
  if (!found.length) return [];
  const known = new Set<string>();
  for (let i = 0; i < found.length; i += 200) {
    const { data } = await supabase.from('media').select('path').in('path', found.slice(i, i + 200));
    for (const r of (data ?? []) as { path: string }[]) known.add(r.path);
  }
  return found.filter((p) => !known.has(p));
}

/** DM: removes unfinished uploads; returns how many could not be removed. */
export async function removeUnfinishedUploads(paths: string[]): Promise<number> {
  return (await discardFiles(paths)).length;
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

// ---------- Staged lore imports (DM only; see src/lib/loreImport.ts) ----------
export interface ImportBatchRow {
  id: string; label: string; source_name: string; status: 'staged' | 'saving' | 'done' | 'abandoned';
  created_at: string; updated_at: string; created_via: string;
}
export interface ImportBatch extends ImportBatchRow { staged: StagedImport; decisions: Decisions; progress: ProgressEntry[] }

export async function listImportBatches(): Promise<(ImportBatchRow & { entries: number })[]> {
  const rows = must(await supabase.from('import_batches').select('id, label, source_name, status, created_at, updated_at, created_via, items:staged->items').order('created_at', { ascending: false }).limit(100)) as unknown as (ImportBatchRow & { items: unknown[] | null })[];
  return rows.map(({ items, ...r }) => ({ ...r, entries: Array.isArray(items) ? items.length : 0 }));
}

export async function getImportBatch(id: string): Promise<ImportBatch | null> {
  const { data, error } = await supabase.from('import_batches').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const d = data as ImportBatch;
  const none: Decisions = { items: {}, relations: {}, types: {}, categories: {} };
  return { ...d, decisions: { ...none, ...d.decisions } };
}

export async function stageImportBatch(label: string, sourceName: string, staged: StagedImport): Promise<string> {
  const row = must(await supabase.from('import_batches').insert({ label, source_name: sourceName.slice(0, 300), staged }).select('id').single()) as { id: string };
  return row.id;
}

export async function updateImportBatch(id: string, patch: Partial<Pick<ImportBatch, 'decisions' | 'progress' | 'status'>>) {
  must(await supabase.from('import_batches').update(patch).eq('id', id).select('id'));
}

export async function deleteImportBatch(id: string) {
  must(await supabase.from('import_batches').delete().eq('id', id).select('id'));
}

/** The wiki as the DM sees it, for matching an import against existing pages. */
export async function loadWikiIndex(): Promise<WikiIndex> {
  const [articles, fields, redirects, categories] = await Promise.all([
    fetchAll((from, to) => supabase.from('articles').select('id, slug, title, type, version, visibility, status').order('id').range(from, to)),
    fetchAll((from, to) => supabase.from('infobox_fields').select('article_id, label, value').order('id').range(from, to)),
    fetchAll((from, to) => supabase.from('redirects').select('from_slug, article_id').order('from_slug').range(from, to)),
    fetchAll((from, to) => supabase.from('categories').select('id, slug, name').order('id').range(from, to)),
  ]);
  return { articles, fields, redirects, categories } as WikiIndex;
}

/** Saved change sets of this import (found by key), to recover parts saved but not recorded. */
export async function importChangeSets(prefix: string) {
  return must(await supabase.from('change_sets').select('id, idempotency_key, result').like('idempotency_key', `${prefix}%`).order('created_at')) as { id: string; idempotency_key: string; result: { created?: string[]; updated?: string[] } | null }[];
}
