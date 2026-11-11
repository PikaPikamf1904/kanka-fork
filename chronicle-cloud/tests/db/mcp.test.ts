/* eslint-disable @typescript-eslint/no-explicit-any -- tool results are free-form JSON in these tests */
// Chronicle MCP server against the LOCAL stack (real PostgREST + RLS), with synthetic users and
// locally signed tokens. Nothing here touches a hosted project or a real MCP client.
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
const ver = async (slug: string) => `v${(await admin('select version from public.articles where slug = $1', [slug])).rows[0]!.version}`;
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
afterAll(() => pool.end());

describe('protocol and discovery', () => {
  it('challenges unauthenticated requests and says where to sign in (AUTH-01)', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toBe('Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"');
    expect(JSON.stringify(r.json)).toBe('{"error":"UNAUTHENTICATED"}');
    const meta = await handleRequest(new Request('https://mcp.example/.well-known/oauth-protected-resource'), env);
    expect(await meta.json()).toMatchObject({ resource: 'https://mcp.example/mcp', authorization_servers: [`${env.SUPABASE_URL}/auth/v1`], bearer_methods_supported: ['header'] });
  });

  it('answers CORS preflight and refuses GET without leaking anything', async () => {
    const pre = await handleRequest(new Request('https://mcp.example/mcp', { method: 'OPTIONS', headers: { origin: 'https://inspector.example', 'access-control-request-method': 'POST' } }), env);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toContain('authorization');
    expect(pre.headers.get('access-control-expose-headers')).toContain('www-authenticate');
    const get = await handleRequest(new Request('https://mcp.example/mcp'), env);
    expect(get.status).toBe(405);
    const meta = await (await handleRequest(new Request('https://mcp.example/.well-known/oauth-protected-resource/mcp'), env)).json() as Record<string, unknown>;
    expect(meta.scopes_supported).toBeUndefined();
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, dm());
    expect(init.json!.result.protocolVersion).toBe('2025-11-25');
    expect(init.json!.result.instructions.slice(0, 512)).toContain('preview');
  });

  it('health shows a version and nothing else', async () => {
    const res = await handleRequest(new Request('https://mcp.example/health'), env);
    const body = JSON.stringify(await res.json());
    expect(body).toContain('chronicle-mcp');
    expect(body).not.toMatch(/supabase|127\.0\.0\.1|key|secret/i);
  });

  it('initializes, lists exactly the implemented tools with accurate annotations, and answers ping', async () => {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, dm());
    expect(init.json!.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'chronicle-mcp' }, capabilities: { tools: {} } });
    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, dm())).status).toBe(202);
    expect((await post({ jsonrpc: '2.0', id: 2, method: 'ping' }, dm())).json!.result).toEqual({});
    const tools = (await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, dm())).json!.result.tools as { name: string; annotations: { readOnlyHint: boolean }; inputSchema: { type: string } }[];
    expect(tools.map((t) => t.name).sort()).toEqual([
      'chronicle_add_dm_note', 'chronicle_apply_changes', 'chronicle_audit_links', 'chronicle_create_character_draft', 'chronicle_find_duplicates',
      'chronicle_get_article', 'chronicle_get_character', 'chronicle_get_provenance', 'chronicle_get_revisions', 'chronicle_get_timeline',
      'chronicle_list_characters', 'chronicle_list_drafts', 'chronicle_list_sessions', 'chronicle_preview_changes', 'chronicle_preview_import',
      'chronicle_restore_revision', 'chronicle_search', 'chronicle_suggest_connections', 'chronicle_whoami']);
    expect(tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name)).toEqual(['chronicle_apply_changes']);
    expect(tools.every((t) => t.inputSchema.type === 'object')).toBe(true);
    expect(JSON.stringify(tools)).not.toMatch(/publish_article|delete|sql|access.code|password/i);
    expect((await post({ jsonrpc: '2.0', id: 4, method: 'resources/list' }, dm())).json!.error.code).toBe(-32601);
    expect((await post({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'chronicle_publish_article', arguments: {} } }, dm())).json!.error.code).toBe(-32602);
  });
});

