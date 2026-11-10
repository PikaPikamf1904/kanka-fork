// End-to-end enrollment through the real local services (GoTrue + PostgREST + PostgreSQL),
// using the same code the Cloudflare Pages Function runs.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { handleEnroll, supabaseDeps, type EnrollEnv } from '../../functions/_lib/enroll.ts';
import { admin, pool, resetFixtures } from './helpers.ts';

const localEnv = Object.fromEntries(
  fs.readFileSync(path.resolve(import.meta.dirname, '../../.local/env'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

const env: EnrollEnv = {
  SUPABASE_URL: localEnv.SUPABASE_URL!,
  SUPABASE_PUBLISHABLE_KEY: localEnv.SUPABASE_PUBLISHABLE_KEY!,
  SUPABASE_SECRET_KEY: localEnv.SUPABASE_SECRET_KEY!,
  IP_HASH_SECRET: 'local-test-ip-secret',
};

const enroll = (code: string, ip = '198.51.100.7') =>
  handleEnroll(
    {
      method: 'POST',
      url: 'http://127.0.0.1:8788/api/enroll',
      origin: 'http://127.0.0.1:8788',
      contentType: 'application/json',
      ip,
      body: { code, displayName: 'Laurana' },
    },
    env,
    supabaseDeps(env),
  );

beforeEach(resetFixtures);
afterAll(() => pool.end());

async function restAs(token: string, query: string) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${query}`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as unknown };
}

describe('enrollment against the local Supabase services', () => {
  it('creates a player identity whose session reads only player content', async () => {
    const res = await enroll('correct horse battery');
    expect(res.status).toBe(200);
    const session = res.body.session as { access_token: string; refresh_token: string };
    expect(session.access_token.split('.')).toHaveLength(3);

    const articles = await restAs(session.access_token, 'articles?select=slug&order=slug');
    expect(articles.body).toEqual([{ slug: 'public-article' }, { slug: 'public-three' }, { slug: 'public-two' }]);
    const notes = await restAs(session.access_token, 'dm_notes?select=*');
    expect(notes.body).toEqual([]);

    const members = await admin<{ role: string; display_name: string }>(
      "select m.role, m.display_name from public.campaign_members m join auth.users u on u.id = m.user_id where u.email like 'player-%@players.chronicle.invalid'",
    );
    expect(members.rows).toEqual([{ role: 'player', display_name: 'Laurana' }]);
  });

  it('a wrong code creates no user', async () => {
    const before = await admin<{ n: string }>('select count(*) as n from auth.users');
    const res = await enroll('not the code');
    expect(res.status).toBe(401);
    const after = await admin<{ n: string }>('select count(*) as n from auth.users');
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it('rate limits repeated failures from one address', async () => {
    for (let i = 0; i < 5; i++) expect((await enroll(`guess ${i}`, '198.51.100.99')).status).toBe(401);
    expect((await enroll('correct horse battery', '198.51.100.99')).status).toBe(429);
  });

  it('revoking the device makes its existing session useless', async () => {
    const res = await enroll('correct horse battery');
    const token = (res.body.session as { access_token: string }).access_token;
    await admin("update public.campaign_members set revoked_at = now() where role = 'player'");
    const articles = await restAs(token, 'articles?select=slug');
    expect(articles.body).toEqual([]);
  });

  it('public sign-up and anonymous sign-in are both disabled', async () => {
    const signup = await fetch(`${env.SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'someone@example.com', password: 'a-long-password-123' }),
    });
    expect(signup.status).toBe(422);
    const anonymous = await fetch(`${env.SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ data: {} }),
    });
    expect(anonymous.status).toBe(422);
  });

  it('storage serves player files to players and DM files only to the DM', async () => {
    // A real DM account, signed in through GoTrue.
    const dmEmail = `player-dm-${Date.now()}@players.chronicle.invalid`;
    const created = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_SECRET_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ email: dmEmail, password: 'dm-local-password-123', email_confirm: true }),
    });
    const dmId = ((await created.json()) as { id: string }).id;
    await admin("insert into public.campaign_members (user_id, role, display_name) values ($1, 'dm', 'DM')", [dmId]);
    const dmSession = await supabaseDeps(env).signIn(dmEmail, 'dm-local-password-123');
    const player = await enroll('correct horse battery');
    const playerToken = (player.body.session as { access_token: string }).access_token;

    const upload = (name: string, token: string) =>
      fetch(`${env.SUPABASE_URL}/storage/v1/object/chronicle-media/${name}`, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'content-type': 'image/png', 'x-upsert': 'true' },
        body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      });
    const download = (name: string, token: string) =>
      fetch(`${env.SUPABASE_URL}/storage/v1/object/authenticated/chronicle-media/${name}`, {
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}` },
      });

    expect((await upload('public/it-town.png', dmSession.access_token)).status).toBe(200);
    expect((await upload('dm/it-plan.png', dmSession.access_token)).status).toBe(200);
    await admin("delete from public.media where path in ('public/it-town.png', 'dm/it-plan.png')");
    await admin("insert into public.media (path, visibility) values ('public/it-town.png', 'players'), ('dm/it-plan.png', 'dm')");

    expect((await download('public/it-town.png', playerToken)).status).toBe(200);
    expect((await download('dm/it-plan.png', playerToken)).status).not.toBe(200);
    expect((await download('dm/it-plan.png', dmSession.access_token)).status).toBe(200);
    // Players cannot upload, list the DM folder, or mint a signed URL for a DM file.
    expect((await upload('public/evil.png', playerToken)).status).not.toBe(200);
    const list = await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/chronicle-media`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${playerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: 'dm', limit: 100 }),
    });
    expect(await list.json()).toEqual([]);
    const signed = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/chronicle-media/dm/it-plan.png`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${playerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: 60 }),
    });
    expect(signed.status).not.toBe(200);
    // Anyone without a session gets nothing.
    expect((await download('public/it-town.png', env.SUPABASE_PUBLISHABLE_KEY)).status).not.toBe(200);
    // SVG uploads are refused by the bucket.
    const svg = await fetch(`${env.SUPABASE_URL}/storage/v1/object/chronicle-media/public/x.svg`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${dmSession.access_token}`, 'content-type': 'image/svg+xml' },
      body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
    expect(svg.status).not.toBe(200);
    await admin('delete from auth.users where id = $1', [dmId]);
  });

  it('the publishable key alone cannot call server-only functions', async () => {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/begin_enrollment`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ p_code: 'correct horse battery', p_ip_hash: 'aaaaaaaaaaaaaaaaaaaa' }),
    });
    expect(res.status).toBe(401);
  });
});
