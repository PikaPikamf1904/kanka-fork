// Reads everything the DM's knowledge export needs, with the DM's own session.
//
// Security: there is no export endpoint and no service key. Every query below is a plain read
// under the caller's Row Level Security, the same rules that guard the wiki. A player or a stranger
// running this code gets only what the wiki already shows them (and the DM check below stops them
// first). Nothing is written.
//
// Completeness: every table is counted first and then read in ordered pages; if the rows read do
// not match the count (something changed during the export, or a server-side row cap cut a page
// short), the export stops with an error instead of producing a file with silent gaps.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExportData } from './types.ts';

/** The only tables this export reads. Private journals, scratchpads and the investigation board
 * are deliberately absent (tests check this list). */
export const TABLES_READ = [
  'campaign_members', // the caller's own role only
  'campaign_settings',
  'articles',
  'article_sections',
  'infobox_fields',
  'relations',
  'categories',
  'article_categories',
  'redirects',
  'timeline_events',
  'provenance',
  'dm_notes',
  'news_stories',
  'maps',
  'map_markers',
  'mysteries',
  'clues',
  'clue_hints',
  'clue_discoveries', // clue ids only, to count discoveries; never who found them
  'research_collections', // the DM's own collections only
  'research_notes',
  'research_sources',
] as const;
export type ExportTable = (typeof TABLES_READ)[number];

export class ExportRefused extends Error {}

export interface LoadOptions {
  userId: string;
  pageSize?: number;
  onProgress?: (done: number, total: number, table: string) => void;
}

type Query = ReturnType<ReturnType<SupabaseClient['from']>['select']>;

/** Optional text columns may be null in the database; the export treats a missing text as empty. */
function text<T>(rows: T[], columns: (keyof T)[]): T[] {
  for (const row of rows) for (const c of columns) if (row[c] == null) (row[c] as unknown) = '';
  return rows;
}

