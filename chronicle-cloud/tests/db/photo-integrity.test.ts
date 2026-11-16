// Photo integrity (20261113000300): pictures in use by history, proposals, maps, galleries and
// Gazette revisions cannot be deleted, and attaching versus deleting at the same moment never
// leaves a page pointing at a deleted file. Two real database sessions race in these tests.
import type pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, ids, pool, resetFixtures } from './helpers.ts';

const A = 'a0000000-0000-4000-8000-00000000000a';
const P = 'media/44444444-4444-4444-8444-444444444444.webp';
const Q = 'media/55555555-5555-4555-8555-555555555555.webp';
let m = '';
let q = '';

async function session(who: keyof typeof ids = 'dm'): Promise<pg.PoolClient> {
  const c = await pool.connect();
  await c.query('begin');
  await c.query('set local role authenticated');
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids[who], role: 'authenticated', aud: 'authenticated', aal: 'aal1' })]);
  await c.query("set local lock_timeout = '10s'");
  return c;
}
const settled = <T>(p: Promise<T>) => Promise.race([p.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('waiting'), 400))]);
const finish = async (c: pg.PoolClient, ok: boolean) => {
  await c.query(ok ? 'commit' : 'rollback').catch(() => undefined);
  c.release();
};
const dmDelete = (id: string) => as('dm', 'delete from public.media where id = $1 returning id', [id]);

beforeEach(async () => {
  await resetFixtures();
  m = (await admin<{ id: string }>(`insert into public.media (path) values ($1) returning id`, [P])).rows[0]!.id;
  q = (await admin<{ id: string }>(`insert into public.media (path) values ($1) returning id`, [Q])).rows[0]!.id;
});
afterAll(() => pool.end());

