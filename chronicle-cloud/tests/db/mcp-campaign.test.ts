/* eslint-disable @typescript-eslint/no-explicit-any -- tool results are free-form JSON in these tests */
// The campaign-knowledge, maintenance, drafting and import tools of the MCP server, against the
// LOCAL stack (real PostgREST + RLS) with synthetic users, locally signed tokens and synthetic lore.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { handleRequest, type Env } from '../../mcp/src/server.ts';
import { admin, ids, pool, resetFixtures } from './helpers.ts';

const local = path.resolve(import.meta.dirname, '../../.local');
const kv = Object.fromEntries(fs.readFileSync(path.join(local, 'env'), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const SECRET = fs.readFileSync(path.join(local, 'jwt_secret'), 'utf8').trim();
const env: Env = { SUPABASE_URL: kv.SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY: kv.SUPABASE_PUBLISHABLE_KEY!, SUPABASE_JWT_SECRET: SECRET, CHRONICLE_URL: 'https://wiki.example' };
const CLIENT = 'synthetic-mcp-client';

function token(who: keyof typeof ids, over: Record<string, unknown> = {}, secret = SECRET) {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: ids[who], role: 'authenticated', aud: 'authenticated', iss: `${env.SUPABASE_URL}/auth/v1`, aal: 'aal1', client_id: CLIENT, iat: now, exp: now + 600, ...over });
  return `${head}.${body}.${crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}

let n = 0;
async function post(body: unknown, bearer?: string, e: Env = env) {
  const res = await handleRequest(new Request('https://mcp.example/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) }), e);
  return { status: res.status, headers: res.headers, json: res.status === 202 ? null : ((await res.json()) as Record<string, any>) };
}
async function call(name: string, args: unknown, bearer: string, e: Env = env, fetchImpl?: typeof fetch): Promise<Record<string, any>> {
  if (fetchImpl) {
    const res = await handleRequest(new Request('https://mcp.example/mcp', { method: 'POST', headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }) }), e, fetchImpl);
    const j = (await res.json()) as { result: { structuredContent: Record<string, unknown>; isError: boolean } };
    return { ...j.result.structuredContent, isError: j.result.isError, raw: JSON.stringify(j) };
  }
  const r = await post({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }, bearer, e);
  const result = r.json!.result as { structuredContent: Record<string, any>; isError: boolean; content: { text: string }[] };
  return { ...result.structuredContent, isError: result.isError, raw: JSON.stringify(r.json) };
}
const dm = () => token('dm');
const player = () => token('player');
/** The DM approving a preview on the website (a website token has no client id). */
async function approveOnWebsite(previewId: string, who: keyof typeof ids = 'dm') {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids[who], role: 'authenticated', aal: 'aal1' })]);
    await c.query('select public.approve_change_preview($1)', [previewId]);
    await c.query('commit');
  } catch (error) {
    await c.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  await resetFixtures();
  await admin('delete from public.change_sets');
  await admin('delete from public.change_previews');
});

const A = 'a0000000-0000-4000-8000-00000000000a'; // Visible Captain (players, published)
const B = 'a0000000-0000-4000-8000-00000000000b'; // Hidden Spymaster (DM-only)

async function world() {
  const art = async (slug: string, type: string, title: string, summary: string, visibility = 'players', status = 'published', extra = '') =>
    (await admin<{ id: string }>(`insert into public.articles (slug, type, title, summary, visibility, status${extra ? ', ' + extra.split('=')[0] : ''}) values ($1, $2, $3, $4, $5, $6${extra ? ', ' + extra.split('=')[1] : ''}) returning id`, [slug, type, title, summary, visibility, status])).rows[0]!.id;
  const field = (id: string, label: string, value: string, visibility = 'players') => admin(`insert into public.infobox_fields (article_id, label, value, visibility) values ($1, $2, $3, $4)`, [id, label, value, visibility]);
  const town = await art('zz-harbour-town', 'location', 'Zz Harbour Town', 'A synthetic harbour.');
  const q1 = await art('zz-find-the-bell', 'quest', 'Zz Find the Bell', 'Recover a bell.');
  const q2 = await art('zz-escort-the-cart', 'quest', 'Zz Escort the Cart', 'Done already.');
  await art('zz-mystery-job', 'quest', 'Zz Mystery Job', 'No status yet.');
  const q4 = await art('zz-secret-plot', 'quest', 'Zz Secret Plot', 'SECRETQUEST', 'dm', 'draft');
  await field(q1, 'Status', 'In progress');
  await field(q2, 'Status', 'Completed');
  await field(q4, 'Status', 'Active', 'dm');
  const hero = await art('zz-hero', 'character', 'Zz Hero', 'A synthetic hero.', 'players', 'published', 'is_party_member=true');
  await field(hero, 'Race', 'Gnome');
  await field(hero, 'Class', 'Bard');
  const s1 = await art('zz-session-1', 'session', 'Zz Session 1', 'They met.', 'players', 'published', 'session_date=\'2026-01-01\'');
  const s2 = await art('zz-session-2', 'session', 'Zz Session 2', 'They sailed.', 'players', 'published', 'session_date=\'2026-01-08\'');
  await admin(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 0, 'Recap', 'At [[Zz Harbour Town]] they met [[public-article|the captain]] and found [[Zz Missing Page]].', 'players', 'published')`, [s2]);
  void s1;
  await admin(`update public.campaign_settings set current_location_id = $1, current_status = 'Waiting for the tide.'`, [town]);
  await admin(`insert into public.relations (source_article_id, target_article_id, kind, visibility) values ($1, $2, 'resides_in', 'players')`, [A, town]);
  return { town, hero };
}

