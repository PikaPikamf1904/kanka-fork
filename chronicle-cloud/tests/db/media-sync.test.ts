// Media visibility follows usage (migration 20261109000600): shared images, replacement,
// publishing and unpublishing, deletion, and real downloads through the local Storage API.
// Synthetic fixtures and local-only tokens; never runs against a hosted project.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, ids, pool, resetFixtures } from './helpers.ts';

const A = 'a0000000-0000-4000-8000-00000000000a'; // players / published
const SECRET = 'a0000000-0000-4000-8000-00000000000b'; // dm / published
const DRAFT = 'a0000000-0000-4000-8000-00000000000c'; // players / draft
const TWO = 'a0000000-0000-4000-8000-00000000000d'; // players / published
const NEST = 'd0000000-0000-4000-8000-000000000002'; // dm map

const localDir = path.resolve(import.meta.dirname, '../../.local');
const localEnv = Object.fromEntries(
  fs.readFileSync(path.join(localDir, 'env'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const BASE = localEnv.SUPABASE_URL!;
const SERVICE = localEnv.SUPABASE_SECRET_KEY!;
const ANON = localEnv.SUPABASE_PUBLISHABLE_KEY!;

/** A short-lived user token signed with the local stack's random secret (local only). */
function userToken(who: keyof typeof ids) {
  const secret = fs.readFileSync(path.join(localDir, 'jwt_secret'), 'utf8').trim();
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: ids[who], role: 'authenticated', aud: 'authenticated', aal: 'aal1', iat: now, exp: now + 600 });
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

beforeEach(resetFixtures);
afterAll(() => pool.end());

/** One committed statement as the DM, like one request from the app. */
async function asDm(sql: string, params: unknown[] = []) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ids.dm, role: 'authenticated', aal: 'aal1' }),
    ]);
    await client.query(sql, params);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function newMedia(p: string) {
  const { rows } = await admin<{ id: string }>("insert into public.media (path, alt) values ($1, 'Synthetic') returning id", [p]);
  return rows[0]!.id;
}

async function visibility(id: string) {
  const { rows } = await admin<{ visibility: string }>('select visibility from public.media where id = $1', [id]);
  return rows[0]!.visibility;
}

async function playerRows(p: string) {
  return (await as('player', 'select id from public.media where path = $1', [p])).rowCount;
}

