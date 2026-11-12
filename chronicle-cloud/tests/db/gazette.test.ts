// The Goblin Gazette: stories follow Draft -> In review -> Approved -> Published, enforced by the
// database. Players never receive a story (or its newspaper details) before it is published, and
// only the DM on the website can save, review or publish one. Synthetic content only.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, pool, resetFixtures, type ClaimsOverride, type Who } from './helpers.ts';

beforeEach(async () => {
  await resetFixtures();
  await admin("delete from public.articles where type = 'news'");
});
afterAll(() => pool.end());

const OAUTH: ClaimsOverride = { extra: { client_id: 'synthetic-mcp-client' } };

const story = (over: Record<string, unknown> = {}) => ({
  article: { slug: 'goblin-scoop', title: 'GOBLINSCOOP: Bridge Found Exactly Where It Was', summary: 'Our reporter went to look.', ...over },
  sections: [{ heading: '', body: 'The bridge was there. GOBLINBODY', visibility: 'players', status: 'published' }],
  details: { section: 'local', reliability: 'rumor', reporter: 'grubnik', dateline: 'Port Synthetic', in_world_date: 'Third day of Spring', issue_number: 1 },
});

async function save(who: Who = 'dm', s: unknown = story(), claims: ClaimsOverride = {}) {
  return as<{ r: { id: string; version: string } }>(who, 'select public.save_news_story($1::jsonb) as r', [JSON.stringify(s)], claims);
}
async function transition(id: string, action: string, who: Who = 'dm', claims: ClaimsOverride = {}) {
  return as<{ r: { review_state: string; status: string; visibility: string } }>(who, 'select public.news_transition($1, $2) as r', [id, action], claims);
}
/** Saves as the DM and commits (the `as` helper rolls back, so write with the superuser's view of the result). */
async function created(s: unknown = story()): Promise<string> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: '00000000-0000-4000-8000-0000000000d1', role: 'authenticated', aal: 'aal1' })]);
    const { rows } = await c.query('select public.save_news_story($1::jsonb) as r', [JSON.stringify(s)]);
    await c.query('commit');
    return rows[0].r.id as string;
  } finally {
    c.release();
  }
}
async function step(id: string, action: string) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: '00000000-0000-4000-8000-0000000000d1', role: 'authenticated', aal: 'aal1' })]);
    await c.query('select public.news_transition($1, $2)', [id, action]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
async function playerSees() {
  const r = await as('player', `select a.title, s.reliability, (select string_agg(body, ' ') from public.article_sections x where x.article_id = a.id) as body
    from public.articles a left join public.news_stories s on s.article_id = a.id where a.type = 'news'`);
  const details = await as('player', 'select * from public.news_stories');
  return { rows: r.rows, details: details.rows, raw: JSON.stringify([r.rows, details.rows]) };
}

describe('Goblin Gazette workflow', () => {
  it('a saved story is a private draft with its newspaper details', async () => {
    const id = await created();
    const page = await admin('select type, status, visibility from public.articles where id = $1', [id]);
    expect(page.rows[0]).toEqual({ type: 'news', status: 'draft', visibility: 'dm' });
    const d = await admin('select section, reliability, reporter, review_state, issue_number from public.news_stories where article_id = $1', [id]);
    expect(d.rows[0]).toEqual({ section: 'local', reliability: 'rumor', reporter: 'grubnik', review_state: 'draft', issue_number: 1 });
  });

  it('players see nothing of a story until it is published, then exactly the story', async () => {
    const id = await created();
    expect((await playerSees()).raw).not.toMatch(/GOBLINSCOOP|GOBLINBODY|grubnik/);
    await step(id, 'submit');
    expect((await playerSees()).rows).toEqual([]);
    await step(id, 'approve');
    expect((await playerSees()).rows).toEqual([]);
    await step(id, 'publish');
    const seen = await playerSees();
    expect(seen.rows).toEqual([{ title: 'GOBLINSCOOP: Bridge Found Exactly Where It Was', reliability: 'rumor', body: 'The bridge was there. GOBLINBODY' }]);
    expect(seen.details).toHaveLength(1);
    for (const who of ['anon', 'outsider', 'revoked'] as const) {
      const r = await as(who, "select * from public.articles where type = 'news'");
      expect(r.rows, who).toEqual([]);
    }
  });

  it('prevents retyping news at every review stage and prevents converting an ordinary article into news', async () => {
    const id = await created();
    for (const stage of ['draft', 'approved', 'printed'] as const) {
      if (stage === 'approved') { await step(id, 'submit'); await step(id, 'approve'); }
      if (stage === 'printed') await step(id, 'publish');
      const attempt = await as('dm', "update public.articles set type = 'lore', status = 'draft' where id = $1", [id]);
      expect(attempt.error?.message, stage).toBe('FORBIDDEN');
      const current = await admin('select type from public.articles where id = $1', [id]);
      expect(current.rows[0]!.type).toBe('news');
    }
    const convert = await as('dm', "update public.articles set type = 'news' where slug = 'public-article'");
    expect(convert.error?.message).toBe('FORBIDDEN');
  });

  it('publishing is refused until the DM approves, by every route', async () => {
    const id = await created();
    expect((await transition(id, 'publish')).error?.message).toBe('FORBIDDEN');
    await step(id, 'submit');
    expect((await transition(id, 'publish')).error?.message).toBe('FORBIDDEN');
    // The general editor and a direct update are held to the same rule.
    const viaEditor = await as('dm', 'select public.save_article($1::jsonb)', [JSON.stringify({ article: { id, slug: 'goblin-scoop', type: 'news', title: 'X', visibility: 'players', status: 'published' }, sections: [], infobox: [] })]);
    expect(viaEditor.error?.message).toBe('FORBIDDEN');
    const direct = await as('dm', "update public.articles set status = 'published', visibility = 'players' where id = $1", [id]);
    expect(direct.error?.message).toBe('FORBIDDEN');
  });

  it('sending a published story back to draft takes it down at once', async () => {
    const id = await created();
    for (const a of ['submit', 'approve', 'publish']) await step(id, a);
    expect((await playerSees()).rows).toHaveLength(1);
    await step(id, 'return');
    expect((await playerSees()).rows).toEqual([]);
    expect((await admin('select status from public.articles where id = $1', [id])).rows[0]).toEqual({ status: 'draft' });
    expect((await transition(id, 'publish')).error?.message).toBe('FORBIDDEN');
  });

  it('review steps happen in order', async () => {
    const id = await created();
    expect((await transition(id, 'approve')).error?.message).toBe('CONFLICT');
    await step(id, 'submit');
    expect((await transition(id, 'submit')).error?.message).toBe('CONFLICT');
    expect((await transition(id, 'nonsense')).error?.message).toBe('VALIDATION_FAILED');
  });

  it('an assistant connection and players cannot save, review or publish', async () => {
    const id = await created();
    expect((await save('dm', story({ slug: 'assistant-story' }), OAUTH)).error?.message).toBe('FORBIDDEN');
    for (const a of ['submit', 'approve', 'publish']) {
      expect((await transition(id, a, 'dm', OAUTH)).error?.message, a).toBe('FORBIDDEN');
    }
    expect((await save('player', story({ slug: 'player-story' }))).error).toBeDefined();
    expect((await transition(id, 'submit', 'player')).error).toBeDefined();
    const direct = await as('dm', "update public.news_stories set review_state = 'approved' where article_id = $1", [id]);
    expect(direct.error?.code).toBe('42501'); // no direct writes, even for the DM: only the two functions
    expect((await as('player', "insert into public.news_stories (article_id) values ($1)", [id])).error?.code).toBe('42501');
  });

  it('an edit to a printed story waits for approval; players keep the printed version', async () => {
    const id = await created();
    for (const a of ['submit', 'approve', 'publish']) await step(id, a);
    const edited = { ...story({ id, title: 'GOBLINSCOOP: Bridge Has Moved' }), sections: [{ heading: '', body: 'REVISEDBODY', visibility: 'players', status: 'published' }], details: { ...story().details, reliability: 'confirmed' } };
    await created(edited);
    let seen = await playerSees();
    expect(seen.rows).toEqual([{ title: 'GOBLINSCOOP: Bridge Found Exactly Where It Was', reliability: 'rumor', body: 'The bridge was there. GOBLINBODY' }]);
    expect(seen.raw).not.toContain('REVISEDBODY');
    expect((await as('player', 'select * from public.news_pending')).rows).toEqual([]); // the revision is DM-only
    const pending = await as('dm', 'select review_state, story #>> \'{article,title}\' as title from public.news_pending where article_id = $1', [id]);
    expect(pending.rows).toEqual([{ review_state: 'draft', title: 'GOBLINSCOOP: Bridge Has Moved' }]);
    const state = await admin('select a.status, s.review_state from public.articles a join public.news_stories s on s.article_id = a.id where a.id = $1', [id]);
    expect(state.rows[0]).toEqual({ status: 'published', review_state: 'approved' });

    expect((await transition(id, 'approve')).error?.message).toBe('CONFLICT'); // review first
    await step(id, 'submit');
    expect((await playerSees()).raw).not.toContain('REVISEDBODY');
    await step(id, 'approve');
    seen = await playerSees();
    expect(seen.rows).toEqual([{ title: 'GOBLINSCOOP: Bridge Has Moved', reliability: 'confirmed', body: 'REVISEDBODY' }]);
    expect((await admin('select count(*)::int n from public.news_pending')).rows[0]).toEqual({ n: 0 });
  });

  it('a revision can be discarded, and the printed version stays', async () => {
    const id = await created();
    for (const a of ['submit', 'approve', 'publish']) await step(id, a);
    await created({ ...story({ id, title: 'GOBLINSCOOP: Never Mind' }) });
    await step(id, 'discard');
    expect((await playerSees()).rows[0]!.title).toBe('GOBLINSCOOP: Bridge Found Exactly Where It Was');
    expect((await admin('select count(*)::int n from public.news_pending')).rows[0]).toEqual({ n: 0 });
  });

  it('no other route can change a printed story', async () => {
    const id = await created();
    for (const a of ['submit', 'approve', 'publish']) await step(id, a);
    const viaEditor = await as('dm', 'select public.save_article($1::jsonb)', [JSON.stringify({ article: { id, slug: 'goblin-scoop', type: 'news', title: 'Sneaky edit', visibility: 'players', status: 'published' }, sections: [], infobox: [] })]);
    expect(viaEditor.error?.message).toBe('FORBIDDEN');
    expect((await as('dm', "update public.articles set summary = 'sneaky' where id = $1", [id])).error?.message).toBe('FORBIDDEN');
    expect((await as('dm', "update public.article_sections set body = 'sneaky' where article_id = $1", [id])).error?.message).toBe('FORBIDDEN');
    expect((await as('dm', "insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 9, '', 'sneaky', 'players', 'published')", [id])).error?.message).toBe('FORBIDDEN');
    expect((await as('dm', 'delete from public.article_sections where article_id = $1', [id])).error?.message).toBe('FORBIDDEN');
    // A printed story's address cannot be changed through a revision either.
    expect((await save('dm', story({ id, slug: 'another-address' }))).error?.message).toBe('VALIDATION_FAILED');
  });

  it('editing an approved story that is not printed yet sends it back to review', async () => {
    const id = await created();
    for (const a of ['submit', 'approve']) await step(id, a);
    await created(story({ id, title: 'GOBLINSCOOP: Changed After Approval' }));
    const r = await admin('select review_state from public.news_stories where article_id = $1', [id]);
    expect(r.rows[0]).toEqual({ review_state: 'in_review' });
    expect((await transition(id, 'publish')).error?.message).toBe('FORBIDDEN');
  });

  it('taking a printed story out of the paper keeps a waiting revision as the new draft', async () => {
    const id = await created();
    for (const a of ['submit', 'approve', 'publish']) await step(id, a);
    await created(story({ id, title: 'GOBLINSCOOP: Unreviewed Words' }));
    await step(id, 'unpublish');
    const r = await admin('select a.status, a.title, s.review_state from public.articles a join public.news_stories s on s.article_id = a.id where a.id = $1', [id]);
    expect(r.rows[0]).toEqual({ status: 'draft', title: 'GOBLINSCOOP: Unreviewed Words', review_state: 'in_review' });
    expect((await playerSees()).rows).toEqual([]);
  });

  it('the current location is only shown to players who may read that page', async () => {
    await admin("update public.campaign_settings set current_location_id = 'a0000000-0000-4000-8000-00000000000c', current_status = 'Resting in town.'");
    const r = await as('player', 'select s.current_status, a.title from public.campaign_settings s left join public.articles a on a.id = s.current_location_id');
    expect(r.rows).toEqual([{ current_status: 'Resting in town.', title: null }]); // the location page is a draft
    await admin("update public.campaign_settings set current_location_id = 'a0000000-0000-4000-8000-00000000000d'");
    const r2 = await as('player', 'select a.title from public.campaign_settings s left join public.articles a on a.id = s.current_location_id');
    expect(r2.rows).toEqual([{ title: 'Harbour Town' }]);
    await admin("update public.campaign_settings set current_location_id = null, current_status = ''");
  });
});