export async function loadExportData(client: SupabaseClient, opts: LoadOptions): Promise<ExportData> {
  const pageSize = opts.pageSize ?? 1000;
  const read = new Set<string>();
  const from = (table: ExportTable) => {
    read.add(table);
    return client.from(table);
  };

  // Only the DM may export. The database also enforces this for every DM-only row below.
  const me = await from('campaign_members').select('role, revoked_at').eq('user_id', opts.userId).maybeSingle();
  // Signed out: the database refuses the table outright.
  if (me.error?.code === '42501') throw new ExportRefused('Only the DM can export Chronicle.');
  if (me.error) throw new Error(me.error.message);
  if (!me.data || me.data.role !== 'dm' || me.data.revoked_at) throw new ExportRefused('Only the DM can export Chronicle.');

  const steps = 21; // settings and the twenty tables below
  let done = 0;
  const step = (table: string) => opts.onProgress?.(++done, steps, table);

  /** Every row of a table, in a stable order, checked against an exact count. */
  async function all<T>(table: ExportTable, columns: string, order: string[], filter?: (q: Query) => Query): Promise<T[]> {
    let head = from(table).select(columns, { count: 'exact', head: true }) as unknown as Query;
    if (filter) head = filter(head);
    const counted = await head;
    if (counted.error) throw new Error(`${table}: ${counted.error.message}`);
    const expected = counted.count ?? 0;
    const rows: T[] = [];
    // Advance by the rows actually received, so a server-side row cap below pageSize still reads everything.
    while (rows.length < expected) {
      let q = from(table).select(columns) as unknown as Query;
      if (filter) q = filter(q);
      for (const o of order) q = q.order(o) as unknown as Query;
      const page = await q.range(rows.length, rows.length + pageSize - 1);
      if (page.error) throw new Error(`${table}: ${page.error.message}`);
      const batch = (page.data ?? []) as T[];
      if (batch.length === 0) break;
      rows.push(...batch);
    }
    if (rows.length !== expected) {
      throw new Error(`Chronicle changed while exporting (${table}: expected ${expected} rows, read ${rows.length}). Please try again.`);
    }
    step(table);
    return rows;
  }

  const settings = await from('campaign_settings').select('title, tagline, overview, current_status').maybeSingle();
  if (settings.error) throw new Error(`campaign_settings: ${settings.error.message}`);
  step('campaign_settings');

  const articles = text(await all<ExportData['articles'][number]>('articles',
    'id, slug, type, title, subtitle, summary, visibility, status, is_party_member, importance, session_date, source_ref, created_at, updated_at, published_at', ['id']), ['slug', 'title', 'subtitle', 'summary', 'source_ref']);
  const sections = text(await all<ExportData['sections'][number]>('article_sections', 'id, article_id, position, heading, body, visibility, status', ['id']), ['heading', 'body']);
  const fields = text(await all<ExportData['fields'][number]>('infobox_fields', 'id, article_id, position, label, value, visibility', ['id']), ['label', 'value']);
  const relations = text(await all<ExportData['relations'][number]>('relations', 'id, source_article_id, target_article_id, kind, label, visibility, source_ref', ['id']), ['kind', 'label', 'source_ref']);
  const categories = text(await all<ExportData['categories'][number]>('categories', 'id, slug, name, kind, description, visibility', ['id']), ['slug', 'name', 'kind', 'description']);
  const articleCategories = await all<ExportData['articleCategories'][number]>('article_categories', 'article_id, category_id', ['article_id', 'category_id']);
  const redirects = await all<ExportData['redirects'][number]>('redirects', 'from_slug, article_id, visibility', ['from_slug']);
  const timeline = text(await all<ExportData['timeline'][number]>('timeline_events', 'id, title, date_label, sort_key, body, article_id, visibility, status', ['id']), ['title', 'date_label', 'body']);
  const provenance = text(await all<ExportData['provenance'][number]>('provenance', 'id, article_id, section_id, field_id, kind, reference', ['id']), ['reference']);
  const dmNotes = text(await all<ExportData['dmNotes'][number]>('dm_notes', 'id, article_id, title, body, created_at, updated_at', ['id']), ['title', 'body']);
  const news = text(await all<ExportData['news'][number]>('news_stories',
    'article_id, section, reliability, reporter, dateline, in_world_date, issue_number, review_state, corrects_article_id', ['article_id']), ['section', 'reliability', 'reporter', 'dateline', 'in_world_date', 'review_state']);
  const maps = text(await all<ExportData['maps'][number]>('maps', 'id, slug, title, description, article_id, parent_map_id, visibility, status', ['id']), ['slug', 'title', 'description']);
  const markers = text(await all<ExportData['markers'][number]>('map_markers', 'id, map_id, label, description, article_id, visibility', ['id']), ['label', 'description']);
  const mysteries = text(await all<ExportData['mysteries'][number]>('mysteries', 'id, title, player_title, summary, dm_notes, status', ['id']), ['title', 'player_title', 'summary', 'dm_notes', 'status']);
  const clues = text(await all<ExportData['clues'][number]>('clues',
    'id, mystery_id, kind, title, body, source_line, attach_article_id, requires_clue_id, release_at, released_at, position', ['id']), ['kind', 'title', 'body', 'source_line']);
  const hints = text(await all<ExportData['hints'][number]>('clue_hints', 'id, clue_id, position, body, release_at, released_at', ['id']), ['body']);
  const discoveries = await all<{ clue_id: string }>('clue_discoveries', 'clue_id', ['clue_id', 'user_id']);
  // Knowledge Studio: the DM's own collections only. Players' collections, even shared ones, are theirs.
  const collections = text(await all<ExportData['research']['collections'][number]>('research_collections', 'id, title, description, shared',
    ['id'], (q) => q.eq('user_id', opts.userId) as unknown as Query), ['title', 'description']);
  const ids = collections.map((c) => c.id);
  const own = (q: Query) => q.in('collection_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']) as unknown as Query;
  const researchNotes = text(await all<ExportData['research']['notes'][number]>('research_notes', 'id, collection_id, title, body', ['id'], own), ['title', 'body']);
  const sources = text(await all<ExportData['research']['sources'][number]>('research_sources', 'id, collection_id, article_id, topic, annotation, excerpt, position', ['id'], own), ['topic', 'annotation', 'excerpt']);

  const discovered = new Map<string, number>();
  for (const d of discoveries) discovered.set(d.clue_id, (discovered.get(d.clue_id) ?? 0) + 1);

  return {
    generatedAt: new Date().toISOString(),
    campaign: settings.data ? text([settings.data], ['title', 'tagline', 'overview', 'current_status'])[0]! : null,
    articles, sections, fields, relations, categories, articleCategories, redirects, timeline, provenance, dmNotes, news,
    maps, markers, mysteries, clues, hints,
    discoveries: Object.fromEntries(discovered),
    research: { collections, notes: researchNotes, sources },
    tablesRead: [...read].sort(),
  };
}