describe('trigger behaviour', () => {
  it('one image on a public and a secret article stays visible only while a visible page uses it', async () => {
    const m = await newMedia('media/shared-hero.webp');
    await asDm('update public.articles set hero_media_id = $1 where id = any($2::uuid[])', [m, [A, SECRET]]);
    expect(await visibility(m)).toBe('players');
    await asDm("update public.articles set status = 'draft' where id = $1", [A]);
    expect(await visibility(m)).toBe('dm');
    expect(await playerRows('media/shared-hero.webp')).toBe(0);
    await asDm("update public.articles set hero_media_id = $1, status = 'published' where id = $2", [m, DRAFT]);
    expect(await visibility(m)).toBe('players');
    await asDm("update public.articles set visibility = 'dm' where id = $1", [DRAFT]);
    expect(await visibility(m)).toBe('dm');
  });

  it('two public articles share an image: hiding one keeps it visible, hiding both hides it', async () => {
    const m = await newMedia('media/two-public.webp');
    await asDm('update public.articles set hero_media_id = $1 where id = any($2::uuid[])', [m, [A, TWO]]);
    await asDm("update public.articles set visibility = 'dm' where id = $1", [A]);
    expect(await visibility(m)).toBe('players');
    await asDm('delete from public.articles where id = $1', [TWO]);
    expect(await visibility(m)).toBe('dm');
  });

  it('replacing the main image hides the old one and shows the new one', async () => {
    const oldImg = await newMedia('media/old.webp');
    const newImg = await newMedia('media/new.webp');
    await asDm('update public.articles set hero_media_id = $1 where id = $2', [oldImg, A]);
    expect(await visibility(oldImg)).toBe('players');
    await asDm('update public.articles set hero_media_id = $1 where id = $2', [newImg, A]);
    expect([await visibility(oldImg), await visibility(newImg)]).toEqual(['dm', 'players']);
  });

  it('a DM map and a public article can share an image; deleting the article hides it', async () => {
    const m = await newMedia('media/map-and-article.webp');
    await asDm('update public.maps set media_id = $1 where id = $2', [m, NEST]);
    await asDm('update public.articles set hero_media_id = $1 where id = $2', [m, A]);
    expect(await visibility(m)).toBe('players');
    await asDm('delete from public.articles where id = $1', [A]);
    expect(await visibility(m)).toBe('dm');
  });

  it('a new article created already published reveals its image; an image in use cannot be deleted until detached', async () => {
    const m = await newMedia('media/new-article.webp');
    await asDm(
      "insert into public.articles (slug, title, visibility, status, hero_media_id) values ('fresh-page', 'Fresh', 'players', 'published', $1)",
      [m],
    );
    expect(await visibility(m)).toBe('players');
    // 20261113000100: deleting a picture a page still shows is refused, so the page never loses it silently.
    await expect(asDm('delete from public.media where id = $1', [m])).rejects.toThrow(/CONFLICT/);
    expect((await admin('select 1 from public.media where id = $1', [m])).rowCount).toBe(1);
    await asDm("update public.articles set hero_media_id = null where slug = 'fresh-page'");
    await asDm('delete from public.media where id = $1', [m]);
    expect((await admin('select 1 from public.media where id = $1', [m])).rowCount).toBe(0);
  });

  it('two transactions unpublishing two pages that share an image leave it hidden', async () => {
    const m = await newMedia('media/race.webp');
    await asDm('update public.articles set hero_media_id = $1 where id = any($2::uuid[])', [m, [A, TWO]]);
    expect(await visibility(m)).toBe('players');
    const open = async (article: string) => {
      const c = await pool.connect();
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.dm, role: 'authenticated', aal: 'aal1' })]);
      // Not awaited to completion here: the second one waits on the first one's row lock.
      const done = c.query("update public.articles set status = 'draft' where id = $1", [article]);
      return { c, done };
    };
    const first = await open(A);
    await first.done;
    const second = await open(TWO);
    await new Promise((r) => setTimeout(r, 300));
    await first.c.query('commit');
    first.c.release();
    await second.done;
    await second.c.query('commit');
    second.c.release();
    expect(await visibility(m)).toBe('dm');
  });

  it('the API cannot create a media row that starts player-visible', async () => {
    const r = await as('dm', "insert into public.media (path, visibility) values ('media/x.webp', 'players') returning id");
    expect(r.error?.code).toBe('42501');
    const ok = await as('dm', "insert into public.media (path) values ('media/y.webp') returning visibility");
    expect(ok.rows).toEqual([{ visibility: 'dm' }]);
  });
});

describe('real downloads through the Storage API', () => {
  const file = 'media/storage-check.webp';
  const bytes = Buffer.from('RIFF0000WEBPsynthetic-test-image');

  async function upload() {
    const res = await fetch(`${BASE}/storage/v1/object/chronicle-media/${file}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'content-type': 'image/webp', 'x-upsert': 'true' },
      body: bytes,
    });
    expect(res.status, await res.text()).toBe(200);
  }

  async function download(token: string) {
    const res = await fetch(`${BASE}/storage/v1/object/authenticated/chronicle-media/${file}`, {
      headers: { authorization: `Bearer ${token}`, apikey: ANON },
    });
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, same: body.equals(bytes) };
  }

  async function sign(token: string) {
    const res = await fetch(`${BASE}/storage/v1/object/sign/chronicle-media/${file}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, apikey: ANON, 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: 60 }),
    });
    return res.status;
  }

  it('players can download the file only while its page is published to them', async () => {
    await upload();
    const m = await newMedia(file);
    const player = userToken('player');
    const dm = userToken('dm');

    expect((await download(dm)).same).toBe(true);
    expect(await download(player)).toMatchObject({ same: false });
    expect(await sign(player)).not.toBe(200);
    expect((await download(ANON)).same).toBe(false);

    await asDm('update public.articles set hero_media_id = $1 where id = $2', [m, DRAFT]);
    expect((await download(player)).same).toBe(false);

    await asDm("update public.articles set status = 'published' where id = $1", [DRAFT]);
    expect(await download(player)).toEqual({ status: 200, same: true });
    expect(await sign(player)).toBe(200);

    await asDm("update public.articles set status = 'draft' where id = $1", [DRAFT]);
    expect((await download(player)).same).toBe(false);
    expect(await sign(player)).not.toBe(200);

    // A revoked device cannot download even a public file.
    await asDm("update public.articles set status = 'published' where id = $1", [DRAFT]);
    expect((await download(userToken('revoked'))).same).toBe(false);
  });
});
