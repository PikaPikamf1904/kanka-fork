// The photo library through the REAL local services: GoTrue sign-in, the Storage API and the
// Data API, exactly as the website calls them. Synthetic bytes and accounts only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleEnroll, supabaseDeps, type EnrollEnv } from '../../functions/_lib/enroll.ts';
import { admin, pool, resetFixtures } from './helpers.ts';

const local = Object.fromEntries(
  fs.readFileSync(path.resolve(import.meta.dirname, '../../.local/env'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const jwtSecret = fs.readFileSync(path.resolve(import.meta.dirname, '../../.local/jwt_secret'), 'utf8').trim();
const env: EnrollEnv = {
  SUPABASE_URL: local.SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY: local.SUPABASE_PUBLISHABLE_KEY!,
  SUPABASE_SECRET_KEY: local.SUPABASE_SECRET_KEY!, IP_HASH_SECRET: 'local-test-ip-secret',
};
const BASE = env.SUPABASE_URL;
const KEY = env.SUPABASE_PUBLISHABLE_KEY;
const A = 'a0000000-0000-4000-8000-00000000000a';
const WEBP = Buffer.from('UklGRjAAAABXRUJQVlA4ICQAAACyAgCdASoBAAEALmmUSqQAAAMAAAAAAAD+/8nYPC8Ht2AAAA==', 'base64'); // 1x1 synthetic

const uuid = () => crypto.randomUUID();
const upload = (name: string, token: string, body: Uint8Array = WEBP, type = 'image/webp'): Promise<Response> =>
  fetch(`${BASE}/storage/v1/object/chronicle-media/${name}`, {
    method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${token}`, 'content-type': type, 'x-upsert': 'false' }, body: body as unknown as BodyInit,
  });
const download = (name: string, token: string) =>
  fetch(`${BASE}/storage/v1/object/authenticated/chronicle-media/${name}`, { headers: { apikey: KEY, authorization: `Bearer ${token}` } });
const remove = (name: string, token: string) =>
  fetch(`${BASE}/storage/v1/object/chronicle-media`, {
    method: 'DELETE', headers: { apikey: KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [name] }),
  });
const rpc = (fn: string, body: unknown, token: string) =>
  fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const rest = (query: string, token: string, init: RequestInit = {}) =>
  fetch(`${BASE}/rest/v1/${query}`, { ...init, headers: { apikey: KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });

/** A token like an assistant connection's: the DM's identity plus an OAuth client claim. */
function oauthToken(sub: string) {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub, role: 'authenticated', aud: 'authenticated', aal: 'aal1', client_id: 'synthetic-oauth-client', iat: now, exp: now + 600, session_id: uuid() });
  return `${head}.${body}.${crypto.createHmac('sha256', jwtSecret).update(`${head}.${body}`).digest('base64url')}`;
}

let dm = '';
let dmId = '';
let player = '';

beforeAll(async () => {
  await resetFixtures();
  const email = `photo-dm-${Date.now()}@test.chronicle.invalid`;
  const created = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'dm-local-password-123', email_confirm: true }),
  });
  dmId = ((await created.json()) as { id: string }).id;
  await admin("insert into public.campaign_members (user_id, role, display_name) values ($1, 'dm', 'Photo DM')", [dmId]);
  dm = (await supabaseDeps(env).signIn(email, 'dm-local-password-123')).access_token;
  const p = await handleEnroll({
    method: 'POST', url: 'http://127.0.0.1:8788/api/enroll', origin: 'http://127.0.0.1:8788', contentType: 'application/json',
    ip: '198.51.100.44', body: { code: 'correct horse battery', displayName: 'Photo Player' },
  }, env, supabaseDeps(env));
  player = ((p.body as { session: { access_token: string } }).session).access_token;
});
afterAll(() => pool.end());

describe('photos through the real Storage and Data APIs', () => {
  it('upload, register, publish, and each role sees exactly what it may', async () => {
    const src = `sources/${uuid()}.webp`;
    const disp = `media/${uuid()}.webp`;
    expect((await upload(src, dm)).status).toBe(200);
    expect((await upload(disp, dm)).status).toBe(200);
    const reg = await rpc('register_photo', { p: { display: { path: disp, alt: 'Synthetic', width: 1, height: 1, bytes: WEBP.length }, source: { path: src, width: 1, height: 1, bytes: WEBP.length }, crop: { x: 0, y: 0, w: 1, h: 1, aspect: 'original' } } }, dm);
    expect(reg.status).toBe(200);
    const { id } = (await reg.json()) as { id: string };

    // While the picture is not on a published page, only the DM can fetch either file.
    expect((await download(disp, dm)).status).toBe(200);
    expect((await download(disp, player)).status).not.toBe(200);
    expect((await download(src, player)).status).not.toBe(200);

    await admin('update public.articles set hero_media_id = $1 where id = $2', [id, A]);
    expect((await download(disp, player)).status).toBe(200);
    expect((await download(src, player)).status).not.toBe(200); // the full-frame copy stays private
    expect((await download(disp, KEY)).status).not.toBe(200); // anonymous
    // Players get the picture's row but not its private details.
    expect(await (await rest(`media?select=path&id=eq.${id}`, player)).json()).toEqual([{ path: disp }]);
    expect(await (await rest('media_private?select=*', player)).json()).toEqual([]);
    expect(((await (await rest('media_private?select=credit', dm)).json()) as unknown[]).length).toBe(2);

    // A signed link can only be made by someone allowed to read the file.
    const sign = (name: string, token: string) => fetch(`${BASE}/storage/v1/object/sign/chronicle-media/${name}`, {
      method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }),
    });
    expect((await sign(src, player)).status).not.toBe(200);
    const signed = (await (await sign(disp, player)).json()) as { signedURL: string };
    expect((await fetch(`${BASE}/storage/v1${signed.signedURL}`)).status).toBe(200);

    // Unpublishing takes it away again.
    await admin("update public.articles set status = 'draft' where id = $1", [A]);
    expect((await download(disp, player)).status).not.toBe(200);
    await admin("update public.articles set status = 'published', hero_media_id = null where id = $1", [A]);
  });

  it('a file in use cannot be deleted through Storage; an unregistered leftover can', async () => {
    const disp = `media/${uuid()}.webp`;
    expect((await upload(disp, dm)).status).toBe(200);
    const reg = await rpc('register_photo', { p: { display: { path: disp, alt: '', width: 1, height: 1, bytes: WEBP.length } } }, dm);
    expect(reg.status).toBe(200);
    await remove(disp, dm);
    expect((await download(disp, dm)).status).toBe(200); // still there: its library entry protects it
    const leftover = `media/${uuid()}.webp`;
    expect((await upload(leftover, dm)).status).toBe(200);
    await remove(leftover, dm);
    expect((await download(leftover, dm)).status).not.toBe(200);
  });

  it('registration of a file that never arrived is refused, and nothing is recorded', async () => {
    const res = await rpc('register_photo', { p: { display: { path: `media/${uuid()}.webp`, alt: '', width: 1, height: 1, bytes: 1 } } }, dm);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toBe('VALIDATION_FAILED');
  });

  it('players, anonymous visitors and assistant connections cannot upload or register', async () => {
    expect((await upload(`media/${uuid()}.webp`, player)).status).not.toBe(200);
    expect((await upload(`media/${uuid()}.webp`, KEY)).status).not.toBe(200);
    const assistant = oauthToken(dmId);
    expect((await upload(`media/${uuid()}.webp`, assistant)).status).not.toBe(200);
    const name = `media/${uuid()}.webp`;
    expect((await upload(name, dm)).status).toBe(200);
    expect((await rpc('register_photo', { p: { display: { path: name, alt: '', width: 1, height: 1, bytes: 1 } } }, assistant)).status).toBe(403);
    expect((await upload(`elsewhere/${uuid()}.webp`, dm)).status).not.toBe(200);
    expect((await upload(`media/${uuid()}.svg`, dm, Buffer.from('<svg/>'), 'image/svg+xml')).status).not.toBe(200);
  });
});
