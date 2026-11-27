// Gazette batch workflow: an assistant files proposals with suggested release times; the DM, on the
// website, accepts + approves + schedules the chosen ones in one action. Synthetic content only.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, ids, pool, resetFixtures, type ClaimsOverride } from './helpers.ts';

const OAUTH: ClaimsOverride = { extra: { client_id: 'synthetic-mcp-client' } };

beforeEach(async () => {
  await resetFixtures();
  await admin('delete from public.news_proposals');
  await admin("delete from public.articles where type = 'news'");
});
afterAll(async () => {
  // These tests commit rows; leave none behind for suites that share the database (the queue holds 50).
  await admin('delete from public.news_proposals');
  await admin("delete from public.articles where type = 'news'");
  await pool.end();
});

const inFuture = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
/** Runs one statement as a member and COMMITS (the `as` helper rolls back), optionally as an OAuth client. */
async function asCommitted<T = unknown>(sub: string, sql: string, params: unknown[] = [], extra: Record<string, unknown> = {}): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: 'authenticated', aal: 'aal1', ...extra })]);
    const { rows } = await c.query(sql, params);
    await c.query('commit');
    return rows[0] as T;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const asDm = <T = unknown>(sql: string, params: unknown[] = []) => asCommitted<T>(ids.dm, sql, params);
/** An assistant filing a proposal: the DM's account, but a token issued to an OAuth client. */
async function file(title: string, suggested: string | null = null, reporter = 'gribble') {
  const r = await asCommitted<{ id: string }>(ids.dm,
    `insert into public.news_proposals (title, subtitle, body, section, reliability, reporter, suggested_publish_at)
     values ($1, 'A deck', $2, 'war', 'rumor', $3, $4) returning id`, [title, `BATCHBODY ${title}`, reporter, suggested], { client_id: 'synthetic-mcp-client' });
  return r.id;
}
const batch = (items: unknown[]) => asDm<{ r: { state: string; slug: string; article_id: string; proposal_id: string }[] }>('select public.schedule_news_proposals($1::jsonb) as r', [JSON.stringify(items)]);
const batchAs = (who: 'dm' | 'player' | 'outsider' | 'revoked', items: unknown[], claims: ClaimsOverride = {}) =>
  as('player' === who ? 'player' : who, 'select public.schedule_news_proposals($1::jsonb) as r', [JSON.stringify(items)], claims);
/** The database reports the code as the message and the readable text in the detail. */
async function refused(run: Promise<unknown>, code: string, text: RegExp) {
  const e = await run.then(() => null, (err: unknown) => err as { message: string; detail?: string });
  expect(e, 'expected a refusal').not.toBeNull();
  expect(e!.message).toBe(code);
  expect(e!.detail ?? '').toMatch(text);
}
const playerSees = async () => (await as<{ title: string }>('player', "select title from public.articles where type = 'news'")).rows.map((r) => r.title);

describe('suggested release times', () => {
  it('are kept exactly as the assistant filed them, and cannot be rewritten afterwards', async () => {
    const at = inFuture(120);
    const id = await file('Zz Suggested', at);
    const row = (await admin('select suggested_publish_at, created_via from public.news_proposals where id = $1', [id])).rows[0]!;
    expect(new Date(row.suggested_publish_at).toISOString()).toBe(at);
    expect(row.created_via).toBe('synthetic-mcp-client');
    expect((await as('dm', "update public.news_proposals set suggested_publish_at = now() where id = $1", [id])).error?.code).toBe('42501');
    expect((await as('dm', "update public.news_proposals set suggested_publish_at = now() where id = $1", [id], OAUTH)).error?.code).toBe('42501');
  });
});

