// 20261114000100: assistants cannot forge source records, and a Gazette approval or printing is
// bound to the text the DM was looking at. Synthetic content only.
import type pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, ids, pool, resetFixtures, type ClaimsOverride } from './helpers.ts';

const A = 'a0000000-0000-4000-8000-00000000000a';
const OAUTH: ClaimsOverride = { extra: { client_id: 'synthetic-mcp-client' } };

async function tx<T>(claims: Record<string, unknown>, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.dm, role: 'authenticated', aud: 'authenticated', aal: 'aal1', ...claims })]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
const dm = <T>(fn: (c: pg.PoolClient) => Promise<T>) => tx({}, fn);

beforeEach(async () => {
  await resetFixtures();
  await admin("delete from public.articles where type = 'news'");
});
afterAll(() => pool.end());

describe('source records (provenance)', () => {
  it('an assistant cannot insert, change or delete them directly; the website DM can', async () => {
    const id = (await admin<{ id: string }>(`insert into public.provenance (article_id, kind, reference) values ($1, 'table_confirmed', 'synthetic') returning id`, [A])).rows[0]!.id;
    for (const sql of [
      `insert into public.provenance (article_id, kind, reference) values ('${A}', 'dm_confirmed', 'forged')`,
      `update public.provenance set kind = 'dm_confirmed', reference = 'forged' where id = '${id}'`,
      `delete from public.provenance where id = '${id}'`,
    ]) {
      expect((await as('dm', sql, [], OAUTH)).error?.code, sql).toBe('42501');
      expect((await as('dm', sql, [], { extra: { chronicle_client: 'synthetic' } })).error?.code, sql).toBe('42501');
      expect((await as('dm', sql)).error, sql).toBeUndefined();
      expect((await as('player', sql)).rowCount, sql).toBe(0);
    }
    expect((await admin(`select kind, reference from public.provenance where id = $1`, [id])).rows[0]).toEqual({ kind: 'table_confirmed', reference: 'synthetic' });
  });

  it('an approved assistant change set still records where its facts came from', async () => {
    const mcp = { client_id: 'synthetic-mcp-client' };
    const cs = { label: 'Synthetic', source_kind: 'table_confirmed', changes: [{ operation: 'create_article', slug: 'zz-sourced', title: 'Sourced', type: 'lore', summary: 'Synthetic.' }, { operation: 'upsert_section', article_slug: 'zz-sourced', heading: 'Notes', body: 'Synthetic body.' }] };
    const p = await tx(mcp, (c) => c.query('select public.preview_change_set($1::jsonb) as r', [JSON.stringify(cs)]).then((r) => r.rows[0].r as { preview_id: string; digest: string }));
    await dm((c) => c.query('select public.approve_change_preview($1)', [p.preview_id]));
    await tx(mcp, (c) => c.query('select public.apply_change_set($1, $2, $3)', [p.preview_id, p.digest, 'key-hardening-1']));
    const rows = await admin(`select p.kind from public.provenance p join public.articles a on a.id = p.article_id where a.slug = 'zz-sourced'`);
    expect(rows.rows.map((r) => r.kind)).toContain('table_confirmed');
  });
});

