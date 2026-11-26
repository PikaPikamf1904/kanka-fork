// Living World: scheduled Gazette stories and Letters from Krynn. A scheduled story is a draft with
// a publish_at time; the database clock (not a device clock) releases it. Until then it is as
// invisible as any draft, by every read path. Synthetic content only.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, ids, pool, resetFixtures, type ClaimsOverride } from './helpers.ts';

beforeEach(async () => {
  await resetFixtures();
  await admin("delete from public.articles where type = 'news'");
});
afterAll(() => pool.end());

const OAUTH: ClaimsOverride = { extra: { client_id: 'synthetic-mcp-client' } };

const story = (slug: string, over: Record<string, unknown> = {}, details: Record<string, unknown> = {}) => ({
  article: { slug, title: `SCHEDTITLE ${slug}`, summary: 'Opening line.', ...over },
  sections: [{ heading: '', body: `SCHEDBODY ${slug}`, visibility: 'players', status: 'published' }],
  details: { section: 'local', reliability: 'confirmed', reporter: 'mossbottom', dateline: '', in_world_date: '', ...details },
});

/** Runs statements as a member and commits (the `as` helper rolls back). */
async function asCommitted<T = unknown>(sub: string, sql: string, params: unknown[] = []): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: 'authenticated', aal: 'aal1' })]);
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
const asDmCommitted = <T = unknown>(sql: string, params: unknown[] = []) => asCommitted<T>(ids.dm, sql, params);
const release = (who: 'player' | 'dm' = 'player') => asCommitted<{ n: number }>(ids[who], 'select public.release_due_stories() as n');
const save = async (s: unknown) => (await asDmCommitted<{ r: { id: string } }>('select public.save_news_story($1::jsonb) as r', [JSON.stringify(s)])).r.id;
const step = (id: string, a: string) => asDmCommitted('select public.news_transition($1, $2)', [id, a]);
async function approved(slug = 'daily-one', details: Record<string, unknown> = {}) {
  const id = await save(story(slug, {}, details));
  await step(id, 'submit');
  await step(id, 'approve');
  return id;
}
const schedule = (id: string, at: string | null, who: 'dm' | 'player' = 'dm', claims: ClaimsOverride = {}) =>
  as<{ r: unknown }>(who, 'select public.news_schedule($1, $2::timestamptz) as r', [id, at], claims);
const inFuture = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
/** Moves a story's time into the past, as the database owner would see time pass. */
const wind = (id: string, minutesAgo: number) =>
  admin("update public.articles set publish_at = now() - ($2 || ' minutes')::interval where id = $1", [id, String(minutesAgo)]);
const playerRows = async () => (await as<{ id: string; title: string }>('player', "select a.id, a.title from public.articles a where a.type = 'news'")).rows;