beforeEach(async () => {
  await resetFixtures();
  await admin("delete from public.articles where slug like 'zz-%'");
  await admin('delete from public.import_batches');
  await admin('delete from public.change_sets');
  await admin('delete from public.change_previews');
  await admin(`update public.campaign_settings set current_location_id = null, current_status = ''`);
});
afterAll(() => pool.end());

describe('campaign knowledge', () => {
  it('overview: where the party is, the situation, the party, latest sessions and open quests', async () => {
    await world();
    const r = await call('chronicle_campaign_overview', {}, player());
    expect(r.isError).toBe(false);
    expect(r.data.party_location).toMatchObject({ slug: 'zz-harbour-town' });
    expect(r.data.current_situation).toBe('Waiting for the tide.');
    expect(r.data.party).toEqual([expect.objectContaining({ slug: 'zz-hero', race: 'Gnome', class: 'Bard' })]);
    expect(r.data.latest_sessions.map((s: any) => s.slug)).toEqual(['zz-session-2', 'zz-session-1']);
    expect(r.data.open_quests.map((q: any) => q.slug)).toEqual(['zz-find-the-bell']);
    expect(r.data.quests_with_unrecorded_status.map((q: any) => q.slug)).toEqual(['zz-mystery-job']);
    expect(r.raw).not.toMatch(/SECRETQUEST|SPYMASTERWORD|zz-secret-plot/);
  });

  it('overview: a hidden current location is not revealed to a player', async () => {
    const { town } = await world();
    await admin(`update public.articles set visibility = 'dm' where id = $1`, [town]);
    const r = await call('chronicle_campaign_overview', {}, player());
    expect(r.data.party_location).toBeNull();
    expect(r.raw).not.toContain('Zz Harbour Town');
    expect((await call('chronicle_campaign_overview', {}, dm())).data.party_location.slug).toBe('zz-harbour-town');
  });

  it('quests: unfinished includes unknown status, and states are never guessed', async () => {
    await world();
    const r = await call('chronicle_list_quests', {}, player());
    expect(r.data.quests.map((q: any) => [q.slug, q.state])).toEqual(expect.arrayContaining([['zz-find-the-bell', 'open'], ['zz-mystery-job', 'unknown']]));
    expect(r.data.quests.map((q: any) => q.slug)).not.toContain('zz-escort-the-cart');
    expect(r.raw).not.toContain('zz-secret-plot');
    const dmView = await call('chronicle_list_quests', { state: 'open' }, dm());
    expect(dmView.data.quests.map((q: any) => q.slug).sort()).toEqual(['zz-find-the-bell', 'zz-secret-plot']);
    expect((await call('chronicle_list_quests', { state: 'nonsense' }, dm())).error.code).toBe('VALIDATION_FAILED');
  });

  it('topic: the page, its facts, connections, pages linking to it and mentions; nothing hidden', async () => {
    await world();
    const r = await call('chronicle_topic', { name: 'Zz Harbour Town' }, player());
    expect(r.data).toMatchObject({ found: true, page: { slug: 'zz-harbour-town' } });
    expect(r.data.connections).toEqual([expect.objectContaining({ slug: 'public-article', kind: 'resides_in', direction: 'to this page' })]);
    expect(r.data.linked_from.map((x: any) => x.slug)).toContain('zz-session-2');
    const hidden = await call('chronicle_topic', { name: 'Hidden Spymaster' }, player());
    expect(hidden.raw).not.toMatch(/SPYMASTERWORD|secret-article/);
    expect(hidden.data.found === false || hidden.data.page.slug !== 'secret-article').toBe(true);
    expect((await call('chronicle_topic', { name: 'Hidden Spymaster' }, dm())).data.page.slug).toBe('secret-article');
  });

  it('session prep (DM only): latest journals, unfinished quests, location neighbours and who the journals mention', async () => {
    await world();
    expect((await call('chronicle_session_prep', {}, player())).error.code).toBe('FORBIDDEN');
    const r = await call('chronicle_session_prep', { sessions: 2 }, dm());
    expect(r.data.latest_sessions[0].slug).toBe('zz-session-2');
    expect(r.data.current_location.slug).toBe('zz-harbour-town');
    expect(r.data.connected_to_location).toEqual([expect.objectContaining({ slug: 'public-article', kind: 'resides_in' })]);
    expect(r.data.mentioned_in_latest_sessions.characters.map((c: any) => c.slug)).toContain('public-article');
    expect(r.data.missing_links_in_latest_sessions).toEqual(['zz-missing-page']);
    expect(r.data.unfinished_quests.map((q: any) => q.slug)).toEqual(expect.arrayContaining(['zz-find-the-bell', 'zz-mystery-job', 'zz-secret-plot']));
  });
});