describe('Gazette review is bound to the text the DM saw', () => {
  const story = {
    article: { slug: 'zz-bound', title: 'Seen headline', summary: 'Seen opening.' },
    sections: [{ heading: '', body: 'Seen body.', visibility: 'players', status: 'published' }],
    details: { section: 'local', reliability: 'confirmed', reporter: 'nib', dateline: '', in_world_date: '', issue_number: 1 },
  };
  const save = (s: unknown) => dm((c) => c.query('select public.save_news_story($1::jsonb) as r', [JSON.stringify(s)]).then((r) => r.rows[0].r as { id: string; version: string }));
  const version = async (id: string) => `v${(await admin<{ version: string }>('select version from public.articles where id = $1', [id])).rows[0]!.version}`;
  const step = (id: string, action: string, expected: string | null, revision: string | null = null) =>
    dm((c) => c.query('select public.news_transition($1, $2, $3, $4) as r', [id, action, expected, revision]).then((r) => r.rows[0].r as { review_state: string; status: string }));
  const state = async (id: string) => (await admin<{ s: string; status: string }>('select n.review_state::text s, a.status from public.news_stories n join public.articles a on a.id = n.article_id where a.id = $1', [id])).rows[0]!;

  it('approving from a stale tab is refused; approving the current text works', async () => {
    const { id } = await save(story);
    await step(id, 'submit', await version(id));
    const seen = await version(id);
    // Another tab saves different text while the story is in review (it stays in review).
    await save({ ...story, article: { ...story.article, id }, sections: [{ heading: '', body: 'UNSEEN TEXT.', visibility: 'players', status: 'published' }] });
    await expect(step(id, 'approve', seen)).rejects.toThrow(/CONFLICT/);
    expect((await state(id)).s).toBe('in_review');
    expect((await step(id, 'approve', await version(id))).review_state).toBe('approved');
  });

  it('printing from a stale tab is refused, and nothing reaches players', async () => {
    const { id } = await save(story);
    await step(id, 'submit', await version(id));
    await step(id, 'approve', await version(id));
    await expect(step(id, 'publish', 'v0')).rejects.toThrow(/CONFLICT/);
    expect((await state(id)).status).toBe('draft');
    expect((await as('player', 'select 1 from public.articles where id = $1', [id])).rowCount).toBe(0);
    expect((await step(id, 'publish', await version(id))).status).toBe('published');
  });

  it('a waiting revision replaced in another tab cannot be approved from the stale one', async () => {
    const { id } = await save(story);
    for (const a of ['submit', 'approve', 'publish']) await step(id, a, await version(id));
    const revise = (body: string) => save({ ...story, article: { ...story.article, id }, sections: [{ heading: '', body, visibility: 'players', status: 'published' }] });
    const stamp = async () => (await admin<{ t: string }>(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') t from public.news_pending where article_id = $1`, [id])).rows[0]!.t;
    await revise('First revision.');
    await step(id, 'submit', await version(id), await stamp());
    const seen = await stamp();
    await revise('UNSEEN REVISION.');
    await step(id, 'submit', await version(id), await stamp());
    await expect(step(id, 'approve', await version(id), seen)).rejects.toThrow(/CONFLICT/);
    const read = async () => (await as<{ body: string }>('player', 'select body from public.article_sections where article_id = $1', [id])).rows.map((r) => r.body);
    expect(await read()).toEqual(['Seen body.']);
    await step(id, 'approve', await version(id), await stamp());
    expect(await read()).toEqual(['UNSEEN REVISION.']);
  });

  it('is DM-only and website-only, like the two-argument function', async () => {
    const { id } = await save(story);
    const call = `select public.news_transition($1, 'submit', null, null)`;
    expect((await as('player', call, [id])).error?.message).toBe('FORBIDDEN');
    expect((await as('dm', call, [id], OAUTH)).error?.message).toBe('FORBIDDEN');
    expect((await as('anon', call, [id])).error?.code).toBe('42501');
    expect((await as('dm', call, [id])).error).toBeUndefined();
  });
});

describe('two sessions at the same moment', () => {
  async function open(claims: Record<string, unknown> = {}) {
    const c = await pool.connect();
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.dm, role: 'authenticated', aud: 'authenticated', aal: 'aal1', ...claims })]);
    await c.query("set local lock_timeout = '10s'");
    return c;
  }
  const settled = <T>(p: Promise<T>) => Promise.race([p.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('waiting'), 400))]);
  const close = async (c: pg.PoolClient, ok: boolean) => {
    await c.query(ok ? 'commit' : 'rollback').catch(() => undefined);
    c.release();
  };

  it('two saves of the same article version: the second waits, then gets CONFLICT and writes nothing', async () => {
    const row = (await admin<{ version: string }>('select version from public.articles where id = $1', [A])).rows[0]!;
    const draft = (summary: string) => JSON.stringify({ article: { id: A, slug: 'public-article', type: 'character', title: 'Public Article', summary, visibility: 'players', status: 'published' }, sections: [], infobox: [], categoryIds: [] });
    const first = await open();
    const second = await open();
    await first.query('select public.save_article($1::jsonb, $2)', [draft('First tab.'), `v${row.version}`]);
    const late = second.query('select public.save_article($1::jsonb, $2)', [draft('Second tab.'), `v${row.version}`]);
    expect(await settled(late)).toBe('waiting');
    await close(first, true);
    await expect(late).rejects.toThrow(/CONFLICT/);
    await close(second, false);
    expect((await admin('select summary from public.articles where id = $1', [A])).rows[0]!.summary).toBe('First tab.');
  });

  it('one approved proposal applied twice at once is applied exactly once', async () => {
    const mcp = { client_id: 'synthetic-mcp-client' };
    const cs = { label: 'Synthetic', source_kind: 'dm_confirmed', changes: [{ operation: 'create_article', slug: 'zz-once', title: 'Once', type: 'lore' }] };
    const p = await tx(mcp, (c) => c.query('select public.preview_change_set($1::jsonb) as r', [JSON.stringify(cs)]).then((r) => r.rows[0].r as { preview_id: string; digest: string }));
    await dm((c) => c.query('select public.approve_change_preview($1)', [p.preview_id]));
    const first = await open(mcp);
    const second = await open(mcp);
    await first.query('select public.apply_change_set($1, $2, $3)', [p.preview_id, p.digest, 'key-race-first']);
    const late = second.query('select public.apply_change_set($1, $2, $3)', [p.preview_id, p.digest, 'key-race-second']);
    expect(await settled(late)).toBe('waiting');
    await close(first, true);
    await expect(late).rejects.toThrow();
    await close(second, false);
    expect((await admin(`select count(*)::int n from public.articles where slug = 'zz-once'`)).rows[0]!.n).toBe(1);
    expect((await admin(`select count(*)::int n from public.change_sets where preview_id = $1`, [p.preview_id])).rows[0]!.n).toBe(1);
  });

  it('approving while another tab is saving waits, then refuses the stale approval', async () => {
    const story = { article: { slug: 'zz-race', title: 'Race', summary: 's' }, sections: [{ heading: '', body: 'Seen.', visibility: 'players', status: 'published' }], details: { section: 'local', reliability: 'confirmed', reporter: 'nib', dateline: '', in_world_date: '', issue_number: 1 } };
    const id = await dm((c) => c.query('select public.save_news_story($1::jsonb) as r', [JSON.stringify(story)]).then((r) => r.rows[0].r.id as string));
    await dm((c) => c.query(`select public.news_transition($1, 'submit')`, [id]));
    const seen = `v${(await admin<{ version: string }>('select version from public.articles where id = $1', [id])).rows[0]!.version}`;
    const saving = await open();
    const approving = await open();
    await saving.query('select public.save_news_story($1::jsonb)', [JSON.stringify({ ...story, article: { ...story.article, id }, sections: [{ heading: '', body: 'UNSEEN.', visibility: 'players', status: 'published' }] })]);
    const late = approving.query(`select public.news_transition($1, 'approve', $2, null)`, [id, seen]);
    expect(await settled(late)).toBe('waiting');
    await close(saving, true);
    await expect(late).rejects.toThrow(/CONFLICT/);
    await close(approving, false);
    expect((await admin<{ s: string }>('select review_state::text s from public.news_stories where article_id = $1', [id])).rows[0]!.s).toBe('in_review');
  });
});