describe('Scheduling a Gazette story', () => {
  it('only an approved story can be scheduled, only in the future, only by the DM on the website', async () => {
    const draft = await save(story('not-approved'));
    expect((await schedule(draft, inFuture(60))).error?.message).toBe('FORBIDDEN');
    const id = await approved();
    expect((await schedule(id, inFuture(-5))).error?.message).toBe('VALIDATION_FAILED');
    expect((await schedule(id, inFuture(60), 'player')).error?.message).toBe('FORBIDDEN');
    expect((await schedule(id, inFuture(60), 'dm', OAUTH)).error?.message).toBe('FORBIDDEN');
    await asDmCommitted('select public.news_schedule($1, $2::timestamptz)', [id, inFuture(60)]);
    expect((await admin('select status, publish_at is not null as s from public.articles where id = $1', [id])).rows[0]).toEqual({ status: 'draft', s: true });
  });

  it('a scheduled story is invisible to players, by every read path, until its time', async () => {
    const id = await approved('hidden-until');
    await asDmCommitted('select public.news_schedule($1, $2::timestamptz)', [id, inFuture(60)]);
    expect(await playerRows()).toEqual([]);
    expect((await as('player', 'select * from public.news_stories')).rows).toEqual([]);
    expect((await as('player', 'select * from public.article_sections')).rows.filter((r: { body?: string }) => /SCHEDBODY/.test(r.body ?? ''))).toEqual([]);
    expect((await as('player', "select * from public.search_wiki('SCHEDTITLE')")).rows).toEqual([]);
    expect((await as('player', "select * from public.search_wiki('SCHEDBODY')")).rows).toEqual([]);
    expect((await as('player', "select * from public.suggest_articles('SCHEDTITLE')")).rows).toEqual([]);
    expect((await as('player', "select * from public.suggest_articles('sched')")).rows).toEqual([]);
    expect((await as('player', 'select * from public.article_links')).rows.filter((r: { source_article_id?: string }) => r.source_article_id === id)).toEqual([]);
    // Releasing early does nothing.
    expect((await release()).n).toBe(0);
    expect(await playerRows()).toEqual([]);
    // The DM can still read and edit it.
    expect((await as('dm', "select id from public.articles where id = $1", [id])).rows).toHaveLength(1);
  });

  it('is released by the database clock when its time comes, dated by its scheduled time', async () => {
    const id = await approved('on-time');
    await asDmCommitted('select public.news_schedule($1, $2::timestamptz)', [id, inFuture(60)]);
    await wind(id, 30);
    // Just before: another story, 1 minute ahead, is not released.
    const later = await approved('a-minute-away');
    await asDmCommitted('select public.news_schedule($1, $2::timestamptz)', [later, inFuture(1)]);
    expect((await release()).n).toBe(1);
    const row = await admin('select status, visibility, publish_at, published_at <= now() - interval \'29 minutes\' as dated from public.articles where id = $1', [id]);
    expect(row.rows[0]).toEqual({ status: 'published', visibility: 'players', publish_at: null, dated: true });
    expect((await playerRows()).map((x: { title: string }) => x.title)).toEqual(['SCHEDTITLE on-time']);
    expect((await as('player', "select * from public.search_wiki('SCHEDTITLE')")).rows.map((r: { title?: string }) => r.title)).toContain('SCHEDTITLE on-time');
    expect((await admin('select status from public.articles where id = $1', [later])).rows[0]!.status).toBe('draft');
    // Idempotent.
    expect((await release()).n).toBe(0);
  });

  it('boundary: due exactly now is released; one second ahead is not', async () => {
    const a = await approved('due-now');
    const b = await approved('one-second');
    await asDmCommitted('select public.news_schedule($1, $2::timestamptz)', [a, inFuture(60)]);
    await asDmCommitted('select public.news_schedule($1, $2::timestamptz)', [b, inFuture(60)]);
    await admin("update public.articles set publish_at = now() where id = $1", [a]);
    await admin("update public.articles set publish_at = now() + interval '2 seconds' where id = $1", [b]);
    await release();
    expect((await admin("select slug, status from public.articles where id in ($1, $2) order by slug", [a, b])).rows)
      .toEqual([{ slug: 'due-now', status: 'published' }, { slug: 'one-second', status: 'draft' }]);
  });

  it('can be rescheduled, cancelled, and publishes immediately on request', async () => {
    const id = await approved('movable');
    await asDmCommitted('select public.news_schedule($1, $2::timestamptz)', [id, inFuture(60)]);
    await asDmCommitted('select public.news_schedule($1, $2::timestamptz)', [id, inFuture(600)]);
    const t = (await admin('select publish_at from public.articles where id = $1', [id])).rows[0]!.publish_at as Date;
    expect(t.getTime() - Date.now()).toBeGreaterThan(500 * 60_000);
    await asDmCommitted('select public.news_schedule($1, null)', [id]);
    expect((await admin('select publish_at from public.articles where id = $1', [id])).rows[0]!.publish_at).toBeNull();
    // Print now, even when scheduled: dated now, schedule spent.
    await asDmCommitted('select public.news_schedule($1, $2::timestamptz)', [id, inFuture(600)]);
    await step(id, 'publish');
    const row = (await admin('select status, publish_at, published_at > now() - interval \'1 minute\' as fresh from public.articles where id = $1', [id])).rows[0];
    expect(row).toEqual({ status: 'published', publish_at: null, fresh: true });
    // A printed story cannot be scheduled.
    expect((await schedule(id, inFuture(60))).error?.message).toBe('CONFLICT');
  });

  it('several stories can share one day, and a story edited or sent back loses its schedule', async () => {
    const a = await approved('same-day-a');
    const b = await approved('same-day-b');
    const at = inFuture(120);
    await asDmCommitted('select public.news_schedule($1, $2::timestamptz)', [a, at]);
    await asDmCommitted('select public.news_schedule($1, $2::timestamptz)', [b, at]);
    expect((await admin('select count(*)::int as n from public.articles where publish_at is not null')).rows[0]!.n).toBe(2);
    // Editing an approved story sends it back to review: text nobody approved cannot go out on a timer.
    await asDmCommitted('select public.save_news_story($1::jsonb) as r', [JSON.stringify({ ...story('same-day-a', { id: a, title: 'EDITED' }), sections: [{ heading: '', body: 'changed', visibility: 'players', status: 'published' }] })]);
    expect((await admin('select publish_at from public.articles where id = $1', [a])).rows[0]!.publish_at).toBeNull();
    await step(b, 'return');
    expect((await admin('select publish_at from public.articles where id = $1', [b])).rows[0]!.publish_at).toBeNull();
    // And release refuses anything no longer approved, even if a time is forced onto it.
    await admin("update public.articles set publish_at = now() - interval '1 minute' where id in ($1, $2)", [a, b]);
    expect((await release()).n).toBe(0);
  });

  it('a DM-only part of a story stays DM-only after release, and a revoked player never sees it', async () => {
    const id = await save({ ...story('mixed'), sections: [
      { heading: '', body: 'SCHEDBODY public part', visibility: 'players', status: 'published' },
      { heading: 'Notes', body: 'SECRETPART dm only', visibility: 'dm', status: 'published' },
    ] });
    await step(id, 'submit'); await step(id, 'approve');
    await asDmCommitted('select public.news_schedule($1, $2::timestamptz)', [id, inFuture(10)]);
    await wind(id, 1);
    await release();
    const seen = JSON.stringify((await as('player', 'select body from public.article_sections')).rows);
    expect(seen).toMatch(/public part/);
    expect(seen).not.toMatch(/SECRETPART/);
    expect((await as('revoked', "select * from public.articles where type = 'news'")).rows).toEqual([]);
  });

  it('anonymous and outsider callers release nothing', async () => {
    const id = await approved('guarded');
    await asDmCommitted('select public.news_schedule($1, $2::timestamptz)', [id, inFuture(60)]);
    await wind(id, 5);
    expect((await as('anon', 'select public.release_due_stories() as n')).error).toBeDefined();
    expect((await asCommitted<{ n: number }>(ids.outsider, 'select public.release_due_stories() as n')).n).toBe(0);
    expect((await asCommitted<{ n: number }>(ids.revoked, 'select public.release_due_stories() as n')).n).toBe(0);
    expect((await admin('select status from public.articles where id = $1', [id])).rows[0]!.status).toBe('draft');
  });

  it('a scheduled story\'s picture stays private until release, then follows the story', async () => {
    const m = await admin("insert into public.media (path, visibility, alt) values ('synthetic/sched.png', 'dm', 'SCHEDPIC') returning id");
    const id = await save(story('with-picture', { hero_media_id: m.rows[0]!.id }));
    await step(id, 'submit'); await step(id, 'approve');
    await asDmCommitted('select public.news_schedule($1, $2::timestamptz)', [id, inFuture(60)]);
    expect((await as('player', "select * from public.media where alt = 'SCHEDPIC'")).rows).toEqual([]);
    await wind(id, 1);
    await release();
    expect((await as('player', "select * from public.media where alt = 'SCHEDPIC'")).rows).toHaveLength(1);
  });
});

