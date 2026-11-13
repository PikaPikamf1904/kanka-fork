// CH-103 (20261113000500): an approval covers exactly the text that gets printed. Any change to an
// approved, unprinted story by a route other than applying an approved revision sends it back to
// review, so unreviewed text can never be printed. Synthetic content only.
import type pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, ids, pool, resetFixtures } from './helpers.ts';

const story = {
  article: { slug: 'zz-review', title: 'Reviewed headline', summary: 'Reviewed opening.' },
  sections: [{ heading: '', body: 'Reviewed body.', visibility: 'players', status: 'published' }],
  details: { section: 'local', reliability: 'confirmed', reporter: 'nib', dateline: '', in_world_date: '', issue_number: 1 },
};

/** One committed transaction as the website DM (like the Data API, with the DM's JWT). */
async function dm<T = unknown>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.dm, role: 'authenticated', aud: 'authenticated', aal: 'aal1' })]);
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
const step = (id: string, action: string) => dm((c) => c.query('select public.news_transition($1, $2) as r', [id, action]).then((r) => r.rows[0].r));
const reviewState = async (id: string) => (await admin<{ s: string }>('select review_state::text s from public.news_stories where article_id = $1', [id])).rows[0]!.s;
const printed = async (id: string) => (await admin<{ status: string }>('select status from public.articles where id = $1', [id])).rows[0]!.status;

async function approvedStory(): Promise<string> {
  const id = await dm((c) => c.query('select public.save_news_story($1::jsonb) as r', [JSON.stringify(story)]).then((r) => r.rows[0].r.id as string));
  await step(id, 'submit');
  await step(id, 'approve');
  expect(await reviewState(id)).toBe('approved');
  return id;
}

beforeEach(async () => {
  await resetFixtures();
  await admin("delete from public.articles where type = 'news'");
});
afterAll(() => pool.end());

describe('approved but unprinted stories', () => {
  const edits: [string, string][] = [
    ['a section edited directly through the API', `update public.article_sections set body = 'UNREVIEWED SECRET' where article_id = $1`],
    ['a section added directly', `insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 9, '', 'UNREVIEWED SECRET', 'players', 'published')`],
    ['a section deleted directly', `delete from public.article_sections where article_id = $1`],
    ['a section hidden or re-ordered', `update public.article_sections set position = position + 1, visibility = 'dm' where article_id = $1`],
    ['the headline changed by the general editor', `update public.articles set title = 'UNREVIEWED SECRET' where id = $1`],
    ['the opening or address changed', `update public.articles set summary = 'UNREVIEWED SECRET', slug = 'zz-other' where id = $1`],
  ];
  for (const [what, sql] of edits) {
    it(`${what}: back to review, and printing is refused`, async () => {
      const id = await approvedStory();
      await dm((c) => c.query(sql, [id]));
      expect(await reviewState(id)).toBe('in_review');
      await expect(step(id, 'publish')).rejects.toThrow(/FORBIDDEN/);
      expect(await printed(id)).toBe('draft');
      expect((await as('player', `select 1 from public.articles where id = $1`, [id])).rowCount).toBe(0);
    });
  }

  it('re-approving the changed text lets it print, with exactly the approved text', async () => {
    const id = await approvedStory();
    await dm((c) => c.query(`update public.article_sections set body = 'Second draft.' where article_id = $1`, [id]));
    await step(id, 'approve');
    await step(id, 'publish');
    const seen = await as<{ body: string }>('player', 'select body from public.article_sections where article_id = $1', [id]);
    expect(seen.rows.map((r) => r.body)).toEqual(['Second draft.']);
  });

  it('a change that alters nothing (same values, or a column outside the story) keeps the approval', async () => {
    const id = await approvedStory();
    await dm((c) => c.query(`update public.article_sections set body = body where article_id = $1`, [id]));
    await dm((c) => c.query(`update public.articles set title = title, importance = importance where id = $1`, [id]));
    expect(await reviewState(id)).toBe('approved');
    await step(id, 'publish');
    expect(await printed(id)).toBe('published');
  });

  it('drafts and stories in review are unaffected', async () => {
    const draft = await dm((c) => c.query('select public.save_news_story($1::jsonb) as r', [JSON.stringify(story)]).then((r) => r.rows[0].r.id as string));
    await dm((c) => c.query(`update public.article_sections set body = 'Edited draft.' where article_id = $1`, [draft]));
    expect(await reviewState(draft)).toBe('draft');
    await step(draft, 'submit');
    await dm((c) => c.query(`update public.article_sections set body = 'Edited in review.' where article_id = $1`, [draft]));
    expect(await reviewState(draft)).toBe('in_review');
  });

  it('a story cannot be converted into or out of the Gazette to skip review', async () => {
    const id = await approvedStory();
    await expect(dm((c) => c.query(`update public.articles set type = 'lore' where id = $1`, [id]))).rejects.toThrow(/FORBIDDEN/);
    await expect(dm((c) => c.query(`update public.articles set type = 'news' where slug = 'public-article'`))).rejects.toThrow(/FORBIDDEN/);
    expect(await reviewState(id)).toBe('approved');
  });
});

describe('printed stories', () => {
  it('an approved revision is applied as approved; players never see it before then', async () => {
    const id = await approvedStory();
    await step(id, 'publish');
    const revision = { ...story, article: { ...story.article, id, title: 'Revised headline PENDINGTEXT' }, sections: [{ heading: '', body: 'Revised body PENDINGTEXT.', visibility: 'players', status: 'published' }] };
    expect((await dm((c) => c.query('select public.save_news_story($1::jsonb) as r', [JSON.stringify(revision)]))).rows[0].r.pending).toBe(true);
    await step(id, 'submit');
    const player = async () => JSON.stringify([
      (await as('player', 'select * from public.articles where id = $1', [id])).rows,
      (await as('player', 'select * from public.article_sections where article_id = $1', [id])).rows,
      (await as('player', 'select * from public.news_pending')).rows,
      (await as('player', 'select * from public.news_stories')).rows,
    ]);
    expect(await player()).not.toContain('PENDINGTEXT');
    expect(await player()).toContain('Reviewed body.');
    await step(id, 'approve');
    // Applying the approved revision is the one route that may change approved text.
    expect(await reviewState(id)).toBe('approved');
    expect(await printed(id)).toBe('published');
    expect(await player()).toContain('Revised body PENDINGTEXT.');
  });

  it('printed text cannot be edited directly at all', async () => {
    const id = await approvedStory();
    await step(id, 'publish');
    await expect(dm((c) => c.query(`update public.article_sections set body = 'UNREVIEWED SECRET' where article_id = $1`, [id]))).rejects.toThrow(/FORBIDDEN/);
    await expect(dm((c) => c.query(`update public.articles set title = 'UNREVIEWED SECRET' where id = $1`, [id]))).rejects.toThrow(/FORBIDDEN/);
  });
});
