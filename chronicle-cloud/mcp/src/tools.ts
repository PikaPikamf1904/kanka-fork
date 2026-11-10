// Chronicle MCP tools. Every tool runs with the caller's own database identity (see db.ts), so a
// tool can never return or change more than that person could on the website. Write tools only
// create previews or apply previews a human approved on the website; nothing here can publish,
// delete a page, change members or run SQL.
import type { ChangeOp, ChangeSet, ErrorCode, Preview, ProvenanceKind } from '../../src/lib/changeSetTypes.ts';
import { packageToChangeSet, parsePackage, wikiLinkTargets } from '../../src/lib/lorePackage.ts';
import { ToolError, type Db } from './db.ts';

export const SCOPES = ['chronicle:read', 'chronicle:preview', 'chronicle:draft_write', 'chronicle:revision_restore'] as const;
export type Scope = (typeof SCOPES)[number];

export interface Whoami { principal_id: string; role: 'dm' | 'player' | null; is_dm: boolean; is_member: boolean; mfa_satisfied: boolean; client_id: string }
export interface Ctx { db: Db; who: Whoami; scopes: Scope[]; reviewBase: string }

type Json = Record<string, unknown>;
interface Tool {
  name: string;
  description: string;
  scope: Scope;
  dmOnly: boolean;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: false };
  inputSchema: Json;
  run(args: Json, ctx: Ctx): Promise<Json>;
}

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PROVENANCE: ProvenanceKind[] = ['table_confirmed', 'dm_confirmed', 'official_reference', 'planned_unplayed', 'transcript_uncertain'];

const bad = (message: string): never => {
  throw new ToolError('VALIDATION_FAILED', message);
};
const str = (v: unknown, name: string, max: number, required = true): string => {
  if (v === undefined || v === null || v === '') return required ? bad(`${name} is required.`) : '';
  if (typeof v !== 'string') return bad(`${name} must be text.`);
  if (v.length > max) return bad(`${name} is too long (limit ${max}).`);
  return v;
};
const slugArg = (v: unknown, name = 'slug'): string => {
  const s = str(v, name, 160);
  return SLUG.test(s) ? s : bad(`${name} is not a valid page address.`);
};
const limitArg = (v: unknown, dflt = 20): number => {
  if (v === undefined || v === null) return dflt;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100 ? v : bad('limit must be a whole number from 1 to 100.');
};
const cursorArg = (v: unknown): number => {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'string' && /^o\d{1,6}$/.test(v) ? Number(v.slice(1)) : NaN;
  return Number.isFinite(n) ? n : bad('cursor is not valid.');
};
const enumArg = <T extends string>(v: unknown, name: string, values: readonly T[], dflt: T): T =>
  v === undefined || v === null || v === '' ? dflt : values.includes(v as T) ? (v as T) : bad(`${name} must be one of: ${values.join(', ')}.`);
const page = <T>(rows: T[], offset: number, limit: number) => ({ items: rows.slice(0, limit), next_cursor: rows.length > limit ? `o${offset + limit}` : null });
const enc = encodeURIComponent;
const version = (n: unknown) => `v${String(n)}`;
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface ArticleRow { id: string; slug: string; type: string; title: string; subtitle: string; summary: string; visibility: string; status: string; is_party_member: boolean; hero_media_id: string | null; updated_at: string; version: number; source_ref?: string | null }
const ARTICLE = 'id,slug,type,title,subtitle,summary,visibility,status,is_party_member,hero_media_id,updated_at,version';

async function loadArticle(db: Db, slug: string, type?: string): Promise<ArticleRow> {
  const rows = await db.get<ArticleRow>(`articles?select=${ARTICLE}&slug=eq.${enc(slug)}${type ? `&type=eq.${type}` : ''}`);
  // The same answer whether the page is missing or hidden from this caller.
  if (rows.length === 0) throw new ToolError('NOT_FOUND', 'No such page.');
  return rows[0]!;
}