describe('accept, approve and schedule in one action', () => {
  it('accepts, approves and schedules several stories; players see none before their time', async () => {
    const a = await file('Zz First', inFuture(60));
    const b = await file('Zz Second', inFuture(1500));
    const res = (await batch([{ id: a, at: inFuture(60) }, { id: b, at: inFuture(1500) }])).r;
    expect(res.map((x) => x.state)).toEqual(['scheduled', 'scheduled']);
    const rows = (await admin(`select a.title, a.status::text, a.visibility::text, a.publish_at is not null as scheduled, s.review_state::text, s.reporter
      from public.articles a join public.news_stories s on s.article_id = a.id where a.type = 'news' order by a.title`)).rows;
    expect(rows).toEqual([
      { title: 'Zz First', status: 'draft', visibility: 'dm', scheduled: true, review_state: 'approved', reporter: 'gribble' },
      { title: 'Zz Second', status: 'draft', visibility: 'dm', scheduled: true, review_state: 'approved', reporter: 'gribble' },
    ]);
    expect(await playerSees()).toEqual([]);
    // Audit: who filed it, who decided, when, and the link to the story.
    const audit = (await admin(`select status, created_via, decided_by, decided_at is not null as decided, article_id is not null as linked from public.news_proposals order by title`)).rows;
    expect(audit).toEqual([
      { status: 'accepted', created_via: 'synthetic-mcp-client', decided_by: ids.dm, decided: true, linked: true },
      { status: 'accepted', created_via: 'synthetic-mcp-client', decided_by: ids.dm, decided: true, linked: true },
    ]);
    expect((await admin("select count(*)::int as n from public.news_stories where reviewed_at is not null")).rows[0]!.n).toBe(2);
  });

  it('the first story is released by the database clock at its time; the second stays hidden', async () => {
    const a = await file('Zz Due', inFuture(60));
    const b = await file('Zz Later', inFuture(1500));
    const res = (await batch([{ id: a, at: inFuture(60) }, { id: b, at: inFuture(1500) }])).r;
    await admin("update public.articles set publish_at = now() - interval '1 minute' where id = $1", [res[0]!.article_id]);
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.player, role: 'authenticated', aal: 'aal1' })]);
      expect((await c.query('select public.release_due_stories() as n')).rows[0].n).toBe(1);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect(await playerSees()).toEqual(['Zz Due']);
  });

  it('a time that has passed is refused (nothing changes); "print now" is the DM\'s explicit choice', async () => {
    const a = await file('Zz Missed', inFuture(-300));
    const ok = await file('Zz Fine', inFuture(60));
    await refused(batch([{ id: ok, at: inFuture(60) }, { id: a, at: inFuture(-300) }]), 'VALIDATION_FAILED', /already passed/);
    // All or nothing: the fine one was not touched either.
    expect((await admin("select count(*)::int as n from public.articles where type = 'news'")).rows[0]!.n).toBe(0);
    expect((await admin("select count(*)::int as n from public.news_proposals where status = 'pending'")).rows[0]!.n).toBe(2);
    const res = (await batch([{ id: a, print_now: true }, { id: ok, at: inFuture(60) }])).r;
    expect(res.map((x) => x.state)).toEqual(['printed', 'scheduled']);
    expect(await playerSees()).toEqual(['Zz Missed']);
  });

  it('a story with no time is approved and waits; nothing is printed unless the DM chooses', async () => {
    const id = await file('Zz Waits');
    const res = (await batch([{ id }])).r;
    expect(res[0]!.state).toBe('approved');
    expect((await admin("select status::text, publish_at from public.articles where type = 'news'")).rows[0]).toEqual({ status: 'draft', publish_at: null });
    expect(await playerSees()).toEqual([]);
  });

  it('refuses a duplicate title (existing story, repeated proposal, or twice in one batch)', async () => {
    const first = await file('Zz Same Title', inFuture(60));
    await batch([{ id: first, at: inFuture(60) }]);
    const again = await file('zz same title ', inFuture(120));
    await refused(batch([{ id: again, at: inFuture(120) }]), 'ALREADY_EXISTS', /already has a story/);
    const x = await file('Zz Twin A', inFuture(60));
    const y = await file('Zz Twin A', inFuture(120));
    await refused(batch([{ id: x, at: inFuture(60) }, { id: y, at: inFuture(120) }]), 'ALREADY_EXISTS', /already has a story/);
    expect((await admin("select count(*)::int as n from public.articles where type = 'news'")).rows[0]!.n).toBe(1);
  });

  it('cannot be run twice on the same proposal, nor with bad input', async () => {
    const id = await file('Zz Once', inFuture(60));
    await batch([{ id, at: inFuture(60) }]);
    await refused(batch([{ id, at: inFuture(90) }]), 'CONFLICT', /already accepted/);
    await refused(batch([]), 'VALIDATION_FAILED', /between 1 and 20/);
    await refused(batch([{ id: 'not-a-uuid' }]), 'VALIDATION_FAILED', /not valid/);
    const other = await file('Zz Both');
    await refused(batch([{ id: other, at: inFuture(60), print_now: true }]), 'VALIDATION_FAILED', /not both/);
  });
});

describe('who may do it', () => {
  it('only the DM on the website: players, outsiders, revoked members and assistants are refused', async () => {
    const id = await file('Zz Guarded', inFuture(60));
    const items = [{ id, at: inFuture(60) }];
    for (const who of ['player', 'outsider', 'revoked'] as const) {
      expect((await batchAs(who, items)).error?.message, who).toBe('FORBIDDEN');
    }
    expect((await as('anon', 'select public.schedule_news_proposals($1::jsonb)', [JSON.stringify(items)])).error).toBeDefined();
    // The DM's own token, but issued to an assistant (OAuth client): refused.
    expect((await batchAs('dm', items, OAUTH)).error?.message).toBe('FORBIDDEN');
    expect((await admin("select status from public.news_proposals where id = $1", [id])).rows[0]!.status).toBe('pending');
    expect((await admin("select count(*)::int as n from public.articles where type = 'news'")).rows[0]!.n).toBe(0);
  });

  it('an assistant still cannot approve, schedule or print a story by any route', async () => {
    const id = await file('Zz NoRoute', inFuture(60));
    const { r } = await batch([{ id, at: inFuture(60) }]).then((x) => ({ r: x.r[0]! }));
    for (const sql of [
      ["select public.news_transition($1, 'approve')", [r.article_id]],
      ["select public.news_transition($1, 'publish')", [r.article_id]],
      ['select public.news_schedule($1, now() + interval \'1 day\')', [r.article_id]],
    ] as [string, unknown[]][]) {
      expect((await as('dm', sql[0], sql[1], OAUTH)).error?.message).toBe('FORBIDDEN');
    }
  });
});