describe('maintenance', () => {
  it('wiki health finds duplicates, broken links, contradictions and conflicting facts, and changes nothing', async () => {
    await world();
    await admin(`insert into public.articles (slug, type, title, visibility, status) values ('zz-the-harbour-town', 'location', 'The Zz Harbour Town', 'dm', 'draft')`);
    await admin(`insert into public.relations (source_article_id, target_article_id, kind, visibility) values ($1, $2, 'ally_of', 'dm'), ($2, $1, 'enemy_of', 'dm')`, [A, B]);
    await admin(`insert into public.infobox_fields (article_id, label, value, visibility) values ($1, 'Race', 'Elf', 'dm'), ($1, 'race', 'Orc', 'dm')`, [B]);
    const before = (await admin(`select count(*)::int n, max(updated_at) t from public.articles`)).rows[0];
    expect((await call('chronicle_wiki_health', {}, player())).error.code).toBe('FORBIDDEN');
    const r = await call('chronicle_wiki_health', {}, dm());
    expect(r.isError).toBe(false);
    expect(JSON.stringify(r.data.possible_duplicates.items)).toContain('zz-the-harbour-town');
    expect(r.data.broken_links.items).toEqual(expect.arrayContaining([expect.objectContaining({ target_slug: 'zz-missing-page' })]));
    expect(r.data.contradictory_connections.items).toEqual([expect.objectContaining({ kinds: ['ally_of', 'enemy_of'] })]);
    expect(r.data.facts_recorded_twice_with_different_values.items).toEqual([expect.objectContaining({ label: 'race', values: ['Elf', 'Orc'] })]);
    expect(r.data.characters_missing_basic_facts.items.map((c: any) => c.slug)).toContain('public-article');
    expect((await admin(`select count(*)::int n, max(updated_at) t from public.articles`)).rows[0]).toEqual(before);
  });
});