async function bundle(db: Db, a: ArticleRow, withRelations: boolean) {
  const [sections, infobox, cats, relations] = await Promise.all([
    db.get<Json>(`article_sections?select=id,heading,body,position,visibility,status&article_id=eq.${a.id}&order=position,id`),
    db.get<Json>(`infobox_fields?select=id,label,value,position,visibility&article_id=eq.${a.id}&order=position,id`),
    db.get<{ categories: { slug: string; name: string; kind: string } | null }>(`article_categories?select=categories(slug,name,kind)&article_id=eq.${a.id}`),
    withRelations
      ? db.get<{ id: string; kind: string; label: string; visibility: string; source_article_id: string; source: { slug: string; title: string; type: string } | null; target: { slug: string; title: string; type: string } | null }>(
          `relations?select=id,kind,label,visibility,source_article_id,source:articles!relations_source_article_id_fkey(slug,title,type),target:articles!relations_target_article_id_fkey(slug,title,type)&or=(source_article_id.eq.${a.id},target_article_id.eq.${a.id})&order=id`)
      : Promise.resolve([]),
  ]);
  return {
    article: { ...a, version: version(a.version) },
    sections,
    infobox_fields: infobox,
    tags: cats.map((c) => c.categories).filter((c) => c !== null),
    relations: relations.flatMap((r) => {
      const out = r.source_article_id === a.id;
      const other = out ? r.target : r.source;
      // The other end is filtered by the database; an unreadable end drops the whole relation.
      return other ? [{ id: r.id, kind: r.kind, label: r.label, visibility: r.visibility, direction: out ? 'out' : 'in', target_slug: other.slug, target_title: other.title, target_type: other.type }] : [];
    }),
  };
}

const reviewUrl = (ctx: Ctx, previewId: unknown) => (typeof previewId === 'string' ? `${ctx.reviewBase}/dm/review/${previewId}` : null);

async function previewOf(ctx: Ctx, cs: ChangeSet): Promise<Json> {
  const p = await ctx.db.rpc<Preview>('preview_change_set', { p_change_set: cs });
  return { ...p, review_url: reviewUrl(ctx, p.preview_id), next_step: p.preview_id ? 'Ask the DM to open review_url in Chronicle and approve. Then call chronicle_apply_changes with preview_id, digest and a new idempotency_key.' : 'Resolve the conflicts (read the current versions) and preview again.' };
}

function cleanOps(raw: unknown): ChangeOp[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 5000) return bad('change_set.changes must be a list of 1 to 5000 changes.');
  // Shape and content are validated by the database engine; here only strip what must never pass.
  return raw.map((op) => {
    if (typeof op !== 'object' || op === null || Array.isArray(op)) return bad('Each change must be an object.');
    const { visibility: _v, status: _s, ...rest } = op as Json;
    void _v; void _s;
    return rest as unknown as ChangeOp;
  });
}

