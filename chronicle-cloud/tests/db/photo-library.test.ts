// Photo library (20261113000100): registration, private full-frame sources, private details,
// deletion of pictures in use, assistant connections, and the Storage rules behind them.
// Synthetic files and the synthetic fixture world only.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, columns, pool, resetFixtures } from './helpers.ts';

const A = 'a0000000-0000-4000-8000-00000000000a'; // published, player-visible character
const SRC = 'sources/11111111-1111-4111-8111-111111111111.webp';
const DISP = 'media/22222222-2222-4222-8222-222222222222.webp';
const DISP2 = 'media/33333333-3333-4333-8333-333333333333.webp';
const oauth = { extra: { client_id: 'synthetic-oauth-client' } };

const object = (name: string) => admin(`insert into storage.objects (bucket_id, name) values ('chronicle-media', $1)`, [name]);
const photo = (extra: Record<string, unknown> = {}) => ({
  display: { path: DISP, alt: 'Synthetic harbour', width: 900, height: 1200, bytes: 4000 },
  source: { path: SRC, width: 2000, height: 1500, bytes: 9000 },
  crop: { x: 0.1, y: 0.05, w: 0.6, h: 0.9, aspect: 'portrait' },
  credit: 'Synthetic artist', original_name: 'harbour sketch',
  ...extra,
});

/** Registers as the DM in a committed transaction (as() rolls back), returning the new ids. */
async function register(p: unknown): Promise<{ id: string; source_id: string }> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: (await admin<{ user_id: string }>("select user_id from public.campaign_members where role = 'dm' and revoked_at is null order by created_at limit 1")).rows[0]!.user_id, role: 'authenticated', aud: 'authenticated', aal: 'aal1' }),
    ]);
    const { rows } = await client.query<{ r: { id: string; source_id: string } }>('select public.register_photo($1) as r', [p]);
    await client.query('commit');
    return rows[0]!.r;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

beforeEach(async () => {
  await resetFixtures();
  await object(SRC);
  await object(DISP);
});
afterAll(() => pool.end());

describe('registering a photo', () => {
  it('records the cropped picture and its private full-frame source together, both DM-only', async () => {
    const r = await register(photo());
    const rows = await admin<{ path: string; role: string; visibility: string }>(`select path, role, visibility from public.media order by role`);
    expect(rows.rows.filter((m) => m.path === DISP || m.path === SRC)).toEqual([
      { path: DISP, role: 'display', visibility: 'dm' },
      { path: SRC, role: 'source', visibility: 'dm' },
    ]);
    const priv = await admin(`select credit, original_name, source_media_id, crop from public.media_private where media_id = $1`, [r.id]);
    expect(priv.rows[0]).toMatchObject({ credit: 'Synthetic artist', original_name: 'harbour sketch', source_media_id: r.source_id, crop: { aspect: 'portrait' } });
  });

  it('refuses a file that never reached Storage, a bad path, players and assistant connections', async () => {
    const missing = await as('dm', 'select public.register_photo($1)', [photo({ display: { path: DISP2, alt: '', width: 1, height: 1, bytes: 1 } })]);
    expect(missing.error?.message).toBe('VALIDATION_FAILED');
    const outside = await as('dm', 'select public.register_photo($1)', [photo({ display: { path: 'public/x.webp', alt: '', width: 1, height: 1, bytes: 1 } })]);
    expect(outside.error?.message).toBe('VALIDATION_FAILED');
    expect((await as('player', 'select public.register_photo($1)', [photo()])).error).toBeDefined();
    expect((await as('dm', 'select public.register_photo($1)', [photo()], oauth)).error?.message).toBe('FORBIDDEN');
    expect((await admin(`select 1 from public.media where path in ($1, $2)`, [DISP, SRC])).rowCount).toBe(0);
  });

  it('a recrop reuses the existing source instead of storing another copy', async () => {
    const first = await register(photo());
    await object(DISP2);
    const again = await register({ display: { path: DISP2, alt: 'Recropped', width: 800, height: 800, bytes: 3000 }, source_id: first.source_id, crop: { x: 0, y: 0, w: 0.5, h: 0.5, aspect: 'square' } });
    expect(again.source_id).toBe(first.source_id);
    expect((await admin(`select 1 from public.media where role = 'source'`)).rowCount).toBe(1);
  });
});