describe('what counts as in use', () => {
  it('page history: a picture a revision refers to cannot be deleted', async () => {
    await admin(`insert into public.revisions (article_id, snapshot, note) values ($1, $2, 'old')`, [A, { article: { hero_media_id: m } }]);
    await admin(`insert into public.revisions (article_id, snapshot, note) values ($1, $2, 'old text')`, [A, { sections: [{ body: `![x](media:${Q})` }] }]);
    expect((await dmDelete(m)).error?.message).toBe('CONFLICT');
    expect((await dmDelete(q)).error?.message).toBe('CONFLICT');
  });

  it('a pending proposal protects its pictures; an applied one does not', async () => {
    await admin(`insert into public.change_previews (principal_id, client_id, change_set, base_versions, digest, result, expires_at)
                 values ($1, 'synthetic', $2, '{}', 'x', '{}', now() + interval '1 day')`, [ids.dm, { changes: [{ operation: 'patch_article', fields: { hero_media_id: m } }] }]);
    expect((await dmDelete(m)).error?.message).toBe('CONFLICT');
    await admin(`update public.change_previews set consumed_at = now()`);
    expect((await dmDelete(m)).rowCount).toBe(1);
  });

  it('maps, galleries and waiting Gazette revisions protect their pictures', async () => {
    await admin(`insert into public.maps (slug, title, media_id, visibility, status) values ('synthetic-map', 'Map', $1, 'dm', 'draft')`, [m]);
    expect((await dmDelete(m)).error?.message).toBe('CONFLICT');
    await admin(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 40, 'Gallery', $2, 'players', 'draft')`, [A, `![a](media:${Q})\n![b](media:${P})`]);
    expect((await dmDelete(q)).error?.message).toBe('CONFLICT');
    await admin(`delete from public.article_sections where heading = 'Gallery'`);
    const story = (await admin<{ id: string }>(`insert into public.articles (slug, type, title, visibility, status) values ('zz-story', 'news', 'Story', 'dm', 'draft') returning id`)).rows[0]!.id;
    await admin(`insert into public.news_pending (article_id, story, review_state) values ($1, $2, 'draft')`, [story, { article: { hero_media_id: q } }]);
    expect((await dmDelete(q)).error?.message).toBe('CONFLICT');
  });
});

describe('attaching and deleting at the same moment', () => {
  it('text attaching first: the delete waits, then is refused because the picture is now in use', async () => {
    const attach = await session();
    await attach.query(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 41, 'x', $2, 'dm', 'draft')`, [A, `![x](media:${P})`]);
    const del = await session();
    const deleting = del.query('delete from public.media where id = $1', [m]);
    expect(await settled(deleting)).toBe('waiting');
    await finish(attach, true);
    await expect(deleting).rejects.toThrow(/CONFLICT/);
    await finish(del, false);
    expect((await admin('select 1 from public.media where id = $1', [m])).rowCount).toBe(1);
  });

  it('deleting first: the text save waits, then fails instead of pointing at a deleted file', async () => {
    const del = await session();
    await del.query('delete from public.media where id = $1', [m]);
    const attach = await session();
    const attaching = attach.query(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 42, 'x', $2, 'dm', 'draft')`, [A, `![x](media:${P})`]);
    expect(await settled(attaching)).toBe('waiting');
    await finish(del, true);
    await expect(attaching).rejects.toThrow(/CONFLICT/);
    await finish(attach, false);
    expect((await admin(`select 1 from public.article_sections where position = 42`)).rowCount).toBe(0);
  });

  it('deleting first: a page picture attached meanwhile fails on the foreign key, not silently', async () => {
    const del = await session();
    await del.query('delete from public.media where id = $1', [m]);
    const attach = await session();
    const attaching = attach.query('update public.articles set hero_media_id = $1 where id = $2', [m, A]);
    expect(await settled(attaching)).toBe('waiting');
    await finish(del, true);
    await expect(attaching).rejects.toThrow(/foreign key/);
    await finish(attach, false);
  });

  it('a revision of a printed Gazette story, saved through the API, cannot take a picture that was just deleted', async () => {
    // Print a story the normal way (website DM), then delete a picture nothing uses.
    const asDm = async (sql: string, params: unknown[]) => {
      const c = await session();
      try {
        const r = await c.query(sql, params);
        await c.query('commit');
        return r;
      } finally {
        c.release();
      }
    };
    const story = { article: { slug: 'zz-printed', title: 'Printed', summary: 'x' }, sections: [{ heading: '', body: 'Text.', visibility: 'players', status: 'published' }], details: { section: 'local', reliability: 'confirmed', reporter: 'nib', dateline: '', in_world_date: '', issue_number: 1 } };
    const id = (await asDm('select public.save_news_story($1::jsonb) as r', [JSON.stringify(story)])).rows[0].r.id as string;
    for (const action of ['submit', 'approve', 'publish']) await asDm('select public.news_transition($1, $2)', [id, action]);
    await admin('delete from public.media where id = $1', [m]);
    // Exactly like the Data API: log in as "authenticator", then act as the signed-in DM.
    const url = new URL(process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54322/postgres');
    url.username = 'authenticator';
    const { Client } = (await import('pg')).default;
    const api = new Client({ connectionString: url.toString() });
    await api.connect();
    try {
      await api.query('begin');
      await api.query('set local role authenticated');
      await api.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.dm, role: 'authenticated', aud: 'authenticated', aal: 'aal1' })]);
      const revision = { ...story, article: { ...story.article, id, hero_media_id: m }, sections: [{ heading: '', body: `Text. ![x](media:${P})`, visibility: 'players', status: 'published' }] };
      await api.query('savepoint before_save');
      await expect(api.query('select public.save_news_story($1::jsonb)', [JSON.stringify(revision)]))
        .rejects.toMatchObject({ message: 'CONFLICT', detail: expect.stringMatching(/deleted from the library|no longer in the library/) });
      await api.query('rollback to savepoint before_save');
      // Control: the same revision with pictures that still exist is saved (as a waiting revision).
      const ok = { ...revision, article: { ...revision.article, hero_media_id: q }, sections: [{ heading: '', body: `Text. ![x](media:${Q})`, visibility: 'players', status: 'published' }] };
      const saved = await api.query('select public.save_news_story($1::jsonb) as r', [JSON.stringify(ok)]);
      expect(saved.rows[0].r.pending).toBe(true);
    } finally {
      await api.query('rollback').catch(() => undefined);
      await api.end();
    }
  });
});