describe('tokens (AUTH-02, 03, 04, 09, 10)', () => {
  it('refuses forged, expired, wrong-issuer, wrong-audience, malformed and website tokens', async () => {
    const bad: [string, string][] = [
      ['forged signature', token('dm', {}, 'x'.repeat(64))],
      ['expired', token('dm', { exp: Math.floor(Date.now() / 1000) - 5 })],
      ['wrong issuer', token('dm', { iss: 'https://evil.example/auth/v1' })],
      ['wrong audience', token('dm', { aud: 'something-else' })],
      ['service role', token('dm', { role: 'service_role' })],
      ['website session (no client id)', token('dm', { client_id: undefined })],
      ['claims to be the website', token('dm', { client_id: 'web' })],
      ['alg none', `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: ids.dm, role: 'authenticated', aud: 'authenticated', exp: 9999999999, client_id: CLIENT, iss: `${env.SUPABASE_URL}/auth/v1` })).toString('base64url')}.`],
      ['garbage', 'not-a-token'],
    ];
    for (const [name, t] of bad) {
      const r = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'chronicle_search', arguments: { query: 'captain' } } }, t);
      expect(r.status, name).toBe(401);
      expect(JSON.stringify(r.json), name).toBe('{"error":"UNAUTHENTICATED"}');
    }
  });

  it('a role claim in the token or user metadata grants nothing', async () => {
    const t = token('player', { user_role: 'dm', app_metadata: { role: 'dm' }, user_metadata: { role: 'dm' }, aal: 'aal2' });
    expect((await call('chronicle_whoami', {}, t)).data).toMatchObject({ role: 'player' });
    expect((await call('chronicle_preview_changes', { change_set: { changes: [{ operation: 'create_article', slug: 'x', title: 'X', type: 'lore' }] } }, t)).error.code).toBe('FORBIDDEN');
  });

  it('scopes can be narrowed per client, and a broken setting grants nothing', async () => {
    const readOnly = { ...env, MCP_CLIENT_SCOPES: JSON.stringify({ [CLIENT]: ['chronicle:read'] }) };
    expect((await call('chronicle_search', { query: 'captain' }, dm(), readOnly)).isError).toBe(false);
    expect((await call('chronicle_preview_changes', { change_set: { changes: [] } }, dm(), readOnly)).error).toMatchObject({ code: 'INSUFFICIENT_SCOPE', required_scope: 'chronicle:preview' });
    expect((await call('chronicle_search', { query: 'captain' }, dm(), { ...env, MCP_CLIENT_SCOPES: '{broken' })).error.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('non-members get nothing; a DM without two-step is refused DM tools; a revoked DM is refused on the next call (AUTH-07, 08)', async () => {
    expect((await call('chronicle_search', { query: 'captain' }, token('outsider'))).error.code).toBe('FORBIDDEN');
    expect((await call('chronicle_search', { query: 'captain' }, token('revoked'))).error.code).toBe('FORBIDDEN');
    expect((await call('chronicle_get_revisions', { slug: 'public-article' }, token('dmMfa'))).error.code).toBe('MFA_REQUIRED');
    expect((await call('chronicle_get_revisions', { slug: 'public-article' }, token('dmMfa', { aal: 'aal2' }))).isError).toBe(false);
    const t = dm();
    expect((await call('chronicle_get_revisions', { slug: 'public-article' }, t)).isError).toBe(false);
    await admin('update public.campaign_members set revoked_at = now() where user_id = $1', [ids.dm]);
    expect((await call('chronicle_get_revisions', { slug: 'public-article' }, t)).error.code).toBe('FORBIDDEN');
    expect((await call('chronicle_search', { query: 'captain' }, t)).error.code).toBe('FORBIDDEN');
  });
});

describe('reading as a player never leaks (AUTH-05, 06, 12, 13, 15)', () => {
  it('search finds nothing hidden and gives no count', async () => {
    for (const q of ['SPYMASTERWORD', 'SECRETWORD', 'HIDDENARTICLEWORD', 'DRAFTWORD', 'Spymaster']) {
      const asDm = await call('chronicle_search', { query: q }, dm());
      const asPlayer = await call('chronicle_search', { query: q }, player());
      expect(asDm.data.items.length, q).toBeGreaterThan(0);
      expect(asPlayer.data, q).toEqual({ items: [], next_cursor: null });
    }
  });

  it('a guessed hidden slug is NOT_FOUND, exactly like a missing one', async () => {
    const hidden = await call('chronicle_get_character', { slug: 'secret-article' }, player());
    const missing = await call('chronicle_get_character', { slug: 'no-such-page' }, player());
    expect(hidden.error).toEqual({ code: 'NOT_FOUND', message: 'No such page.' });
    expect(missing.error).toEqual(hidden.error);
    expect((await call('chronicle_get_article', { slug: 'draft-article' }, player())).error.code).toBe('NOT_FOUND');
    expect((await call('chronicle_get_character', { slug: 'secret-article' }, dm())).data.character.title).toBe('Hidden Spymaster');
  });

  it('a visible page comes without its DM sections, fields, tags and relations', async () => {
    const p = await call('chronicle_get_article', { slug: 'public-article' }, player());
    expect(p.data.sections.map((s: { heading: string }) => s.heading)).toEqual(['Known history']);
    expect(p.data.infobox_fields.map((f: { label: string }) => f.label)).toEqual(['Race']);
    expect(p.data.tags.map((t: { slug: string }) => t.slug)).toEqual(['sailors']);
    expect(p.data.relations.map((r: { kind: string }) => r.kind)).toEqual(['resides_in']);
    for (const word of ['SECRETWORD', 'INFOBOXSECRET', 'DRAFTWORD', 'Traitors', 'Spymaster', 'serves', 'NOTEWORD']) expect(p.raw, word).not.toContain(word);
    const d = await call('chronicle_get_article', { slug: 'public-article', include_revision_summary: true }, dm());
    expect(d.data.sections).toHaveLength(3);
    expect(d.raw).toContain('INFOBOXSECRET');
  });

  it('the character list shows players only visible characters, and DM tools are closed to them', async () => {
    const list = await call('chronicle_list_characters', {}, player());
    expect(list.data.items.map((c: { slug: string }) => c.slug)).toEqual(['public-article']);
    expect(list.data.items[0]).toMatchObject({ race: 'Human', portrait_media_id: null });
    expect(list.raw).not.toMatch(/signed|token=|storage\/v1/);
    expect((await call('chronicle_list_characters', {}, dm())).data.items).toHaveLength(2);
    expect((await call('chronicle_list_characters', { race: 'elf' }, dm())).data.items).toEqual([]);
    for (const [tool, args] of [['chronicle_get_revisions', { slug: 'public-article' }], ['chronicle_audit_links', { slug: 'public-article' }], ['chronicle_suggest_connections', { article_slug: 'public-article' }], ['chronicle_preview_import', { package: { articles: [] } }]] as const) {
      expect((await call(tool, args, player())).error.code, tool).toBe('FORBIDDEN');
    }
  });

  it('rejects malformed arguments without touching the database', async () => {
    for (const [tool, args] of [['chronicle_search', {}], ['chronicle_search', { query: 'x', limit: 1000 }], ['chronicle_get_article', { slug: '../etc' }], ['chronicle_list_characters', { group: 'gods' }], ['chronicle_search', { query: 'x', cursor: 'DROP' }]] as const) {
      expect((await call(tool, args, dm())).error.code, JSON.stringify(args)).toBe('VALIDATION_FAILED');
    }
  });
});

describe('DM read tools', () => {
  it('audits links: broken targets and player-visible text pointing at hidden pages', async () => {
    const r = await call('chronicle_audit_links', { scope: 'article', slug: 'public-article' }, dm());
    // The fixture's player-visible section links to a DM-only page.
    expect(r.data.potential_spoiler_edge.map((b: { target_slug: string }) => b.target_slug)).toEqual(['secret-article']);
    expect(r.data.broken).toEqual([]);
    await admin("update public.article_sections set body = 'Meets [[draft-article]] and [[nowhere-at-all]].' where id = '50000000-0000-4000-8000-000000000001'");
    const r2 = await call('chronicle_audit_links', { scope: 'all_accessible' }, dm());
    expect(r2.data.potential_spoiler_edge.map((b: { target_slug: string }) => b.target_slug)).toEqual(['draft-article']);
    expect(r2.data.broken.map((b: { target_slug: string }) => b.target_slug)).toContain('nowhere-at-all');
  });

  it('suggests connections only from links that exist, and saves nothing', async () => {
    const before = (await admin('select count(*) n from public.relations')).rows[0]!.n;
    await admin("insert into public.articles (id, slug, title) values ('a0000000-0000-4000-8000-0000000000f1', 'lonely-page', 'Lonely')");
    await admin("insert into public.article_sections (article_id, heading, body) values ('a0000000-0000-4000-8000-0000000000f1', 'Travels', 'Went to [[public-two|the harbour]] and [[not-a-page]].')");
    const r = await call('chronicle_suggest_connections', { article_slug: 'lonely-page' }, dm());
    expect(r.data.suggestions).toEqual([expect.objectContaining({ target_slug: 'public-two', suggested_visibility: 'dm', confidence: 'medium', evidence: { section_heading: 'Travels' } })]);
    // A page that already has a recorded connection gets no duplicate suggestion.
    expect((await call('chronicle_suggest_connections', { article_slug: 'public-three' }, dm())).data.suggestions).toEqual([]);
    expect((await admin('select count(*) n from public.relations')).rows[0]!.n).toBe(before);
  });
});

describe('preview, approve on the website, apply (DATA-13 and section D of the contracts)', () => {
  const draft = { draft: { title: 'Aella Test-Smith', summary: 'A cautious inventor.', fields: [{ label: 'Race', value: 'Gnome', visibility: 'players' }], sections: [{ heading: 'Personality', body: 'Talks quickly.', visibility: 'players', status: 'published' }] }, source_kind: 'dm_confirmed' };

  it('creating a character returns a preview and writes nothing until the DM approves in Chronicle', async () => {
    const p = await call('chronicle_create_character_draft', draft, dm());
    expect(p).toMatchObject({ review_required: true, isError: false });
    expect(p.data).toMatchObject({ created: ['aella-test-smith'], review_url: `https://wiki.example/dm/review/${p.data.preview_id}` });
    const count = async () => (await admin("select count(*) n from public.articles where slug = 'aella-test-smith'")).rows[0]!.n;
    expect(await count()).toBe('0');

    // "The user confirmed" from the client is not an approval.
    const refused = await call('chronicle_apply_changes', { preview_id: p.data.preview_id, digest: p.data.digest, idempotency_key: 'mcp-key-000001', user_confirmed: true }, dm());
    expect(refused.error).toMatchObject({ code: 'FORBIDDEN', review_required: true, review_url: p.data.review_url });
    expect(await count()).toBe('0');

    await approveOnWebsite(p.data.preview_id);
    const applied = await call('chronicle_apply_changes', { preview_id: p.data.preview_id, digest: p.data.digest, idempotency_key: 'mcp-key-000002' }, dm());
    expect(applied.data).toMatchObject({ created: ['aella-test-smith'], replayed: false });
    const again = await call('chronicle_apply_changes', { preview_id: p.data.preview_id, digest: p.data.digest, idempotency_key: 'mcp-key-000002' }, dm());
    expect(again.data).toMatchObject({ replayed: true });
    expect(await count()).toBe('1');
    const safe = await admin(`select a.visibility, a.status,
      (select count(*) from public.article_sections s where s.article_id = a.id and (s.visibility <> 'dm' or s.status <> 'draft')) s,
      (select count(*) from public.infobox_fields f where f.article_id = a.id and f.visibility <> 'dm') f from public.articles a where a.slug = 'aella-test-smith'`);
    expect(safe.rows[0]).toEqual({ visibility: 'dm', status: 'draft', s: '0', f: '0' });
    expect((await call('chronicle_get_character', { slug: 'aella-test-smith' }, player())).error.code).toBe('NOT_FOUND');
    expect((await call('chronicle_search', { query: 'inventor' }, player())).data.items).toEqual([]);
  });

  it('an approval by a different DM does not count, and a wrong digest is refused', async () => {
    const p = await call('chronicle_create_character_draft', draft, dm());
    await expect(approveOnWebsite(p.data.preview_id, 'dmMfa')).rejects.toThrow();
    await approveOnWebsite(p.data.preview_id);
    const wrong = await call('chronicle_apply_changes', { preview_id: p.data.preview_id, digest: 'sha256:' + 'a'.repeat(64), idempotency_key: 'mcp-key-000003' }, dm());
    expect(wrong.error.code).toBe('VALIDATION_FAILED');
  });

  it('a partial update changes only what it names; a concurrent edit turns apply into CONFLICT', async () => {
    const a = await call('chronicle_get_article', { slug: 'secret-article' }, dm());
    const sec = a.data.sections[0];
    const p = await call('chronicle_preview_changes', { change_set: { label: 'Edit', source_kind: 'dm_confirmed', changes: [
      { operation: 'upsert_section', article_slug: 'secret-article', expected_version: a.data.article.version, section_id: sec.id, heading: sec.heading, body: 'New biography.' }] } }, dm());
    expect(p.data.diffs).toEqual([expect.objectContaining({ field: 'body', before: 'HIDDENARTICLEWORD body.', after: 'New biography.' })]);
    await approveOnWebsite(p.data.preview_id);
    await admin("update public.articles set summary = 'Edited elsewhere' where slug = 'secret-article'");
    const r = await call('chronicle_apply_changes', { preview_id: p.data.preview_id, digest: p.data.digest, idempotency_key: 'mcp-key-000004' }, dm());
    expect(r.error.code).toBe('CONFLICT');
    expect((await admin("select body from public.article_sections where id = $1", [sec.id])).rows[0]!.body).toBe('HIDDENARTICLEWORD body.');
  });

  it('cannot edit text players can read, and import previews report create or skip', async () => {
    const v = await ver('public-article');
    const p = await call('chronicle_preview_changes', { change_set: { changes: [{ operation: 'patch_article', slug: 'public-article', expected_version: v, fields: { summary: 'x' } }] } }, dm());
    expect(p.error.code).toBe('VALIDATION_FAILED');
    const imp = await call('chronicle_preview_import', { package: { articles: [
      { slug: 'public-article', title: 'Dup', type: 'character', sections: [{ heading: 'h', body: 'b' }] },
      { slug: 'brand-new', title: 'Brand New', type: 'lore', visibility: 'players', status: 'published', sections: [{ heading: 'h', body: 'See [[missing-page]].' }] }] } }, dm());
    expect(imp.data.records).toEqual([expect.objectContaining({ slug: 'public-article', decision: 'skip' }), expect.objectContaining({ slug: 'brand-new', decision: 'create' })]);
    expect(imp.data.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'BROKEN_LINK', target_slug: 'missing-page' })]));
    expect((await admin("select count(*) n from public.articles where slug = 'brand-new'")).rows[0]!.n).toBe('0');
  });

  it('notes and restores are previews too, and a restore stays a draft', async () => {
    const v = await ver('secret-article');
    const note = await call('chronicle_add_dm_note', { article_slug: 'secret-article', title: 'Lead', body: 'Unverified.', expected_version: v }, dm());
    expect(note.data.diffs[0]).toMatchObject({ field: 'dm_note', operation: 'create' });
    expect((await admin("select count(*) n from public.dm_notes where title = 'Lead'")).rows[0]!.n).toBe('0');
    const bad = await call('chronicle_restore_revision', { article_slug: 'secret-article', revision_id: '00000000-0000-4000-8000-000000000000', expected_version: v }, dm());
    expect(bad.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('errors never carry database text or tokens (AUTH-17)', () => {
  it('a database failure comes back as a plain code', async () => {
    const t = dm();
    const failing: typeof fetch = async () => new Response(JSON.stringify({ code: '42P01', message: 'relation "public.secret_table" does not exist', details: 'select * from postgres' }), { status: 400 });
    const r = await call('chronicle_search', { query: 'captain' }, t, env, failing);
    expect(r.error.code).toBe('INTERNAL_ERROR');
    expect(r.isError).toBe(true);
    expect(r.raw).not.toContain(t);
    expect(r.raw).not.toMatch(/JWS|PGRST|select |relation|postgres/i);
  });
});

describe('recaps, timeline, drafts, provenance and duplicates', () => {
  it('reads a page by stable id, with the same not-found answer for a hidden one', async () => {
    const r = await call('chronicle_get_article', { id: 'a0000000-0000-4000-8000-00000000000a' }, player());
    expect(r.data.article.slug).toBe('public-article');
    const hidden = await call('chronicle_get_article', { id: 'a0000000-0000-4000-8000-00000000000b' }, player());
    const missing = await call('chronicle_get_article', { id: 'a0000000-0000-4000-8000-0000000000ff' }, player());
    expect(hidden.error).toEqual(missing.error);
    expect(hidden.raw).not.toContain('Spymaster');
    expect((await call('chronicle_get_article', { id: 'not-an-id' }, player())).error.code).toBe('VALIDATION_FAILED');
  });

  it('session recaps and the timeline show players only what they may read', async () => {
    await admin(`insert into public.articles (slug, type, title, summary, visibility, status, session_date) values
      ('session-1', 'session', 'Session 1', 'The party met.', 'players', 'published', '2026-01-05'),
      ('session-2', 'session', 'Session 2', 'SESSIONSECRET', 'dm', 'draft', '2026-01-12')`);
    const p = await call('chronicle_list_sessions', {}, player());
    expect(p.data.items.map((x: any) => x.slug)).toEqual(['session-1']);
    expect(p.raw).not.toContain('SESSIONSECRET');
    const d = await call('chronicle_list_sessions', {}, dm());
    expect(d.data.items.map((x: any) => x.slug)).toEqual(['session-2', 'session-1']);

    const t = await call('chronicle_get_timeline', {}, player());
    // An event attached to a page players cannot read is hidden with it (database policy).
    expect(t.data.items.map((x: any) => x.title)).toEqual(['Visible event']);
    expect(t.raw).not.toMatch(/TIMELINESECRET|Draft event|Spymaster|secret-article/);
    expect((await call('chronicle_get_timeline', {}, dm())).data.items).toHaveLength(4);
  });

  it('drafts, provenance and duplicate checks are DM-only', async () => {
    for (const [name, args] of [['chronicle_list_drafts', {}], ['chronicle_get_provenance', { slug: 'public-article' }], ['chronicle_find_duplicates', { names: ['Visible Captain'] }]] as const) {
      const r = await call(name, args, player());
      expect(r.error.code, name).toBe('FORBIDDEN');
    }
    const drafts = await call('chronicle_list_drafts', {}, dm());
    expect(drafts.data.drafts.items.map((x: any) => x.slug)).toContain('draft-article');
    expect(drafts.data.drafts.items.every((x: any) => x.slug !== 'public-article')).toBe(true);
    expect(drafts.data.previews_awaiting_approval).toEqual([]);
    const pv = await call('chronicle_create_character_draft', { draft: { title: 'Synthetic Tinker' } }, dm());
    const pending = await call('chronicle_list_drafts', {}, dm());
    expect(pending.data.previews_awaiting_approval).toEqual([expect.objectContaining({ preview_id: pv.data.preview_id, review_url: `https://wiki.example/dm/review/${pv.data.preview_id}` })]);
  });

  it('provenance lists the source of each recorded fact', async () => {
    const pv = await call('chronicle_create_character_draft', { source_kind: 'transcript_uncertain', draft: { title: 'Synthetic Tinker', fields: [{ label: 'Race', value: 'Gnome' }], sections: [{ heading: 'Seen', body: 'Met the party once.' }] } }, dm());
    await approveOnWebsite(pv.data.preview_id);
    const applied = await call('chronicle_apply_changes', { preview_id: pv.data.preview_id, digest: pv.data.digest, idempotency_key: 'prov-test-0001' }, dm());
    expect(applied.isError).toBe(false);
    const prov = await call('chronicle_get_provenance', { slug: 'synthetic-tinker' }, dm());
    const kinds = prov.data.records.map((r: any) => r.kind);
    expect(kinds.length).toBeGreaterThan(0);
    expect(new Set(kinds)).toEqual(new Set(['transcript_uncertain']));
    expect(prov.data.records.map((r: any) => r.applies_to)).toEqual(expect.arrayContaining([{ field: 'Race' }, { section: 'Seen' }]));
  });

  it('finds duplicates by address, redirect and title before a page is proposed', async () => {
    const r = await call('chronicle_find_duplicates', { names: ['Visible Captain', 'Old Captain Name', 'Harbour', 'Completely New Person'] }, dm());
    const [captain, redirect, harbour, fresh] = r.data.results;
    expect(captain).toMatchObject({ proposed_slug: 'visible-captain', likely_duplicate: true });
    expect(captain.candidates[0]).toMatchObject({ slug: 'public-article', strength: 'exact' });
    expect(redirect.candidates[0]).toMatchObject({ slug: 'public-article', strength: 'exact' });
    expect(harbour).toMatchObject({ likely_duplicate: true });
    expect(harbour.candidates[0]).toMatchObject({ slug: 'public-two', strength: 'strong' });
    expect(fresh).toMatchObject({ likely_duplicate: false });
    expect((await call('chronicle_find_duplicates', { names: [] }, dm())).error.code).toBe('VALIDATION_FAILED');
  });
});
