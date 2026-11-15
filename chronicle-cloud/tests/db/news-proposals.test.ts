// Gazette story proposals (20261116000200): an assistant files a proposal; only the DM, on the
// website, accepts it (as a private draft story) or dismisses it. Nothing is ever printed by this.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, pool, resetFixtures, type ClaimsOverride } from './helpers.ts';

const OAUTH: ClaimsOverride = { extra: { client_id: 'synthetic-mcp-client' } };
const insert = `insert into public.news_proposals (title, subtitle, summary, body, section, reliability, reporter, based_on, status, article_id)
  values ('Zz Goats Elect a Mayor', 'Close vote', 'An opening.', 'The goats voted.', 'rumors', 'rumor', 'pinchcheek', '{port-vellmoor}', 'accepted', 'a0000000-0000-4000-8000-00000000000a')
  returning id, status, article_id, created_via`;

beforeEach(async () => {
  await resetFixtures();
  await admin('delete from public.news_proposals');
  await admin("delete from public.articles where type = 'news'");
});
afterAll(() => pool.end());

const staged = async () => (await admin<{ id: string }>(`insert into public.news_proposals (title, body, section, reliability, reporter) values ('Zz Tide Late', 'The tide was late.', 'local', 'rumor', 'nib') returning id`)).rows[0]!.id;

describe('story proposals', () => {
  it('an assistant can file one; it starts pending and attached to nothing, whatever it asks', async () => {
    const r = await as('dm', insert, [], OAUTH);
    expect(r.error).toBeUndefined();
    expect(r.rows[0]).toMatchObject({ status: 'pending', article_id: null, created_via: 'synthetic-mcp-client' });
    expect((await as('dm', insert.replace("'rumors'", "'not-a-section'"), [], OAUTH)).error?.code).toBe('22P02');
  });

  it('players and others can neither see nor file proposals', async () => {
    await staged();
    for (const who of ['player', 'revoked', 'outsider'] as const) {
      expect((await as(who, 'select * from public.news_proposals')).rowCount, who).toBe(0);
      expect((await as(who, insert)).error?.code, who).toBe('42501');
    }
    expect((await as('anon', 'select * from public.news_proposals')).error?.code).toBe('42501');
  });

  it('an assistant cannot accept, dismiss, rewrite or delete a proposal', async () => {
    const id = await staged();
    expect((await as('dm', 'select public.accept_news_proposal($1)', [id], OAUTH)).error?.message).toBe('FORBIDDEN');
    for (const sql of [
      `update public.news_proposals set status = 'dismissed' where id = $1`,
      `update public.news_proposals set body = 'changed' where id = $1`,
      `update public.news_proposals set article_id = 'a0000000-0000-4000-8000-00000000000a' where id = $1`,
      `delete from public.news_proposals where id = $1`,
    ]) expect((await as('dm', sql, [id], OAUTH)).error?.code, sql).toBe('42501');
    expect((await admin('select status from public.news_proposals where id = $1', [id])).rows[0]!.status).toBe('pending');
  });

  it('the DM accepts it on the website: a private draft story with the proposed details, once', async () => {
    const id = await staged();
    const r = await as<{ r: { id: string; slug: string } }>('dm', 'select public.accept_news_proposal($1) as r', [id]);
    expect(r.error).toBeUndefined();
    // `as` rolls back; do it for real to inspect the result.
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: '00000000-0000-4000-8000-0000000000d1', role: 'authenticated', aal: 'aal1' })]);
      const saved = (await c.query('select public.accept_news_proposal($1) as r', [id])).rows[0].r as { id: string; slug: string };
      await c.query('commit');
      expect(saved.slug).toBe('zz-tide-late');
      const story = (await admin(`select a.visibility::text v, a.status::text s, a.type::text t, n.review_state::text rs, n.reliability::text rel, n.reporter, n.section::text sec,
        (select body from public.article_sections where article_id = a.id) body from public.articles a join public.news_stories n on n.article_id = a.id where a.id = $1`, [saved.id])).rows[0];
      expect(story).toEqual({ v: 'dm', s: 'draft', t: 'news', rs: 'draft', rel: 'rumor', reporter: 'nib', sec: 'local', body: 'The tide was late.' });
      expect((await admin('select status, article_id from public.news_proposals where id = $1', [id])).rows[0]).toEqual({ status: 'accepted', article_id: saved.id });
    } finally {
      c.release();
    }
    expect((await as('dm', 'select public.accept_news_proposal($1)', [id])).error?.message).toBe('CONFLICT');
    expect((await as('player', `select 1 from public.articles where type = 'news'`)).rowCount).toBe(0);
  });

  it('a second proposal with the same headline gets its own address; a dismissed one cannot be accepted', async () => {
    const a = await staged();
    const b = await staged();
    const accept = async (id: string) => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query('set local role authenticated');
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: '00000000-0000-4000-8000-0000000000d1', role: 'authenticated', aal: 'aal1' })]);
        const r = (await c.query('select public.accept_news_proposal($1) as r', [id])).rows[0].r as { slug: string };
        await c.query('commit');
        return r;
      } finally {
        c.release();
      }
    };
    expect((await accept(a)).slug).toBe('zz-tide-late');
    expect((await accept(b)).slug).toMatch(/^zz-tide-late-[0-9a-f]{6}$/);
    const d = await staged();
    expect((await as('dm', `update public.news_proposals set status = 'dismissed' where id = $1 returning status`, [d])).rows[0]).toEqual({ status: 'dismissed' });
    await admin(`update public.news_proposals set status = 'dismissed' where id = $1`, [d]);
    expect((await as('dm', 'select public.accept_news_proposal($1)', [d])).error?.message).toBe('CONFLICT');
    expect((await as('dm', `update public.news_proposals set status = 'pending' where id = $1`, [d])).error?.code).toBe('42501');
  });

  it('limits what an assistant can file directly: item length and 50 waiting proposals', async () => {
    const long = insert.replace("'{port-vellmoor}'", `'{"${'x'.repeat(301)}"}'`);
    expect((await as('dm', long, [], OAUTH)).error?.message).toBe('VALIDATION_FAILED');
    await admin(`insert into public.news_proposals (title, body, section, reliability, reporter)
      select 'Zz Filler ' || g, 'Body.', 'local', 'rumor', 'nib' from generate_series(1, 50) g`);
    expect((await as('dm', insert, [], OAUTH)).error?.message).toBe('RATE_LIMITED');
    // Deciding one frees a place.
    await admin(`update public.news_proposals set status = 'dismissed' where id = (select id from public.news_proposals limit 1)`);
    expect((await as('dm', insert, [], OAUTH)).error).toBeUndefined();
  });
});
