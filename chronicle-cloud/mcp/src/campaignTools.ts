// Campaign knowledge, session preparation, wiki maintenance, journal and Gazette drafting, and
// staged lore imports for the Chronicle MCP server. Same rules as tools.ts: every read runs with
// the caller's own identity, nothing here publishes, and every write is a preview the DM approves
// on the website (or a staged import the DM reviews there).
import { ToolError, type Db } from './db.ts';
import type { Tool } from './tools.ts';
import type { ChangeOp, Preview } from '../../src/lib/changeSetTypes.ts';
import { RELIABILITY, SECTIONS, STAFF, type NewsReliability, type NewsSection } from '../../src/lib/gazette.ts';
import { analyzeImport, CANON_LABEL, decisionOf, IMPORT_LIMITS, parseImportFiles, type Decisions, type StagedImport, type WikiIndex } from '../../src/lib/loreImport.ts';
import { wikiLinkTargets } from '../../src/lib/lorePackage.ts';

type Json = Record<string, unknown>;
export interface CampaignCtx { db: Db; who: { is_dm: boolean }; reviewBase: string }

const bad = (message: string): never => {
  throw new ToolError('VALIDATION_FAILED', message);
};
const text = (v: unknown, name: string, max: number, required = false): string => {
  if (v === undefined || v === null || v === '') return required ? bad(`${name} is required.`) : '';
  if (typeof v !== 'string') return bad(`${name} must be text.`);
  if (v.length > max) return bad(`${name} is too long (limit ${max}).`);
  return v;
};
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slugOf = (s: string) => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const enc = encodeURIComponent;
/** Keep answers small: long text is cut at a word boundary and says so. */
const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 20))} …`;
};
const isPublic = (a: { visibility: string; status: string }) => a.visibility === 'players' && a.status === 'published';

interface Art { id: string; slug: string; title: string; type: string; summary: string; visibility: string; status: string; version: number; is_party_member: boolean; session_date?: string | null; updated_at?: string }
const ART = 'id,slug,title,type,summary,visibility,status,version,is_party_member,updated_at';

/** Quest states as the DM writes them in the "Status" field. Anything else is reported as written. */
const DONE = /\b(complete[d]?|done|finished|resolved|succeeded|success|failed|abandoned|closed|over)\b/i;
const OPEN = /\b(open|active|ongoing|in progress|current|started|pending|unfinished|accepted)\b/i;
function questState(status: string | null): 'open' | 'finished' | 'unknown' {
  if (!status) return 'unknown';
  if (DONE.test(status)) return 'finished';
  if (OPEN.test(status)) return 'open';
  return 'unknown';
}

async function fieldsFor(db: Db, ids: string[], labels: string[]) {
  if (ids.length === 0) return new Map<string, Record<string, string>>();
  // In batches: hundreds of ids in one address would be refused as too long.
  const parts: string[][] = [];
  for (let i = 0; i < ids.length; i += 80) parts.push(ids.slice(i, i + 80));
  const rows = (await Promise.all(parts.map((part) => db.get<{ article_id: string; label: string; value: string }>(`infobox_fields?select=article_id,label,value&article_id=in.(${part.join(',')})&label=in.(${labels.map(enc).join(',')})`)))).flat();
  const out = new Map<string, Record<string, string>>();
  for (const r of rows) out.set(r.article_id, { ...out.get(r.article_id), [r.label]: r.value });
  return out;
}

async function quests(db: Db, limit: number) {
  const rows = await db.get<Art>(`articles?select=${ART}&type=eq.quest&order=updated_at.desc,id&limit=${limit}`);
  const f = await fieldsFor(db, rows.map((r) => r.id), ['Status', 'Given by', 'Objective', 'Reward']);
  return rows.map((r) => {
    const x = f.get(r.id) ?? {};
    return { slug: r.slug, title: r.title, summary: clip(r.summary, 300), status_as_written: x.Status ?? null, state: questState(x.Status ?? null),
      given_by: x['Given by'] ?? null, objective: x.Objective ?? null, visibility: r.visibility, publication: r.status };
  });
}

async function latestSessions(db: Db, n: number) {
  const rows = await db.get<Art>(`articles?select=${ART},session_date&type=eq.session&order=session_date.desc.nullslast,updated_at.desc,id&limit=${n}`);
  return rows.map((r) => ({ slug: r.slug, title: r.title, session_date: r.session_date ?? null, summary: clip(r.summary, 400), visibility: r.visibility, publication: r.status }));
}

async function party(db: Db) {
  const rows = await db.get<Art>(`articles?select=${ART}&type=eq.character&is_party_member=is.true&order=title&limit=50`);
  const f = await fieldsFor(db, rows.map((r) => r.id), ['Race', 'Class', 'Level', 'Status']);
  return rows.map((r) => ({ slug: r.slug, title: r.title, summary: clip(r.summary, 200), ...Object.fromEntries(Object.entries(f.get(r.id) ?? {}).map(([k, v]) => [k.toLowerCase(), v])) }));
}

/** The wiki as the DM sees it, paged, for duplicate checks and import analysis. */
/** Every row of a query, 1000 at a time: the hosted Data API returns at most 1000 per request. The path needs a stable order. */
async function getAll<T>(db: Db, path: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const page = await db.get<T>(`${path}&limit=1000&offset=${offset}`);
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

export async function loadWikiIndex(db: Db): Promise<WikiIndex> {
  const all = <T>(path: string) => getAll<T>(db, path);
  const [articles, fields, redirects, categories] = await Promise.all([
    all<WikiIndex['articles'][number]>('articles?select=id,slug,title,type,version,visibility,status&order=id'),
    all<WikiIndex['fields'][number]>('infobox_fields?select=article_id,label,value&order=id'),
    all<WikiIndex['redirects'][number]>('redirects?select=from_slug,article_id&order=from_slug'),
    all<WikiIndex['categories'][number]>('categories?select=id,slug,name&order=id'),
  ]);
  return { articles, fields, redirects, categories };
}

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const STAGE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

export const CAMPAIGN_TOOLS: Tool[] = [
  {
    name: 'chronicle_campaign_overview', scope: 'chronicle:read', dmOnly: false, annotations: RO,
    description: 'Where the campaign stands, as recorded in Chronicle: where the party is, the current situation, the party members, the latest session journals and the quests still open. Use it for "where is the party?", "what happened last session?" or "what are we doing?". Only what you may read; anything not recorded is null, never guessed.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { sessions: { type: 'integer', minimum: 1, maximum: 10, default: 3 } } },
    async run(a: Json, ctx: CampaignCtx) {
      const n = typeof a.sessions === 'number' && a.sessions >= 1 && a.sessions <= 10 ? Math.floor(a.sessions) : 3;
      const [settings, members, sessions, q] = await Promise.all([
        ctx.db.get<{ title: string; tagline: string; current_status: string }>('campaign_settings?select=title,tagline,current_status'),
        party(ctx.db), latestSessions(ctx.db, n), quests(ctx.db, 1000),
      ]);
      const s = settings[0];
      // The DM always gets the location; a member only when the page is published to players.
      const place = (await ctx.db.rpc<{ id: string }[]>('campaign_location', {}))[0];
      const loc = place ? (await ctx.db.get<Art>(`articles?select=${ART}&id=eq.${place.id}`))[0] ?? null : null;
      return {
        campaign: s ? { title: s.title, tagline: s.tagline } : null,
        party_location: loc ? { slug: loc.slug, title: loc.title, summary: clip(loc.summary, 400) } : null,
        party_location_note: loc ? null : 'No current location that you can see is recorded.',
        current_situation: s?.current_status || null,
        party: members,
        latest_sessions: sessions,
        open_quests: q.filter((x) => x.state === 'open').slice(0, 15),
        open_quest_count: q.filter((x) => x.state === 'open').length,
        quests_with_unrecorded_status: q.filter((x) => x.state === 'unknown').slice(0, 15).map((x) => ({ slug: x.slug, title: x.title, status_as_written: x.status_as_written })),
        more: 'Use chronicle_list_quests for every quest.',
      };
    },
  },
  {
    name: 'chronicle_list_quests', scope: 'chronicle:read', dmOnly: false, annotations: RO,
    description: 'Quest pages you may read, with the status, objective and quest-giver recorded on each. state is "open", "finished" or "unknown" (no status, or a status Chronicle cannot read as either); unknown is never treated as open or finished. Use it for "what quests are unfinished?".',
    inputSchema: { type: 'object', additionalProperties: false, properties: { state: { enum: ['open', 'finished', 'unknown', 'not_finished', 'all'], default: 'not_finished' }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } } },
    async run(a: Json, ctx: CampaignCtx) {
      const state = (['open', 'finished', 'unknown', 'not_finished', 'all'] as const).find((x) => x === a.state) ?? (a.state === undefined ? 'not_finished' : bad('state is not valid.'));
      const limit = typeof a.limit === 'number' && a.limit >= 1 && a.limit <= 200 ? Math.floor(a.limit) : 50;
      const all = await quests(ctx.db, 1000);
      const pick = all.filter((x) => state === 'all' || (state === 'not_finished' ? x.state !== 'finished' : x.state === state));
      return { state, count: pick.length, quests: pick.slice(0, limit), note: state === 'not_finished' ? 'Includes quests whose status is not recorded (state "unknown").' : null };
    },
  },
  {
    name: 'chronicle_topic', scope: 'chronicle:read', dmOnly: false, annotations: RO,
    description: 'Everything Chronicle records about one subject ("find everything about Kalaman"): the page itself (best match by address or title), its sections in short, its facts and connections, the pages that link to it, timeline events, and other pages that mention the name, each with a short snippet. Only what you may read.',
    inputSchema: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', maxLength: 200 }, max_mentions: { type: 'integer', minimum: 1, maximum: 30, default: 10 } } },
    async run(a: Json, ctx: CampaignCtx) {
      const name = text(a.name, 'name', 200, true).trim();
      const max = typeof a.max_mentions === 'number' && a.max_mentions >= 1 && a.max_mentions <= 30 ? Math.floor(a.max_mentions) : 10;
      const slug = slugOf(name);
      const words = name.replace(/[*%,()]/g, ' ').trim();
      const [bySlug, byTitle, redirect, hits] = await Promise.all([
        SLUG.test(slug) ? ctx.db.get<Art>(`articles?select=${ART}&slug=eq.${slug}`) : Promise.resolve([]),
        ctx.db.get<Art>(`articles?select=${ART}&title=ilike.${enc(words)}&limit=1`),
        SLUG.test(slug) ? ctx.db.get<{ article: Art | null }>(`redirects?select=article:articles(${ART})&from_slug=eq.${slug}`) : Promise.resolve([]),
        ctx.db.rpc<{ article_id: string; slug: string; title: string; type: string; snippet: string | null }[]>('search_wiki', { q: name, max_results: 30 }),
      ]);
      const page = bySlug[0] ?? byTitle[0] ?? redirect[0]?.article ?? (hits[0] ? (await ctx.db.get<Art>(`articles?select=${ART}&id=eq.${hits[0].article_id}`))[0] : undefined) ?? null;
      const mentions = hits.filter((h) => h.article_id !== page?.id).slice(0, max).map((h) => ({ slug: h.slug, title: h.title, type: h.type, snippet: h.snippet ? clip(h.snippet.replace(/[⟦⟧]/g, ''), 240) : null }));
      if (!page) return { found: false, note: 'No page matches this name that you can read.', mentions };
      const [sections, facts, rels, backlinks, events] = await Promise.all([
        ctx.db.get<{ heading: string; body: string; visibility: string; status: string }>(`article_sections?select=heading,body,visibility,status&article_id=eq.${page.id}&order=position,id`),
        ctx.db.get<{ label: string; value: string; visibility: string }>(`infobox_fields?select=label,value,visibility&article_id=eq.${page.id}&order=position,id`),
        ctx.db.get<{ kind: string; label: string; source_article_id: string; source: { slug: string; title: string } | null; target: { slug: string; title: string } | null }>(
          `relations?select=kind,label,source_article_id,source:articles!relations_source_article_id_fkey(slug,title),target:articles!relations_target_article_id_fkey(slug,title)&or=(source_article_id.eq.${page.id},target_article_id.eq.${page.id})&limit=100`),
        ctx.db.rpc<{ slug: string; title: string; type: string }[]>('backlinks', { p_article: page.id }),
        ctx.db.get<{ title: string; date_label: string; body: string }>(`timeline_events?select=title,date_label,body&article_id=eq.${page.id}&order=sort_key&limit=20`),
      ]);
      return {
        found: true,
        page: { slug: page.slug, title: page.title, type: page.type, summary: page.summary, visibility: page.visibility, publication: page.status, version: `v${page.version}` },
        sections: sections.map((s) => ({ heading: s.heading, text: clip(s.body, 500), ...(ctx.who.is_dm ? { player_visible: isPublic(page) && isPublic(s) } : {}) })),
        facts: facts.map((f) => ({ label: f.label, value: f.value })),
        connections: rels.flatMap((r) => {
          const out = r.source_article_id === page.id;
          const other = out ? r.target : r.source;
          return other ? [{ direction: out ? 'from this page' : 'to this page', kind: r.kind, label: r.label, slug: other.slug, title: other.title }] : [];
        }),
        linked_from: backlinks.slice(0, 30),
        timeline: events.map((e) => ({ title: e.title, when: e.date_label, text: clip(e.body, 200) })),
        mentions,
      };
    },
  },
  {
    name: 'chronicle_session_prep', scope: 'chronicle:read', dmOnly: true, annotations: RO,
    description: 'DM only. Material for preparing the next session, drawn only from what is recorded: the latest session journals, quests that are not finished, where the party is and what is connected to that place, the party, and the pages the latest journals link to (people and places likely to matter). Never predicts or invents what happens next.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { sessions: { type: 'integer', minimum: 1, maximum: 10, default: 3 } } },
    async run(a: Json, ctx: CampaignCtx) {
      const n = typeof a.sessions === 'number' && a.sessions >= 1 && a.sessions <= 10 ? Math.floor(a.sessions) : 3;
      const [settings, place, sessions, q, members] = await Promise.all([
        ctx.db.get<{ current_status: string }>('campaign_settings?select=current_status'),
        ctx.db.rpc<{ id: string }[]>('campaign_location', {}),
        ctx.db.get<Art>(`articles?select=${ART},session_date&type=eq.session&order=session_date.desc.nullslast,updated_at.desc,id&limit=${n}`),
        quests(ctx.db, 1000), party(ctx.db),
      ]);
      const sections = sessions.length ? await ctx.db.get<{ article_id: string; heading: string; body: string }>(`article_sections?select=article_id,heading,body&article_id=in.(${sessions.map((s) => s.id).join(',')})&order=position`) : [];
      const linked = [...new Set(sections.flatMap((s) => wikiLinkTargets(s.body)).map(slugOf))].filter((t) => SLUG.test(t)).slice(0, 60);
      const linkedPages = linked.length ? await ctx.db.get<Art>(`articles?select=${ART}&slug=in.(${linked.join(',')})`) : [];
      const locId = place[0]?.id;
      const [loc, near] = locId ? await Promise.all([
        ctx.db.get<Art>(`articles?select=${ART}&id=eq.${locId}`),
        ctx.db.get<{ kind: string; source: { slug: string; title: string; type: string } | null; target: { slug: string; title: string; type: string } | null; source_article_id: string }>(
          `relations?select=kind,source_article_id,source:articles!relations_source_article_id_fkey(slug,title,type),target:articles!relations_target_article_id_fkey(slug,title,type)&or=(source_article_id.eq.${locId},target_article_id.eq.${locId})&limit=50`),
      ]) : [[], []];
      const byType = (t: string) => linkedPages.filter((p) => p.type === t).map((p) => ({ slug: p.slug, title: p.title, summary: clip(p.summary, 200) }));
      return {
        latest_sessions: sessions.map((s) => ({ slug: s.slug, title: s.title, session_date: s.session_date ?? null, summary: clip(s.summary, 500),
          sections: sections.filter((x) => x.article_id === s.id).map((x) => ({ heading: x.heading, text: clip(x.body, 400) })) })),
        current_location: loc[0] ? { slug: loc[0].slug, title: loc[0].title, summary: clip(loc[0].summary, 300) } : null,
        connected_to_location: near.flatMap((r) => { const o = r.source_article_id === locId ? r.target : r.source; return o ? [{ kind: r.kind, slug: o.slug, title: o.title, type: o.type }] : []; }),
        current_situation: settings[0]?.current_status || null,
        unfinished_quests: q.filter((x) => x.state !== 'finished').slice(0, 25).map((x) => ({ slug: x.slug, title: x.title, state: x.state, status_as_written: x.status_as_written, objective: x.objective, given_by: x.given_by })),
        unfinished_quest_count: q.filter((x) => x.state !== 'finished').length,
        party: members,
        mentioned_in_latest_sessions: { characters: byType('character'), locations: byType('location'), factions: byType('faction'), items: byType('item'), other: linkedPages.filter((p) => !['character', 'location', 'faction', 'item'].includes(p.type)).map((p) => ({ slug: p.slug, title: p.title, type: p.type })) },
        missing_links_in_latest_sessions: linked.filter((t) => !linkedPages.some((p) => p.slug === t)),
        note: 'Only recorded material. Nothing here predicts what happens next.',
      };
    },
  },
  {
    name: 'chronicle_wiki_health', scope: 'chronicle:read', dmOnly: true, annotations: RO,
    description: 'DM only. A maintenance report, suggestions only (saves nothing): pages that may be duplicates, broken wiki links, pages nothing links to or connects with, pages without a summary or category, characters missing basic facts, contradictory connections (for example allies and enemies at once), and facts recorded twice with different values on one page. Use it for "find contradictions in my campaign notes" and general tidying.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { max_per_check: { type: 'integer', minimum: 1, maximum: 100, default: 25 } } },
    async run(a: Json, ctx: CampaignCtx) {
      const max = typeof a.max_per_check === 'number' && a.max_per_check >= 1 && a.max_per_check <= 100 ? Math.floor(a.max_per_check) : 25;
      const idx = await loadWikiIndex(ctx.db);
      const pages = idx.articles.filter((x) => x.type !== 'news');
      const [summaries, cats, rels, sections] = await Promise.all([
        getAll<{ id: string; summary: string }>(ctx.db, 'articles?select=id,summary&order=id'),
        getAll<{ article_id: string }>(ctx.db, 'article_categories?select=article_id&order=article_id,category_id'),
        getAll<{ source_article_id: string; target_article_id: string; kind: string }>(ctx.db, 'relations?select=source_article_id,target_article_id,kind&order=id'),
        getAll<{ article_id: string; body: string }>(ctx.db, 'article_sections?select=article_id,body&body=like.*%5B%5B*&order=id'),
      ]);
      const bySlug = new Map(idx.articles.map((x) => [x.slug, x]));
      const byId = new Map(idx.articles.map((x) => [x.id, x]));
      const redirects = new Set(idx.redirects.map((r) => r.from_slug));
      const ref = (id: string) => { const p = byId.get(id); return p ? { slug: p.slug, title: p.title } : null; };
      // Possible duplicates: the same title, or titles that differ only in punctuation or "the".
      const key = (t: string) => t.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
      const groups = new Map<string, typeof pages>();
      for (const p of pages) groups.set(key(p.title), [...(groups.get(key(p.title)) ?? []), p]);
      const duplicates = [...groups.values()].filter((g) => g.length > 1).map((g) => g.map((p) => ({ slug: p.slug, title: p.title, type: p.type })));
      const broken: Json[] = [];
      const linkedTo = new Set<string>();
      for (const s of sections) {
        for (const t of new Set(wikiLinkTargets(s.body).map(slugOf))) {
          if (bySlug.has(t)) linkedTo.add(bySlug.get(t)!.id);
          else if (!redirects.has(t)) broken.push({ from: ref(s.article_id), target_slug: t });
        }
      }
      const connected = new Set(rels.flatMap((r) => [r.source_article_id, r.target_article_id]));
      const pairs = new Map<string, Set<string>>();
      for (const r of rels) {
        const k = [r.source_article_id, r.target_article_id].sort().join('|');
        pairs.set(k, new Set([...(pairs.get(k) ?? []), r.kind]));
      }
      const OPPOSED: [string, string][] = [['ally_of', 'enemy_of'], ['ally', 'enemy'], ['friend_of', 'enemy_of'], ['member_of', 'enemy_of'], ['loves', 'hates']];
      const contradictions = [...pairs.entries()].flatMap(([k, kinds]) => OPPOSED.filter(([x, y]) => kinds.has(x) && kinds.has(y)).map(([x, y]) => {
        const [p1, p2] = k.split('|');
        return { pages: [ref(p1!), ref(p2!)], kinds: [x, y], why: 'Connected as both at once.' };
      }));
      const fieldConflicts: Json[] = [];
      const seenFields = new Map<string, Map<string, Set<string>>>();
      for (const f of idx.fields) {
        const m = seenFields.get(f.article_id) ?? new Map<string, Set<string>>();
        const l = f.label.trim().toLowerCase();
        m.set(l, new Set([...(m.get(l) ?? []), f.value.trim()]));
        seenFields.set(f.article_id, m);
      }
      for (const [id, m] of seenFields) for (const [label, values] of m) if (values.size > 1) fieldConflicts.push({ page: ref(id), label, values: [...values].sort() });
      const summaryOf = new Map(summaries.map((x) => [x.id, x.summary]));
      const catSet = new Set(cats.map((c) => c.article_id));
      const charFacts = new Map<string, Set<string>>();
      for (const f of idx.fields) charFacts.set(f.article_id, new Set([...(charFacts.get(f.article_id) ?? []), f.label.toLowerCase()]));
      const cap = <T>(xs: T[]) => ({ count: xs.length, items: xs.slice(0, max) });
      return {
        note: 'Suggestions only. Nothing was changed. Fix them on the website, or ask for a preview of specific edits.',
        possible_duplicates: cap(duplicates),
        broken_links: cap(broken),
        contradictory_connections: cap(contradictions),
        facts_recorded_twice_with_different_values: cap(fieldConflicts),
        orphan_pages: cap(pages.filter((p) => !linkedTo.has(p.id) && !connected.has(p.id) && p.type !== 'session').map((p) => ({ slug: p.slug, title: p.title, type: p.type }))),
        pages_without_summary: cap(pages.filter((p) => !(summaryOf.get(p.id) ?? '').trim()).map((p) => ({ slug: p.slug, title: p.title }))),
        pages_without_category: cap(pages.filter((p) => !catSet.has(p.id)).map((p) => ({ slug: p.slug, title: p.title, type: p.type }))),
        characters_missing_basic_facts: cap(pages.filter((p) => p.type === 'character').map((p) => ({ slug: p.slug, title: p.title, missing: ['race', 'class', 'status'].filter((l) => !charFacts.get(p.id)?.has(l)) })).filter((x) => x.missing.length)),
      };
    },
  },
  {
    name: 'chronicle_draft_session_journal', scope: 'chronicle:preview', dmOnly: true, annotations: RO,
    description: 'DM only. Turns notes the DM supplied into a proposed session journal (a new private draft page, or new private sections on an existing journal) and returns a preview to approve in Chronicle; it does not save. Use only what the notes say: no invented dialogue, dates or events. A play date is included only if given. Pages it should link to are checked; links to pages that do not exist are reported.',
    inputSchema: { type: 'object', required: ['title', 'recap'], additionalProperties: false, properties: {
      title: { type: 'string', maxLength: 200 }, slug: { type: 'string' }, session_date: { type: 'string', description: 'YYYY-MM-DD, only if the DM gave it.' },
      summary: { type: 'string', maxLength: 2000 }, recap: { type: 'string', maxLength: 30000, description: 'What happened, from the notes.' },
      discoveries: { type: 'string', maxLength: 10000 }, open_questions: { type: 'string', maxLength: 10000 },
      source: { type: 'string', maxLength: 300, description: 'Where the notes came from, e.g. "DM notes 2026-11-12".' },
      certainty: { enum: ['confirmed', 'uncertain'], default: 'uncertain' }, existing_slug: { type: 'string', description: 'Add to this existing journal instead of creating one.' }, expected_version: { type: 'string' } } },
    async run(a: Json, ctx: CampaignCtx) {
      const title = text(a.title, 'title', 200, true).trim();
      const recap = text(a.recap, 'recap', 30000, true);
      const date = text(a.session_date, 'session_date', 10);
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) bad('session_date must be YYYY-MM-DD, and only if the DM gave it.');
      const certainty = a.certainty === 'confirmed' ? 'confirmed' : 'uncertain';
      const provenance = { kind: certainty === 'confirmed' ? 'dm_confirmed' : 'transcript_uncertain', reference: text(a.source, 'source', 300) || 'Notes supplied to an assistant' } as const;
      const parts: [string, string][] = ([['Recap', recap], ['Discoveries', text(a.discoveries, 'discoveries', 10000)], ['Open questions', text(a.open_questions, 'open_questions', 10000)]] as [string, string][]).filter(([, b]) => b.trim());
      const existing = text(a.existing_slug, 'existing_slug', 160);
      const slug = existing || text(a.slug, 'slug', 160) || slugOf(title);
      if (!SLUG.test(slug)) bad('Could not make a page address; pass slug.');
      const changes: ChangeOp[] = [];
      if (!existing) {
        changes.push({ operation: 'create_article', slug, title, type: 'session', summary: text(a.summary, 'summary', 2000) });
        if (date) changes.push({ operation: 'patch_article', slug, fields: { session_date: date } });
      }
      for (const [heading, body] of parts) changes.push({ operation: 'upsert_section', article_slug: slug, heading: existing ? `${heading} (proposed)` : heading, body, provenance });
      const links = [...new Set(parts.flatMap(([, b]) => wikiLinkTargets(b)).map(slugOf))].filter((t) => SLUG.test(t));
      const found = links.length ? await ctx.db.get<{ slug: string }>(`articles?select=slug&slug=in.(${links.join(',')})`) : [];
      const preview = await ctx.db.rpc<Preview>('preview_change_set', { p_change_set: { label: `Session journal: ${title}`.slice(0, 200), changes, ...(existing ? { expected_versions: { [slug]: text(a.expected_version, 'expected_version', 20, true) } } : {}) } });
      return { ...preview, review_url: preview.preview_id ? `${ctx.reviewBase}/dm/review/${preview.preview_id}` : null, certainty, missing_link_targets: links.filter((t) => !found.some((f) => f.slug === t)),
        next_step: preview.preview_id ? 'Ask the DM to open review_url and approve; then call chronicle_apply_changes.' : 'Resolve the conflicts and preview again.' };
    },
  },
  {
    name: 'chronicle_draft_gazette_story', scope: 'chronicle:preview', dmOnly: true, annotations: STAGE,
    description: 'DM only. Files a proposed Goblin Gazette story (headline, deck, opening, body, section, reporter, kind of reporting) on the news desk. It saves no story and can never print: the DM accepts it there as a private draft (or dismisses it), then reviews and prints it as usual. Base it on documented campaign events; mark rumours with reliability "rumor".',
    inputSchema: { type: 'object', required: ['headline', 'body', 'section', 'reliability', 'reporter'], additionalProperties: false, properties: {
      headline: { type: 'string', maxLength: 200 }, deck: { type: 'string', maxLength: 200 }, opening: { type: 'string', maxLength: 2000 }, body: { type: 'string', maxLength: 30000 },
      section: { enum: SECTIONS.map((s) => s.key) }, reliability: { enum: Object.keys(RELIABILITY) }, reporter: { enum: STAFF.map((s) => s.key) },
      dateline: { type: 'string', maxLength: 120 }, in_world_date: { type: 'string', maxLength: 120, description: 'Only if documented.' }, based_on: { type: 'array', maxItems: 20, items: { type: 'string' }, description: 'Addresses of the wiki pages the story is based on.' } } },
    async run(a: Json, ctx: CampaignCtx) {
      const section = SECTIONS.find((s) => s.key === a.section)?.key ?? bad('section is not valid.');
      const reliability = (Object.keys(RELIABILITY) as NewsReliability[]).find((r) => r === a.reliability) ?? bad('reliability is not valid.');
      const reporter = STAFF.find((s) => s.key === a.reporter) ?? bad('reporter is not one of the Gazette staff.');
      const based = Array.isArray(a.based_on) ? a.based_on.filter((x): x is string => typeof x === 'string' && SLUG.test(x)).slice(0, 20) : [];
      const pages = based.length ? await ctx.db.get<Art>(`articles?select=${ART}&slug=in.(${based.join(',')})`) : [];
      const body = text(a.body, 'body', 30000, true);
      const warnings: string[] = [];
      if (pages.length === 0) warnings.push('No source pages were given: check every fact against the campaign record.');
      if (based.some((b) => !pages.some((p) => p.slug === b))) warnings.push(`Unknown source pages: ${based.filter((b) => !pages.some((p) => p.slug === b)).join(', ')}.`);
      const hidden = pages.filter((p) => !isPublic(p));
      if (hidden.length) warnings.push(`Based on pages players cannot see (${hidden.map((p) => p.slug).join(', ')}): printing this story could reveal them.`);
      if (reliability === 'confirmed' && section === 'rumors') warnings.push('A story in Rumors is marked as confirmed; check the kind of reporting.');
      const row = await ctx.db.insert<{ id: string }>('news_proposals', {
        title: text(a.headline, 'headline', 200, true).trim(), subtitle: text(a.deck, 'deck', 200), summary: text(a.opening, 'opening', 2000), body,
        section: section as NewsSection, reliability, reporter: reporter.key, dateline: text(a.dateline, 'dateline', 120), in_world_date: text(a.in_world_date, 'in_world_date', 120),
        based_on: pages.map((p) => p.slug), warnings: warnings.map((w) => clip(w, 290)), // the database refuses items over 300 characters
      }, 'id');
      return { proposal_id: row.id, review_url: `${ctx.reviewBase}/dm/news#proposals`, reporter: { name: reporter.name, voice: reporter.voice }, reliability_label: RELIABILITY[reliability].label,
        based_on: pages.map((p) => ({ slug: p.slug, title: p.title, player_visible: isPublic(p) })), warnings,
        next_step: 'Tell the DM the proposal is waiting on the news desk (review_url). Only the DM can accept it as a draft, review it and print it.' };
    },
  },
  {
    name: 'chronicle_stage_import', scope: 'chronicle:preview', dmOnly: true, annotations: STAGE,
    description: `DM only. Stages lore files for import (Markdown or JSON lore packages; up to ${IMPORT_LIMITS.files} files, ${IMPORT_LIMITS.totalBytes / 1_000_000} MB, ${IMPORT_LIMITS.items} entries) and returns an analysis: new pages, matches with existing pages, possible duplicates, conflicting facts, suggested connections and categories. It writes nothing to the wiki: the DM reviews the batch at review_url, approves entries one by one or in groups, and saves them there as private drafts. Markdown may use front matter (title, type, canon: confirmed|uncertain|rumor|planned, tags, aliases); unmarked material is treated as unconfirmed.`,
    inputSchema: { type: 'object', required: ['label', 'files'], additionalProperties: false, properties: {
      label: { type: 'string', maxLength: 200 }, files: { type: 'array', minItems: 1, maxItems: IMPORT_LIMITS.files, items: { type: 'object', required: ['name', 'text'], properties: { name: { type: 'string', maxLength: 300 }, text: { type: 'string' } } } } } },
    async run(a: Json, ctx: CampaignCtx) {
      const label = text(a.label, 'label', 200, true).trim();
      if (!Array.isArray(a.files) || a.files.length < 1) bad('files must list at least one file.');
      const files = (a.files as unknown[]).map((f, i) => {
        const r = (typeof f === 'object' && f !== null ? f : bad(`file ${i + 1} is not an object.`)) as Json;
        return { name: text(r.name, `file ${i + 1} name`, 300, true), text: text(r.text, `file ${i + 1} text`, IMPORT_LIMITS.fileBytes, true) };
      });
      const staged = parseImportFiles(files);
      if (staged.items.length === 0) throw new ToolError('VALIDATION_FAILED', staged.errors[0]?.message ?? 'No entries could be read.', { errors: staged.errors.slice(0, 20) });
      const row = await ctx.db.insert<{ id: string }>('import_batches', { label, source_name: files.map((f) => f.name).join(', ').slice(0, 300), staged }, 'id');
      const analysis = analyzeImport(staged, await loadWikiIndex(ctx.db));
      return { batch_id: row.id, review_url: `${ctx.reviewBase}/dm/import/${row.id}`, totals: analysis.totals, not_readable: staged.errors.slice(0, 50), notices: staged.warnings.slice(0, 50),
        next_step: 'Ask the DM to open review_url. They choose what to keep and save it there; you cannot save an import.' };
    },
  },
  {
    name: 'chronicle_list_import_batches', scope: 'chronicle:read', dmOnly: true, annotations: RO,
    description: 'DM only. Staged lore imports, newest first: label, files, state, how many entries, and how far saving has got.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } } },
    async run(a: Json, ctx: CampaignCtx) {
      const limit = typeof a.limit === 'number' && a.limit >= 1 && a.limit <= 50 ? Math.floor(a.limit) : 20;
      const rows = await ctx.db.get<{ id: string; label: string; source_name: string; status: string; created_at: string; created_via: string; entries: number | null; saved_parts: number | null }>(
        `import_batches?select=id,label,source_name,status,created_at,created_via,entries:staged->items,saved_parts:progress&order=created_at.desc&limit=${limit}`);
      return { batches: rows.map((r) => ({ batch_id: r.id, label: r.label, files: r.source_name, state: r.status, created_at: r.created_at, staged_by: r.created_via === 'web' ? 'website' : 'assistant',
        entries: Array.isArray(r.entries) ? r.entries.length : 0, saved_parts: Array.isArray(r.saved_parts) ? r.saved_parts.length : 0, review_url: `${ctx.reviewBase}/dm/import/${r.id}` })) };
    },
  },
  {
    name: 'chronicle_get_import_batch', scope: 'chronicle:read', dmOnly: true, annotations: RO,
    description: 'DM only. One staged import, compared with the wiki as it is now: each entry with its proposed type (and how sure), canon level, whether it would be a new page or additions to an existing one, possible duplicates, conflicting facts, links to missing pages, the DM\'s current choice, and suggested connections. Filter to focus on what needs attention.',
    inputSchema: { type: 'object', required: ['batch_id'], additionalProperties: false, properties: { batch_id: { type: 'string' }, filter: { enum: ['all', 'conflicts', 'duplicates', 'new', 'existing', 'uncertain_type'], default: 'all' }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 }, offset: { type: 'integer', minimum: 0, default: 0 } } },
    async run(a: Json, ctx: CampaignCtx) {
      const id = text(a.batch_id, 'batch_id', 64, true);
      if (!UUID.test(id)) bad('batch_id is not valid.');
      const rows = await ctx.db.get<{ id: string; label: string; status: string; staged: StagedImport; decisions: Decisions; progress: { status: string; slugs: string[] }[] }>(`import_batches?select=id,label,status,staged,decisions,progress&id=eq.${id}`);
      const b = rows[0] ?? (() => { throw new ToolError('NOT_FOUND', 'No such import batch.'); })();
      const done = new Set(b.progress.filter((p) => p.status === 'applied').flatMap((p) => p.slugs));
      const analysis = analyzeImport(b.staged, await loadWikiIndex(ctx.db), done);
      const items = new Map(b.staged.items.map((i) => [i.slug, i]));
      const decisions: Decisions = { items: b.decisions.items ?? {}, relations: b.decisions.relations ?? {}, types: b.decisions.types ?? {} };
      const filter = (['all', 'conflicts', 'duplicates', 'new', 'existing', 'uncertain_type'] as const).find((f) => f === a.filter) ?? 'all';
      const keep = analysis.items.filter((x) => filter === 'all' || (filter === 'conflicts' && x.conflicts.length > 0) || (filter === 'duplicates' && (x.match || x.similar_in_import.length > 0 || x.similar_in_wiki.length > 0))
        || (filter === 'new' && x.action === 'create') || (filter === 'existing' && x.action === 'add_to_existing') || (filter === 'uncertain_type' && items.get(x.slug)!.typeConfidence !== 'high'));
      const limit = typeof a.limit === 'number' && a.limit >= 1 && a.limit <= 200 ? Math.floor(a.limit) : 50;
      const offset = typeof a.offset === 'number' && a.offset >= 0 ? Math.floor(a.offset) : 0;
      return {
        batch_id: b.id, label: b.label, state: b.status, totals: analysis.totals, filter, review_url: `${ctx.reviewBase}/dm/import/${b.id}`,
        entries: keep.slice(offset, offset + limit).map((x) => {
          const it = items.get(x.slug)!;
          return { slug: x.slug, title: it.title, source: it.source, type: decisions.types[x.slug] ?? it.type, type_confidence: it.typeConfidence, type_reason: it.typeReason, canon: CANON_LABEL[it.canon],
            proposal: x.action === 'create' ? 'new page' : x.action === 'imported' ? 'already saved' : `additions to "${x.match!.title}"`, match_reason: x.match?.why ?? null,
            similar_in_import: x.similar_in_import, similar_existing_pages: x.similar_in_wiki, conflicts: x.conflicts, missing_links: x.links.missing, missing_categories: x.categories.missing,
            dm_choice: x.action === 'imported' ? 'saved' : decisionOf(decisions, x.slug, x) === 'approve' ? 'approved' : 'not approved' };
        }),
        next_offset: offset + limit < keep.length ? offset + limit : null,
        suggested_connections: analysis.relations.slice(0, 100).map((r) => ({ source: r.source, target: r.target, kind: r.kind, basis: r.basis === 'stated' ? 'stated in the files' : 'from a link (suggestion)' })),
        note: 'Only the DM can approve and save, on the website (review_url).',
      };
    },
  },
];