describe('who can see what', () => {
  it('a published picture reaches players, its full-frame source and private details never do', async () => {
    const r = await register(photo());
    await admin(`update public.articles set hero_media_id = $1 where id = $2`, [r.id, A]);
    // Even a source written into player-visible text by hand stays DM-only.
    await admin(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 30, 'x', $2, 'players', 'published')`, [A, `![x](media:${SRC})`]);
    const seen = await as<{ path: string }>('player', `select path from public.media where path in ($1, $2)`, [DISP, SRC]);
    expect(columns(seen.rows, 'path')).toEqual([DISP]);
    const files = await as<{ name: string }>('player', `select name from storage.objects where name in ($1, $2)`, [DISP, SRC]);
    expect(columns(files.rows, 'name')).toEqual([DISP]);
    expect((await as('player', 'select * from public.media_private')).rowCount).toBe(0);
    expect((await as('dm', 'select * from public.media_private')).rowCount).toBe(2);
    // The library row players can read carries no credit or file name at all.
    const cols = await admin<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'media'`);
    expect(columns(cols.rows, 'column_name')).not.toContain('credit');
    expect(columns(cols.rows, 'column_name')).not.toContain('original_name');
    // Anonymous visitors get nothing.
    expect((await as('anon', 'select 1 from public.media')).error?.code).toBe('42501');
  });

  it('a source can never be made player-visible, not even by the DM directly', async () => {
    await register(photo());
    const r = await as('dm', `update public.media set visibility = 'players' where path = $1`, [SRC]);
    expect(r.error?.code).toBe('23514');
  });

  it('privacy follows the page: unpublishing hides the picture again', async () => {
    const r = await register(photo());
    await admin(`update public.articles set hero_media_id = $1 where id = $2`, [r.id, A]);
    expect((await as('player', `select 1 from public.media where id = $1`, [r.id])).rowCount).toBe(1);
    await admin(`update public.articles set status = 'draft' where id = $1`, [A]);
    expect((await as('player', `select 1 from public.media where id = $1`, [r.id])).rowCount).toBe(0);
    expect((await as('player', `select 1 from storage.objects where name = $1`, [DISP])).rowCount).toBe(0);
  });
});

describe('deleting', () => {
  it('a picture in use, or a source still used by its cropped picture, cannot be deleted', async () => {
    const r = await register(photo());
    await admin(`update public.articles set hero_media_id = $1 where id = $2`, [r.id, A]);
    const inUse = await as('dm', 'delete from public.media where id = $1 returning id', [r.id]);
    expect(inUse.error?.message).toBe('CONFLICT');
    const source = await as('dm', 'delete from public.media where id = $1 returning id', [r.source_id]);
    expect(source.error?.message).toBe('CONFLICT');
    // In text, as a banner, or in a waiting Gazette revision counts as in use too.
    await admin(`update public.articles set hero_media_id = null where id = $1`, [A]);
    await admin(`update public.campaign_settings set banner_media_id = $1`, [r.id]);
    expect((await as('dm', 'delete from public.media where id = $1', [r.id])).error?.message).toBe('CONFLICT');
    await admin(`update public.campaign_settings set banner_media_id = null`);
    await admin(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 31, 'x', $2, 'dm', 'draft')`, [A, `![x](media:${DISP})`]);
    expect((await as('dm', 'delete from public.media where id = $1', [r.id])).error?.message).toBe('CONFLICT');
  });

  it('an unused picture can be deleted, and then its unused source', async () => {
    const r = await register(photo());
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      const dm = (await admin<{ user_id: string }>("select user_id from public.campaign_members where role = 'dm' and revoked_at is null order by created_at limit 1")).rows[0]!.user_id;
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: dm, role: 'authenticated', aud: 'authenticated', aal: 'aal1' })]);
      await client.query('delete from public.media where id = $1', [r.id]);
      await client.query('delete from public.media where id = $1', [r.source_id]);
      await client.query('commit');
    } finally {
      client.release();
    }
    expect((await admin('select 1 from public.media where id in ($1, $2)', [r.id, r.source_id])).rowCount).toBe(0);
  });

  it('Storage refuses deleting a file that still has a library entry, and allows an unregistered leftover', async () => {
    await register(photo());
    expect((await as('dm', `delete from storage.objects where name = $1 returning name`, [DISP])).rowCount).toBe(0);
    await object(DISP2); // an upload whose registration never happened
    expect((await as('dm', `delete from storage.objects where name = $1 returning name`, [DISP2])).rowCount).toBe(1);
  });
});

describe('assistant connections and players cannot touch the library', () => {
  it('an OAuth client cannot add, change or delete library entries, details or files', async () => {
    const r = await register(photo());
    expect((await as('dm', `update public.media set alt = 'x' where id = $1`, [r.id], oauth)).error?.code).toBe('42501');
    // Private details are not even visible to an assistant (20261113000300): nothing to change.
    const details = await as('dm', `update public.media_private set credit = 'x' where media_id = $1 returning media_id`, [r.id], oauth);
    expect(Boolean(details.error) || details.rowCount === 0).toBe(true);
    expect((await as('dm', 'select * from public.media_private', [], oauth)).rowCount).toBe(0);
    expect((await as('dm', 'select name from storage.objects where name = $1', [DISP], oauth)).rowCount).toBe(0);
    expect((await as('dm', `delete from public.media where id = $1`, [r.id], oauth)).error?.code).toBe('42501');
    expect((await as('dm', `insert into storage.objects (bucket_id, name) values ('chronicle-media', 'media/oauth.webp')`, [], oauth)).error?.code).toBe('42501');
    expect((await as('dm', `delete from storage.objects where name = 'orphan/x' returning name`, [], oauth)).rowCount).toBe(0);
  });

  it('players cannot add files or change details; uploads only go into media/ and sources/', async () => {
    expect((await as('player', `insert into storage.objects (bucket_id, name) values ('chronicle-media', 'media/p.webp')`)).error?.code).toBe('42501');
    expect((await as('player', `insert into public.media_private (media_id) select id from public.media limit 1`)).error).toBeDefined();
    expect((await as('dm', `insert into storage.objects (bucket_id, name) values ('chronicle-media', 'elsewhere/x.webp')`)).error?.code).toBe('42501');
    expect((await as('dm', `insert into storage.objects (bucket_id, name) values ('chronicle-media', 'media/ok.webp')`)).error).toBeUndefined();
  });
});