describe('drafting', () => {
  it('a session journal from notes is a private draft preview; no date unless given; missing links reported', async () => {
    await world();
    const r = await call('chronicle_draft_session_journal', { title: 'Zz Session 3', recap: 'They reached [[Zz Harbour Town]] and asked about [[Zz Nowhere]].', source: 'DM notes (synthetic)' }, dm());
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.missing_link_targets).toEqual(['zz-nowhere']);
    expect(r.data.created).toEqual(['zz-session-3']);
    expect(JSON.stringify(r.data.diffs)).not.toContain('session_date');
    expect((await admin(`select 1 from public.articles where slug = 'zz-session-3'`)).rowCount).toBe(0);
    await approveOnWebsite(r.data.preview_id);
    expect((await call('chronicle_apply_changes', { preview_id: r.data.preview_id, digest: r.data.digest, idempotency_key: 'key-journal-1' }, dm())).isError).toBe(false);
    const saved = (await admin(`select a.visibility::text v, a.status::text s, a.session_date, (select string_agg(p.kind::text, ',') from public.provenance p where p.article_id = a.id) k from public.articles a where slug = 'zz-session-3'`)).rows[0];
    expect(saved).toEqual({ v: 'dm', s: 'draft', session_date: null, k: 'transcript_uncertain' });
    expect((await call('chronicle_draft_session_journal', { title: 'X', recap: 'y', session_date: 'last tuesday' }, dm())).error.code).toBe('VALIDATION_FAILED');
  });

  it('a Gazette story is filed as a proposal for the DM: no story is saved or printed, hidden sources are flagged', async () => {
    await world();
    await admin('delete from public.news_proposals');
    const before = (await admin(`select count(*)::int n from public.articles where type = 'news'`)).rows[0]!.n;
    const r = await call('chronicle_draft_gazette_story', { headline: 'Zz Tide Late Again', body: 'The tide was late.', section: 'local', reliability: 'rumor', reporter: 'nib', based_on: ['zz-harbour-town', 'secret-article'] }, dm());
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.review_url).toBe('https://wiki.example/dm/news#proposals');
    expect(r.data.warnings.join(' ')).toMatch(/players cannot see \(secret-article\)/);
    const row = (await admin('select title, reliability::text, reporter, status, article_id, created_via, based_on from public.news_proposals where id = $1', [r.data.proposal_id])).rows[0]!;
    expect({ ...row, based_on: [...row.based_on].sort() }).toEqual({ title: 'Zz Tide Late Again', reliability: 'rumor', reporter: 'nib', status: 'pending', article_id: null, created_via: 'synthetic-mcp-client', based_on: ['secret-article', 'zz-harbour-town'] });
    expect((await admin(`select count(*)::int n from public.articles where type = 'news'`)).rows[0]!.n).toBe(before);
    expect((await call('chronicle_draft_gazette_story', { headline: 'X', body: 'y', section: 'local', reliability: 'rumor', reporter: 'not-a-reporter' }, dm())).error.code).toBe('VALIDATION_FAILED');
    expect((await call('chronicle_draft_gazette_story', { headline: 'X', body: 'y', section: 'local', reliability: 'rumor', reporter: 'nib' }, player())).error.code).toBe('FORBIDDEN');
  });
});

