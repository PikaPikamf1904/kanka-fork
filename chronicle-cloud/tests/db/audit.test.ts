// Regression tests for the defects found in the full audit (migration 20261109000600).
// Synthetic fixtures only; every case runs against the local stack.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { admin, as, asService, ids, pool, resetFixtures } from './helpers.ts';

const A = 'a0000000-0000-4000-8000-00000000000a'; // players / published
const SECRET = 'a0000000-0000-4000-8000-00000000000b'; // dm / published
const DRAFT = 'a0000000-0000-4000-8000-00000000000c'; // players / draft
const WORLD = 'd0000000-0000-4000-8000-000000000001'; // players / published map
const NEST = 'd0000000-0000-4000-8000-000000000002'; // dm map

beforeEach(resetFixtures);
afterAll(() => pool.end());

/** Run several statements as the DM in one transaction, then roll back. */
async function dmTx<T>(fn: (c: pg.PoolClient) => Promise<T>, who: keyof typeof ids = 'dm'): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ids[who], role: 'authenticated', aal: 'aal1' }),
    ]);
    return await fn(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

/** Run a statement as the DM and commit it, the way the app's separate requests do. */
async function asDm(sql: string, params: unknown[] = []) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ids.dm, role: 'authenticated', aal: 'aal1' }),
    ]);
    const result = await client.query(sql, params);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function newMedia(path: string, visibility: 'players' | 'dm' = 'dm') {
  const { rows } = await admin<{ id: string }>(
    'insert into public.media (path, alt, visibility) values ($1, $2, $3) returning id', [path, 'Unfinished Keep', visibility],
  );
  await admin("insert into storage.objects (bucket_id, name) values ('chronicle-media', $1)", [path]);
  return rows[0]!.id;
}

async function playerSees(path: string) {
  const row = await as('player', 'select alt from public.media where path = $1', [path]);
  const file = await as('player', "select name from storage.objects where bucket_id = 'chronicle-media' and name = $1", [path]);
  return { row: row.rowCount, file: file.rowCount };
}

describe('an image is only as visible as the page that shows it', () => {
  it('keeps the main image of a draft article away from players, whatever the uploader asked for', async () => {
    // What the editor did before the fix: upload as "players" because the draft's audience is players.
    const media = await newMedia('media/keep-draft.webp', 'players');
    await asDm('update public.articles set hero_media_id = $1 where id = $2', [media, DRAFT]);
    expect(await playerSees('media/keep-draft.webp')).toEqual({ row: 0, file: 0 });
  });

  it('reveals the image when the article is published and hides it again when the article is hidden', async () => {
    const media = await newMedia('media/keep.webp');
    await asDm('update public.articles set hero_media_id = $1 where id = $2', [media, DRAFT]);
    expect(await playerSees('media/keep.webp')).toEqual({ row: 0, file: 0 });
    await asDm("update public.articles set status = 'published' where id = $1", [DRAFT]);
    expect(await playerSees('media/keep.webp')).toEqual({ row: 1, file: 1 });
    await asDm("update public.articles set visibility = 'dm' where id = $1", [DRAFT]);
    expect(await playerSees('media/keep.webp')).toEqual({ row: 0, file: 0 });
  });

  it('hides the image when it is detached or its article is deleted', async () => {
    const media = await newMedia('media/captain.webp');
    await asDm('update public.articles set hero_media_id = $1 where id = $2', [media, A]);
    expect(await playerSees('media/captain.webp')).toEqual({ row: 1, file: 1 });
    await asDm('update public.articles set hero_media_id = null where id = $1', [A]);
    expect(await playerSees('media/captain.webp')).toEqual({ row: 0, file: 0 });
    await asDm('update public.articles set hero_media_id = $1 where id = $2', [media, A]);
    await asDm('delete from public.articles where id = $1', [A]);
    expect(await playerSees('media/captain.webp')).toEqual({ row: 0, file: 0 });
  });

  it('follows maps the same way, and stays visible while any visible page still uses it', async () => {
    const media = await newMedia('media/shared.webp');
    await asDm('update public.maps set media_id = $1 where id = $2', [media, NEST]);
    expect(await playerSees('media/shared.webp')).toEqual({ row: 0, file: 0 });
    await asDm('update public.maps set media_id = $1 where id = $2', [media, WORLD]);
    await asDm('update public.articles set hero_media_id = $1 where id = $2', [media, SECRET]);
    expect(await playerSees('media/shared.webp')).toEqual({ row: 1, file: 1 });
    await asDm("update public.maps set status = 'draft' where id = $1", [WORLD]);
    expect(await playerSees('media/shared.webp')).toEqual({ row: 0, file: 0 });
  });

  it('treats the cover banner as visible to members', async () => {
    const media = await newMedia('media/banner.webp');
    await asDm('update public.campaign_settings set banner_media_id = $1', [media]);
    expect(await playerSees('media/banner.webp')).toEqual({ row: 1, file: 1 });
    await asDm('update public.campaign_settings set banner_media_id = null');
    expect(await playerSees('media/banner.webp')).toEqual({ row: 0, file: 0 });
  });

  it('a player still cannot change what an image is attached to', async () => {
    const media = await newMedia('media/locked.webp');
    const r = await as('player', 'update public.articles set hero_media_id = $1 where id = $2 returning id', [media, A]);
    expect(r.rowCount).toBe(0);
    expect(await playerSees('media/locked.webp')).toEqual({ row: 0, file: 0 });
  });
});