describe('Letters from Krynn', () => {
  it('a letter keeps its sender, recipient and signature, and follows the same privacy and schedule', async () => {
    const id = await approved('a-letter', { section: 'letters', reporter: 'editor', letter_from: 'LETTERFROM Tatina', letter_to: 'The Company', letter_signature: 'With thanks' });
    const d = (await admin('select section, letter_from, letter_to, letter_signature from public.news_stories where article_id = $1', [id])).rows[0];
    expect(d).toEqual({ section: 'letters', letter_from: 'LETTERFROM Tatina', letter_to: 'The Company', letter_signature: 'With thanks' });
    expect(JSON.stringify((await as('player', 'select * from public.news_stories')).rows)).not.toMatch(/LETTERFROM/);
    await asDmCommitted('select public.news_schedule($1, $2::timestamptz)', [id, inFuture(10)]);
    await wind(id, 1);
    await release();
    expect(JSON.stringify((await as('player', 'select * from public.news_stories')).rows)).toMatch(/LETTERFROM/);
  });

  it('letter fields of a printed letter change only through an approved revision', async () => {
    const id = await approved('printed-letter', { section: 'letters', letter_from: 'Original sender' });
    await step(id, 'publish');
    const direct = await as('dm', "update public.news_stories set letter_from = 'Sneaky' where article_id = $1", [id]);
    expect(direct.error).toBeDefined();
    expect((await admin('select letter_from from public.news_stories where article_id = $1', [id])).rows[0]!.letter_from).toBe('Original sender');
  });
});

describe('Campaign time zone', () => {
  it('accepts a real zone, refuses an unknown one, and players can read it', async () => {
    expect((await as('dm', "update public.campaign_settings set timezone = 'America/Chicago'")).error).toBeUndefined();
    expect((await as('dm', "update public.campaign_settings set timezone = 'Not/AZone'")).error).toBeDefined();
    await admin("update public.campaign_settings set timezone = 'Europe/London'");
    expect((await as('player', 'select timezone from public.campaign_settings')).rows[0]).toEqual({ timezone: 'Europe/London' });
  });
});