describe('Gazette proposals: suggested release times and the new correspondents', () => {
  const story = { body: 'MCPBATCH body, exactly as approved.', section: 'war', reliability: 'rumor' };

  it('keeps a suggested time exactly, accepts the new correspondents, and publishes nothing', async () => {
    await world();
    await admin('delete from public.news_proposals');
    await admin("delete from public.articles where type = 'news'");
    const at = '2026-12-01T05:45:00-07:00';
    const r = await call('chronicle_draft_gazette_story', { ...story, headline: 'Zz Black Rose Returns', reporter: 'gribble-senior-investigative', suggested_publish_at: at }, dm());
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.suggested_publish_at).toBe('2026-12-01T12:45:00.000Z');
    const row = (await admin('select reporter, suggested_publish_at, status, article_id, created_via from public.news_proposals where id = $1', [r.data.proposal_id])).rows[0]!;
    expect(new Date(row.suggested_publish_at).toISOString()).toBe('2026-12-01T12:45:00.000Z');
    expect(row).toMatchObject({ reporter: 'gribble-senior-investigative', status: 'pending', article_id: null, created_via: 'synthetic-mcp-client' });
    for (const key of ['gribble', 'snikkit', 'snikkit-food', 'bogwart', 'gribble-investigative']) {
      const ok = await call('chronicle_draft_gazette_story', { ...story, headline: `Zz By ${key}`, reporter: key }, dm());
      expect(ok.isError, `${key}: ${ok.raw}`).toBe(false);
    }
    expect((await admin("select count(*)::int n from public.articles where type = 'news'")).rows[0]!.n).toBe(0);
    // The discoverable tool says which keys exist.
    const list = await post({ jsonrpc: '2.0', id: ++n, method: 'tools/list' }, dm());
    const tool = (list.json!.result as { tools: { name: string; description: string }[] }).tools.find((t) => t.name === 'chronicle_draft_gazette_story')!;
    expect(tool.description).toMatch(/gribble-senior-investigative = Gribble Inkfinger, Senior Investigative Correspondent/);
    expect(tool.description).toMatch(/suggested_publish_at/);
  });

  it('refuses a time without an offset, an impossible date, and a headline already on the desk', async () => {
    await world();
    await admin('delete from public.news_proposals');
    await admin("delete from public.articles where type = 'news'");
    const base = { ...story, reporter: 'bogwart' };
    for (const bad of ['2026-12-01T05:45', '2026-12-01 05:45:00-07:00', 'tomorrow morning', '2026-13-45T05:45:00-07:00', '2031-12-01T05:45:00Z']) {
      const r = await call('chronicle_draft_gazette_story', { ...base, headline: 'Zz Bad Time', suggested_publish_at: bad }, dm());
      expect(r.error?.code, bad).toBe('VALIDATION_FAILED');
    }
    expect((await admin('select count(*)::int n from public.news_proposals')).rows[0]!.n).toBe(0);
    expect((await call('chronicle_draft_gazette_story', { ...base, headline: 'Zz Once Only' }, dm())).isError).toBe(false);
    expect((await call('chronicle_draft_gazette_story', { ...base, headline: '  zz once only ' }, dm())).error.code).toBe('ALREADY_EXISTS');
    expect((await admin('select count(*)::int n from public.news_proposals')).rows[0]!.n).toBe(1);
  });

  it('a time that has already passed is accepted as a suggestion but flagged for the DM', async () => {
    await world();
    await admin('delete from public.news_proposals');
    const r = await call('chronicle_draft_gazette_story', { ...story, headline: 'Zz Missed Date', reporter: 'gribble', suggested_publish_at: '2020-01-01T05:45:00-07:00' }, dm());
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.warnings.join(' ')).toMatch(/already passed/);
  });

  it('only the DM can file; a player is refused, and the tool cannot approve, schedule or print', async () => {
    await world();
    expect((await call('chronicle_draft_gazette_story', { ...story, headline: 'Zz Player', reporter: 'nib' }, player())).error.code).toBe('FORBIDDEN');
    const names = ((await post({ jsonrpc: '2.0', id: ++n, method: 'tools/list' }, dm())).json!.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names.filter((x) => /approve|schedule|publish|print/.test(x))).toEqual([]);
  });
});