export const TOOLS: Tool[] = [
  {
    name: 'chronicle_whoami', scope: 'chronicle:read', dmOnly: false, annotations: RO,
    description: 'Who you are signed in as in Chronicle: role, granted scopes and whether two-step sign-in is satisfied.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (_a, ctx) => ({ principal_id: ctx.who.principal_id, role: ctx.who.role, scopes: ctx.scopes, mfa_satisfied: ctx.who.mfa_satisfied }),
  },
  {
    name: 'chronicle_search', scope: 'chronicle:read', dmOnly: false, annotations: RO,
    description: 'Full-text search of the wiki pages you are allowed to read. Returns matching pages with a short snippet; never counts or hints at pages you cannot read.',
    inputSchema: { type: 'object', required: ['query'], additionalProperties: false, properties: {
      query: { type: 'string', maxLength: 200 }, types: { type: 'array', items: { type: 'string' }, maxItems: 9 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, cursor: { type: ['string', 'null'] } } },
    async run(a, ctx) {
      const q = str(a.query, 'query', 200);
      const limit = limitArg(a.limit);
      const offset = cursorArg(a.cursor);
      const types = Array.isArray(a.types) ? a.types.filter((t): t is string => typeof t === 'string') : [];
      const hits = await ctx.db.rpc<{ article_id: string; slug: string; title: string; type: string; summary: string; snippet: string | null }[]>('search_wiki', { q, max_results: 50 });
      const wanted = hits.filter((h) => types.length === 0 || types.includes(h.type)).slice(offset, offset + limit + 1);
      if (wanted.length === 0) return { items: [], next_cursor: null };
      const meta = await ctx.db.get<ArticleRow>(`articles?select=id,visibility,status,version&id=in.(${wanted.map((h) => h.article_id).join(',')})`);
      const byId = new Map(meta.map((m) => [m.id, m]));
      return page(wanted.flatMap((h) => {
        const m = byId.get(h.article_id);
        return m ? [{ id: h.article_id, slug: h.slug, title: h.title, type: h.type, summary: h.summary, snippet: h.snippet ? escapeHtml(h.snippet) : null, visibility: m.visibility, status: m.status, version: version(m.version) }] : [];
      }), offset, limit);
    },
  },
  {
    name: 'chronicle_get_article', scope: 'chronicle:read', dmOnly: false, annotations: RO,
    description: 'One wiki page with its sections, infobox fields, tags and connections, as far as you may read them. Includes the version needed to propose changes.',
    inputSchema: { type: 'object', required: ['slug'], additionalProperties: false, properties: {
      slug: { type: 'string' }, include_relations: { type: 'boolean', default: true }, include_revision_summary: { type: 'boolean', default: false } } },
    async run(a, ctx) {
      const art = await loadArticle(ctx.db, slugArg(a.slug));
      const b = await bundle(ctx.db, art, a.include_relations !== false);
      if (a.include_revision_summary === true && ctx.who.is_dm) {
        const revs = await ctx.db.get<Json>(`revisions?select=id,created_at,note&article_id=eq.${art.id}&order=created_at.desc&limit=5`);
        return { ...b, revisions: revs };
      }
      return b;
    },
  },
  {
    name: 'chronicle_list_characters', scope: 'chronicle:read', dmOnly: false, annotations: RO,
    description: 'Browse character pages you may read: all, party or NPCs, optionally filtered by name, race, class or status as recorded in their infobox. Portraits are returned as media ids, never URLs.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      query: { type: 'string', maxLength: 100 }, group: { enum: ['all', 'party', 'npc'], default: 'all' }, race: { type: 'string', maxLength: 80 },
      class: { type: 'string', maxLength: 80 }, status: { type: 'string', maxLength: 80 }, sort: { enum: ['name_asc', 'name_desc', 'updated_desc'], default: 'name_asc' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, cursor: { type: ['string', 'null'] } } },
    async run(a, ctx) {
      const limit = limitArg(a.limit);
      const offset = cursorArg(a.cursor);
      const group = enumArg(a.group, 'group', ['all', 'party', 'npc'] as const, 'all');
      const sort = enumArg(a.sort, 'sort', ['name_asc', 'name_desc', 'updated_desc'] as const, 'name_asc');
      const query = str(a.query, 'query', 100, false);
      let ids = null as Set<string> | null;
      for (const [label, value] of [['Race', a.race], ['Class', a.class], ['Status', a.status]] as const) {
        const v = str(value, label.toLowerCase(), 80, false);
        if (!v) continue;
        const rows = await ctx.db.get<{ article_id: string }>(`infobox_fields?select=article_id&label=ilike.${enc(label)}&value=ilike.${enc(`*${v.replace(/[*%,()]/g, ' ')}*`)}&limit=1000`);
        const found = new Set(rows.map((r) => r.article_id));
        const prev: Set<string> | null = ids;
        ids = prev ? new Set([...prev].filter((x: string) => found.has(x))) : found;
      }
      if (ids && ids.size === 0) return { items: [], next_cursor: null };
      const filters = [
        'type=eq.character',
        group === 'party' ? 'is_party_member=is.true' : group === 'npc' ? 'is_party_member=is.false' : '',
        query ? `title=ilike.${enc(`*${query.replace(/[*%,()]/g, ' ')}*`)}` : '',
        ids ? `id=in.(${[...ids].slice(0, 300).join(',')})` : '',
        `order=${sort === 'updated_desc' ? 'updated_at.desc,id' : sort === 'name_desc' ? 'title.desc,id' : 'title.asc,id'}`,
        `limit=${limit + 1}`, `offset=${offset}`,
      ].filter(Boolean).join('&');
      const rows = await ctx.db.get<ArticleRow>(`articles?select=${ARTICLE}&${filters}`);
      if (rows.length === 0) return { items: [], next_cursor: null };
      const facts = await ctx.db.get<{ article_id: string; label: string; value: string }>(
        `infobox_fields?select=article_id,label,value&article_id=in.(${rows.map((r) => r.id).join(',')})&label=in.(Race,Class,Status)`);
      const fact = (id: string, label: string) => facts.find((f) => f.article_id === id && f.label === label)?.value ?? null;
      return page(rows.map((r) => ({
        id: r.id, slug: r.slug, title: r.title, subtitle: r.subtitle, summary: r.summary, portrait_media_id: r.hero_media_id,
        race: fact(r.id, 'Race'), classes: fact(r.id, 'Class'), known_status: fact(r.id, 'Status'),
        is_party_member: r.is_party_member, visibility: r.visibility, status: r.status, version: version(r.version),
      })), offset, limit);
    },
  },
  {
    name: 'chronicle_get_character', scope: 'chronicle:read', dmOnly: false, annotations: RO,
    description: 'A character page assembled as a profile: recorded facts, sections, relationships and the session journals that mention the character. A fact that is absent is not recorded; it is not "none".',
    inputSchema: { type: 'object', required: ['slug'], additionalProperties: false, properties: {
      slug: { type: 'string' }, include_appearances: { type: 'boolean', default: true }, include_relations: { type: 'boolean', default: true } } },
    async run(a, ctx) {
      const art = await loadArticle(ctx.db, slugArg(a.slug), 'character');
      const b = await bundle(ctx.db, art, a.include_relations !== false);
      const appearances = a.include_appearances === false ? [] :
        (await ctx.db.rpc<{ slug: string; title: string; type: string }[]>('backlinks', { p_article: art.id })).filter((x) => x.type === 'session').map((x) => ({ slug: x.slug, title: x.title }));
      return { character: b.article, profile: Object.fromEntries(b.infobox_fields.map((f) => [String(f.label), f.value])), infobox_fields: b.infobox_fields, sections: b.sections, relationships: b.relations, appearances, tags: b.tags };
    },
  },
  {
    name: 'chronicle_get_revisions', scope: 'chronicle:read', dmOnly: true, annotations: RO,
    description: 'DM only. The saved history of one page: when each snapshot was taken and why. Does not return snapshot contents and never restores anything.',
    inputSchema: { type: 'object', required: ['slug'], additionalProperties: false, properties: { slug: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, cursor: { type: ['string', 'null'] } } },
    async run(a, ctx) {
      const art = await loadArticle(ctx.db, slugArg(a.slug));
      const limit = limitArg(a.limit);
      const offset = cursorArg(a.cursor);
      const rows = await ctx.db.get<Json>(`revisions?select=id,created_at,note,change_set_id&article_id=eq.${art.id}&order=created_at.desc,id&limit=${limit + 1}&offset=${offset}`);
      return { current_version: version(art.version), ...page(rows, offset, limit) };
    },
  },
  {
    name: 'chronicle_audit_links', scope: 'chronicle:read', dmOnly: true, annotations: RO,
    description: 'DM only. Checks wiki links in one page (or all pages, paged): links to pages that do not exist, links that go through a redirect, and player-visible text that links to a page players cannot see.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { scope: { enum: ['article', 'all_accessible'], default: 'article' }, slug: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 }, cursor: { type: ['string', 'null'] } } },
    async run(a, ctx) {
      const scope = enumArg(a.scope, 'scope', ['article', 'all_accessible'] as const, 'article');
      const limit = limitArg(a.limit, 50);
      const offset = cursorArg(a.cursor);
      const art = scope === 'article' ? await loadArticle(ctx.db, slugArg(a.slug)) : null;
      const sections = await ctx.db.get<{ id: string; heading: string; body: string; visibility: string; status: string; article: { slug: string; visibility: string; status: string } }>(
        `article_sections?select=id,heading,body,visibility,status,article:articles!inner(slug,visibility,status)${art ? `&article_id=eq.${art.id}` : ''}&body=like.*%5B%5B*&order=id&limit=${limit + 1}&offset=${offset}`);
      const shown = sections.slice(0, limit);
      const targets = [...new Set(shown.flatMap((s) => wikiLinkTargets(s.body).map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))))].filter((t) => SLUG.test(t)).slice(0, 400);
      const [pages, redirects] = targets.length === 0 ? [[], []] : await Promise.all([
        ctx.db.get<{ slug: string; visibility: string; status: string }>(`articles?select=slug,visibility,status&slug=in.(${targets.join(',')})`),
        ctx.db.get<{ from_slug: string }>(`redirects?select=from_slug&from_slug=in.(${targets.join(',')})`),
      ]);
      const bySlug = new Map(pages.map((p) => [p.slug, p]));
      const viaRedirect = new Set(redirects.map((r) => r.from_slug));
      const out = { broken: [] as Json[], ambiguous: [] as Json[], potential_spoiler_edge: [] as Json[], redirects: [] as Json[] };
      for (const s of shown) {
        const playerVisible = s.visibility === 'players' && s.status === 'published' && s.article.visibility === 'players' && s.article.status === 'published';
        for (const t of new Set(wikiLinkTargets(s.body).map((x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')))) {
          const base = { source_slug: s.article.slug, source_section_id: s.id, section_heading: s.heading, target_slug: t };
          const target = bySlug.get(t);
          if (!target && viaRedirect.has(t)) out.redirects.push({ ...base, reason: 'The link goes through a redirect.', recommendation: 'Link to the page directly.' });
          else if (!target) out.broken.push({ ...base, reason: 'No page has this address.', recommendation: 'Create the page or fix the link.' });
          else if (playerVisible && !(target.visibility === 'players' && target.status === 'published')) {
            out.potential_spoiler_edge.push({ ...base, reason: 'Player-visible text links to a page players cannot see; the address itself may be a spoiler.', recommendation: 'Remove the link or make the section DM-only.' });
          }
        }
      }
      return { ...out, next_cursor: sections.length > limit ? `o${offset + limit}` : null };
    },
  },
  {
    name: 'chronicle_preview_changes', scope: 'chronicle:preview', dmOnly: true, annotations: RO,
    description: 'DM only. Validates a set of proposed edits and returns exactly what would change, field by field, with warnings and conflicts. Saves nothing. Every edit to an existing page needs its expected_version. New content is always a private draft.',
    inputSchema: { type: 'object', required: ['change_set'], additionalProperties: false, properties: { change_set: { type: 'object', required: ['changes'], properties: {
      label: { type: 'string', maxLength: 200 }, source_kind: { enum: PROVENANCE }, expected_versions: { type: 'object' }, changes: { type: 'array', minItems: 1, maxItems: 5000, items: { type: 'object', required: ['operation'] } } } } } },
    async run(a, ctx) {
      const cs = (typeof a.change_set === 'object' && a.change_set !== null ? a.change_set : bad('change_set is required.')) as Json;
      return previewOf(ctx, {
        label: str(cs.label, 'label', 200, false), changes: cleanOps(cs.changes),
        ...(cs.source_kind ? { source_kind: enumArg(cs.source_kind, 'source_kind', PROVENANCE, 'dm_confirmed') } : {}),
        ...(typeof cs.expected_versions === 'object' && cs.expected_versions !== null ? { expected_versions: cs.expected_versions as Record<string, string> } : {}),
      });
    },
  },
  {
    name: 'chronicle_preview_import', scope: 'chronicle:preview', dmOnly: true, annotations: RO,
    description: 'DM only. Checks a lore package (1 to 100 pages, at most 1 MB) and reports, per page, whether it would be created or skipped because it exists. Saves nothing; an approved import creates private drafts only and never replaces a page.',
    inputSchema: { type: 'object', required: ['package'], additionalProperties: false, properties: { package: { type: 'object', required: ['articles'] }, duplicate_policy: { enum: ['skip', 'report_conflict'], default: 'skip' } } },
    async run(a, ctx) {
      const parsed = parsePackage(a.package);
      if (parsed.articles.length === 0) throw new ToolError('VALIDATION_FAILED', parsed.errors[0]?.message ?? 'The package has no usable pages.', { errors: parsed.errors });
      const cs = packageToChangeSet(parsed, new Set(parsed.articles.map((x) => x.slug)), 'Lore import (MCP)');
      const p = await previewOf(ctx, cs);
      const created = new Set(p.created as string[]);
      return { ...p, validation: { readable: parsed.articles.length, refused: parsed.errors, notices: parsed.warnings },
        records: parsed.articles.map((x, index) => ({ index, slug: x.slug, decision: created.has(x.slug) ? 'create' : a.duplicate_policy === 'report_conflict' ? 'conflict' : 'skip', why: created.has(x.slug) ? 'New page' : 'A page with this address already exists' })) };
    },
  },
  {
    name: 'chronicle_suggest_connections', scope: 'chronicle:preview', dmOnly: true, annotations: RO,
    description: 'DM only. Suggests connections for one page from evidence already in the wiki: pages its text links to, and pages that link to it, that have no recorded connection yet. Suggests only; saves nothing and infers nothing beyond "mentioned".',
    inputSchema: { type: 'object', required: ['article_slug'], additionalProperties: false, properties: { article_slug: { type: 'string' }, max_suggestions: { type: 'integer', minimum: 1, maximum: 50, default: 10 } } },
    async run(a, ctx) {
      const art = await loadArticle(ctx.db, slugArg(a.article_slug, 'article_slug'));
      const max = typeof a.max_suggestions === 'number' && a.max_suggestions >= 1 && a.max_suggestions <= 50 ? Math.floor(a.max_suggestions) : 10;
      const b = await bundle(ctx.db, art, true);
      const linked = new Set(b.relations.map((r) => r.target_slug));
      const out: Json[] = [];
      for (const s of b.sections) {
        for (const t of new Set(wikiLinkTargets(String(s.body)).map((x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')))) {
          if (!SLUG.test(t) || t === art.slug || linked.has(t)) continue;
          linked.add(t);
          out.push({ source_slug: art.slug, target_slug: t, kind: 'related_to', reason: 'This page links to it in its text.', confidence: 'medium', evidence: { section_heading: s.heading }, suggested_visibility: 'dm' });
        }
      }
      for (const x of await ctx.db.rpc<{ slug: string; title: string }[]>('backlinks', { p_article: art.id })) {
        if (linked.has(x.slug)) continue;
        linked.add(x.slug);
        out.push({ source_slug: art.slug, target_slug: x.slug, kind: 'related_to', reason: 'That page links here.', confidence: 'low', evidence: { source_title: x.title }, suggested_visibility: 'dm' });
      }
      const targets = out.slice(0, max);
      const real = targets.length ? await ctx.db.get<{ slug: string }>(`articles?select=slug&slug=in.(${targets.map((t) => String(t.target_slug)).join(',')})`) : [];
      const exists = new Set(real.map((r) => r.slug));
      return { suggestions: targets.filter((t) => exists.has(String(t.target_slug))) };
    },
  },
  {
    name: 'chronicle_apply_changes', scope: 'chronicle:draft_write', dmOnly: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'DM only. Saves a previewed change set, all of it or none of it, but only after the DM approved that exact preview in Chronicle (open its review_url). Saying the user confirmed is not enough. Reusing the same idempotency_key returns the earlier result.',
    inputSchema: { type: 'object', required: ['preview_id', 'digest', 'idempotency_key'], additionalProperties: false, properties: {
      preview_id: { type: 'string' }, digest: { type: 'string' }, idempotency_key: { type: 'string', minLength: 8, maxLength: 100 }, expected_versions: { type: 'object' }, user_confirmed: { type: 'boolean' } } },
    async run(a, ctx) {
      const previewId = str(a.preview_id, 'preview_id', 64);
      if (!/^[0-9a-f-]{36}$/i.test(previewId)) bad('preview_id is not valid.');
      try {
        return await ctx.db.rpc<Json>('apply_change_set', { p_preview_id: previewId, p_digest: str(a.digest, 'digest', 100), p_idempotency_key: str(a.idempotency_key, 'idempotency_key', 100) });
      } catch (error) {
        if (error instanceof ToolError && error.detail.review_required) {
          throw new ToolError('FORBIDDEN', 'These changes have not been approved in Chronicle yet. Ask the DM to open the review link and approve, then call this tool again.', { review_required: true, review_url: reviewUrl(ctx, previewId) });
        }
        throw error;
      }
    },
  },
  {
    name: 'chronicle_create_character_draft', scope: 'chronicle:preview', dmOnly: true, annotations: RO,
    description: 'DM only. Prepares a new character page as a private draft and returns a preview to approve; it does not save. Only include facts the DM has given you.',
    inputSchema: { type: 'object', required: ['draft'], additionalProperties: false, properties: { source_kind: { enum: PROVENANCE }, draft: { type: 'object', required: ['title'], properties: {
      title: { type: 'string', maxLength: 200 }, slug: { type: 'string' }, summary: { type: 'string', maxLength: 2000 }, subtitle: { type: 'string', maxLength: 200 }, is_party_member: { type: 'boolean' },
      fields: { type: 'array', maxItems: 50, items: { type: 'object', required: ['label', 'value'] } }, sections: { type: 'array', maxItems: 30, items: { type: 'object', required: ['heading', 'body'] } } } } } },
    async run(a, ctx) {
      const d = (typeof a.draft === 'object' && a.draft !== null ? a.draft : bad('draft is required.')) as Json;
      const title = str(d.title, 'title', 200).trim();
      const slug = d.slug ? slugArg(d.slug) : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!SLUG.test(slug)) bad('Could not make a page address from the title; pass slug.');
      const fields = Array.isArray(d.fields) ? d.fields : [];
      const sections = Array.isArray(d.sections) ? d.sections : [];
      if (fields.length > 50 || sections.length > 30) bad('At most 50 fields and 30 sections.');
      const changes: ChangeOp[] = [{ operation: 'create_article', slug, title, type: 'character', summary: str(d.summary, 'summary', 2000, false), subtitle: str(d.subtitle, 'subtitle', 200, false), is_party_member: d.is_party_member === true }];
      for (const f of fields as Json[]) changes.push({ operation: 'upsert_infobox_field', article_slug: slug, label: str(f?.label, 'field label', 80), value: str(f?.value, 'field value', 2000, false) });
      for (const s of sections as Json[]) changes.push({ operation: 'upsert_section', article_slug: slug, heading: str(s?.heading, 'section heading', 200, false), body: str(s?.body, 'section body', 100000) });
      return previewOf(ctx, { label: `New character: ${title}`.slice(0, 200), changes, ...(a.source_kind ? { source_kind: enumArg(a.source_kind, 'source_kind', PROVENANCE, 'dm_confirmed') } : {}) });
    },
  },
  {
    name: 'chronicle_add_dm_note', scope: 'chronicle:preview', dmOnly: true, annotations: RO,
    description: 'DM only. Prepares a private DM note on a page and returns a preview to approve; it does not save. Notes are never visible to players.',
    inputSchema: { type: 'object', required: ['article_slug', 'body', 'expected_version'], additionalProperties: false, properties: { article_slug: { type: 'string' }, title: { type: 'string', maxLength: 200 }, body: { type: 'string', maxLength: 100000 }, expected_version: { type: 'string' } } },
    run: (a, ctx) => previewOf(ctx, { label: 'DM note', changes: [{ operation: 'add_dm_note', article_slug: slugArg(a.article_slug, 'article_slug'), expected_version: str(a.expected_version, 'expected_version', 20), title: str(a.title, 'title', 200, false), body: str(a.body, 'body', 100000) }] }),
  },
  {
    name: 'chronicle_restore_revision', scope: 'chronicle:revision_restore', dmOnly: true, annotations: RO,
    description: 'DM only. Prepares the restore of an earlier snapshot of a page and returns a preview to approve; it does not save. A restored page always comes back as an unpublished draft and nothing hidden becomes visible.',
    inputSchema: { type: 'object', required: ['article_slug', 'revision_id', 'expected_version'], additionalProperties: false, properties: { article_slug: { type: 'string' }, revision_id: { type: 'string' }, expected_version: { type: 'string' } } },
    run: (a, ctx) => {
      const rev = str(a.revision_id, 'revision_id', 64);
      if (!/^[0-9a-f-]{36}$/i.test(rev)) bad('revision_id is not valid.');
      return previewOf(ctx, { label: 'Restore revision', changes: [{ operation: 'restore_revision', article_slug: slugArg(a.article_slug, 'article_slug'), expected_version: str(a.expected_version, 'expected_version', 20), revision_id: rev }] });
    },
  },
];

export function toolErrorCode(error: unknown): { code: ErrorCode; message: string; detail: Json } {
  if (error instanceof ToolError) return { code: error.code, message: error.message, detail: error.detail };
  return { code: 'INTERNAL_ERROR', message: 'Chronicle could not complete the request.', detail: {} };
}