describe('the DM cannot lock themselves out by a direct update', () => {
  it('refuses a self-revoke through the table, but allows renaming and revoking players', async () => {
    const self = await as('dm', 'update public.campaign_members set revoked_at = now() where user_id = $1 returning user_id', [ids.dm]);
    expect(self.error?.code).toBe('42501');
    const rename = await as('dm', "update public.campaign_members set display_name = 'Keeper' where user_id = $1 returning user_id", [ids.dm]);
    expect(rename.rowCount).toBe(1);
    const player = await as('dm', 'update public.campaign_members set revoked_at = now() where user_id = $1 returning user_id', [ids.player]);
    expect(player.rowCount).toBe(1);
  });

  it('refuses a bulk revoke that would include the DM', async () => {
    const all = await as('dm', 'update public.campaign_members set revoked_at = now() returning user_id');
    expect(all.error?.code).toBe('42501');
  });
});

describe('restoring a revision never publishes anything', () => {
  it('restores a hidden article as a draft, so the old published state is not re-exposed', async () => {
    await dmTx(async (c) => {
      const snap = await c.query<{ id: string }>("select public.snapshot_article($1, 'while public') as id", [A]);
      await c.query("update public.articles set visibility = 'dm', title = 'Now secret' where id = $1", [A]);
      await c.query('select public.restore_revision($1)', [snap.rows[0]!.id]);
      const { rows } = await c.query<{ title: string; visibility: string; status: string }>(
        'select title, visibility, status from public.articles where id = $1', [A],
      );
      expect(rows[0]).toEqual({ title: 'Visible Captain', visibility: 'players', status: 'draft' });
      // Checked as the player inside the same transaction.
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.player, role: 'authenticated', aal: 'aal1' })]);
      expect((await c.query('select id from public.articles where id = $1', [A])).rowCount).toBe(0);
      expect((await c.query('select id from public.article_sections where article_id = $1', [A])).rowCount).toBe(0);
    });
  });

  it('restores a revision whose main image has since been deleted', async () => {
    const media = await newMedia('media/gone.webp');
    await dmTx(async (c) => {
      await c.query('update public.articles set hero_media_id = $1 where id = $2', [media, A]);
      const snap = await c.query<{ id: string }>("select public.snapshot_article($1, 'with image') as id", [A]);
      // A picture in use cannot be deleted (20261113000100), so detach it first, as the DM would.
      await c.query('update public.articles set hero_media_id = null where id = $1', [A]);
      await c.query('delete from public.media where id = $1', [media]);
      await c.query('select public.restore_revision($1)', [snap.rows[0]!.id]);
      const { rows } = await c.query<{ hero_media_id: string | null }>('select hero_media_id from public.articles where id = $1', [A]);
      expect(rows[0]!.hero_media_id).toBeNull();
    });
  });
});

describe('enrollment limits', () => {
  const begin = async (code: string, ip: string) => {
    const { rows } = await asService<{ r: { status: string } }>('select public.begin_enrollment($1, $2) as r', [code, ip]);
    return rows[0]!.r.status;
  };

  it('counts concurrent wrong guesses from one address exactly (no race past the limit)', async () => {
    const ip = 'ip-hash-concurrent-00001';
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => begin(`guess ${i}`, ip)));
    expect(results.filter((s) => s === 'invalid')).toHaveLength(5);
    expect(results.filter((s) => s === 'rate_limited')).toHaveLength(7);
  });

  it('caps successful enrollments per address per hour', async () => {
    const ip = 'ip-hash-success-000000001';
    await admin(
      `insert into public.enrollment_attempts (ip_hash, succeeded) select $1, true from generate_series(1, 20)`, [ip],
    );
    expect(await begin('correct horse battery', ip)).toBe('rate_limited');
    expect(await begin('correct horse battery', 'ip-hash-success-000000002')).toBe('ok');
  });

  it('caps successful enrollments for the whole wiki per day', async () => {
    await admin(
      `insert into public.enrollment_attempts (ip_hash, succeeded)
       select 'ip-hash-many-' || lpad(g::text, 8, '0'), true from generate_series(1, 200) g`,
    );
    expect(await begin('correct horse battery', 'ip-hash-success-000000003')).toBe('rate_limited');
  });
});

describe('search after the rewrite', () => {
  it('returns one row per article with a snippet from its best visible section', async () => {
    const player = await as<{ slug: string; snippet: string | null }>('player', "select slug, snippet from public.search_wiki('lighthousewords')");
    expect(player.rows.map((r) => r.slug)).toEqual(['public-article']);
    expect(player.rows[0]!.snippet).toContain('⟦Lighthousewords⟧');
    expect(player.rows[0]!.snippet).not.toContain('SECRETWORD');
    const dm = await as<{ slug: string; snippet: string | null }>('dm', "select slug, snippet from public.search_wiki('secretword')");
    expect(dm.rows.map((r) => r.slug)).toEqual(['public-article']);
    expect(dm.rows[0]!.snippet).toContain('⟦SECRETWORD⟧');
  });

  it('matches a title alone with no snippet, and honours the result cap', async () => {
    const title = await as<{ slug: string; snippet: string | null }>('player', "select slug, snippet from public.search_wiki('guild')");
    expect(title.rows).toEqual([{ slug: 'public-three', snippet: null }]);
    await admin(
      `insert into public.articles (slug, type, title, visibility, status)
       select 'cap-' || g, 'lore', 'Capword ' || g, 'players', 'published' from generate_series(1, 60) g`,
    );
    const capped = await as('player', "select slug from public.search_wiki('capword', 500)");
    expect(capped.rowCount).toBe(50);
  });
});