describe('staged imports through MCP', () => {
  const files = [
    { name: 'npcs/zz-ferryman.md', text: '---\ntitle: Zz Ferryman\ncanon: confirmed\n---\nRows boats at [[Zz Harbour Town]].\n\n## Facts\n- Race: Human' },
    { name: 'places.md', text: '# Zz Harbour Town\nThe harbour again.\n\n## Facts\n- Population: Many' },
    { name: 'bad.json', text: '{oops' },
  ];

  it('the assistant stages and analyses a batch; the wiki is untouched; only the DM can save', async () => {
    await world();
    const before = (await admin(`select count(*)::int n from public.articles`)).rows[0]!.n;
    const r = await call('chronicle_stage_import', { label: 'Synthetic lore', files }, dm());
    expect(r.isError, r.raw).toBe(false);
    expect(r.data.totals).toMatchObject({ entries: 2, create: 1, add_to_existing: 1, suggested_relations: 1 });
    expect(r.data.not_readable).toEqual([expect.objectContaining({ name: 'bad.json' })]);
    expect(r.data.review_url).toBe(`https://wiki.example/dm/import/${r.data.batch_id}`);
    expect((await admin(`select count(*)::int n from public.articles`)).rows[0]!.n).toBe(before);
    const row = (await admin('select created_via, status, decisions from public.import_batches where id = $1', [r.data.batch_id])).rows[0];
    expect(row).toEqual({ created_via: 'synthetic-mcp-client', status: 'staged', decisions: { items: {}, relations: {}, types: {} } });

    const list = await call('chronicle_list_import_batches', {}, dm());
    expect(list.data.batches[0]).toMatchObject({ batch_id: r.data.batch_id, entries: 2, staged_by: 'assistant' });
    const detail = await call('chronicle_get_import_batch', { batch_id: r.data.batch_id, filter: 'existing' }, dm());
    expect(detail.data.entries).toEqual([expect.objectContaining({ slug: 'zz-harbour-town', proposal: 'additions to "Zz Harbour Town"', dm_choice: 'not approved' })]);
    const created = await call('chronicle_get_import_batch', { batch_id: r.data.batch_id, filter: 'new' }, dm());
    expect(created.data.entries).toEqual([expect.objectContaining({ slug: 'zz-ferryman', type: 'character', type_confidence: 'medium', canon: 'Confirmed by the DM', dm_choice: 'approved' })]);

    // Players see nothing; the same token cannot approve or record progress directly.
    expect((await call('chronicle_list_import_batches', {}, player())).error.code).toBe('FORBIDDEN');
    const direct = await fetch(`${env.SUPABASE_URL}/rest/v1/import_batches?id=eq.${r.data.batch_id}`, {
      method: 'PATCH', headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${dm()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ decisions: { items: { 'zz-harbour-town': 'approve' } } }),
    });
    expect(direct.status).toBe(403);
    expect((await admin('select decisions from public.import_batches where id = $1', [r.data.batch_id])).rows[0]!.decisions.items).toEqual({});
  });

  it('refuses oversized or empty imports before staging anything', async () => {
    expect((await call('chronicle_stage_import', { label: 'x', files: [{ name: 'a.json', text: '{oops' }] }, dm())).error.code).toBe('VALIDATION_FAILED');
    expect((await call('chronicle_stage_import', { label: 'x', files: [{ name: 'a.md', text: 'x'.repeat(1_000_001) }] }, dm())).error.code).toBe('VALIDATION_FAILED');
    expect((await admin('select count(*)::int n from public.import_batches')).rows[0]!.n).toBe(0);
  });
});

describe('at scale', () => {
  it('300 quests: the quest list works (ids sent in batches) and overviews stay short', async () => {
    await world();
    await admin(`insert into public.articles (slug, type, title, summary, visibility, status) select 'zz-q-' || g, 'quest', 'Zz Quest ' || g, repeat('x', 100), 'players', 'published' from generate_series(1, 300) g`);
    await admin(`insert into public.infobox_fields (article_id, label, value, visibility) select id, 'Status', 'Open', 'players' from public.articles where slug like 'zz-q-%'`);
    const list = await call('chronicle_list_quests', { state: 'open', limit: 200 }, dm());
    expect(list.isError, list.raw.slice(0, 300)).toBe(false);
    expect(list.data.count).toBe(302); // 300 + zz-find-the-bell + the DM-only zz-secret-plot
    expect(list.data.quests).toHaveLength(200);
    const overview = await call('chronicle_campaign_overview', {}, dm());
    expect(overview.data.open_quests).toHaveLength(15);
    expect(overview.data.open_quest_count).toBe(302);
    expect(overview.raw.length).toBeLessThan(40_000);
    const prep = await call('chronicle_session_prep', {}, dm());
    expect(prep.data.unfinished_quests).toHaveLength(25);
    expect(prep.raw.length).toBeLessThan(40_000);
  });
});

describe('connection reliability', () => {
  const raw = (headers: Record<string, string>, body: string, fetchImpl?: typeof fetch) =>
    handleRequest(new Request('https://mcp.example/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }), env, fetchImpl);
  const list = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

  it('an expired token says so, so the client refreshes instead of failing', async () => {
    const r = await raw({ authorization: `Bearer ${token('dm', { exp: Math.floor(Date.now() / 1000) - 60 })}` }, list);
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toMatch(/error="invalid_token", error_description="The access token expired; refresh it or sign in again\.", resource_metadata=/);
  });

  it('a website session token is told to connect through OAuth', async () => {
    const r = await raw({ authorization: `Bearer ${token('dm', { client_id: undefined })}` }, list);
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error_description: string }).error_description).toMatch(/not a token issued to an OAuth client/);
  });

  it('signing keys out of reach is a temporary 503, not a failed sign-in', async () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const es = `${b64({ alg: 'ES256', kid: 'synthetic-kid', typ: 'JWT' })}.${b64({ sub: ids.dm })}.c2ln`;
    const down = (() => Promise.reject(new TypeError('network down'))) as unknown as typeof fetch;
    const r = await raw({ authorization: `Bearer ${es}` }, list, down);
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('5');
    expect(await r.json()).toMatchObject({ error: 'DEPENDENCY_UNAVAILABLE', retryable: true });
  });

  it('a database that cannot be reached is reported as retryable, with a hint', async () => {
    const down = ((url: string | URL | Request) => (String(url).includes('/rest/v1/') ? Promise.reject(new TypeError('fetch failed')) : fetch(url))) as typeof fetch;
    const r = await call('chronicle_search', { query: 'x' }, dm(), env, down);
    expect(r.isError).toBe(true);
    expect(r.error).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', retryable: true });
    expect(r.raw).not.toMatch(/fetch failed|TypeError/);
    const bad = await call('chronicle_get_article', { slug: 'Not A Slug' }, dm());
    expect(bad.error).toMatchObject({ code: 'VALIDATION_FAILED', retryable: false, hint: 'Fix the arguments and call again.' });
  });

  it('an oversized request is refused with 413, before it is read', async () => {
    const r = await raw({ authorization: `Bearer ${dm()}`, 'content-length': String(2_000_000) }, list);
    expect(r.status).toBe(413);
  });

  it('whoami works as a connection check', async () => {
    const r = await call('chronicle_whoami', {}, dm());
    expect(r.data).toMatchObject({ role: 'dm', connection: { client_id: 'synthetic-mcp-client', database: 'reachable' }, can: { read: true, propose: true, save_approved: true } });
    expect(Date.parse(r.data.connection.token_expires_at)).toBeGreaterThan(Date.now());
    expect((await call('chronicle_whoami', {}, player())).data.can).toEqual({ read: true, propose: false, save_approved: false });
  });
});
