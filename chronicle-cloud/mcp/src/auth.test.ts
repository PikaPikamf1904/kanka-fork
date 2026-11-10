import { beforeEach, describe, expect, it } from 'vitest';
import { resetJwksCache, verifyToken } from './auth.ts';

const env = { SUPABASE_URL: 'https://project.supabase.example' };
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const claims = (over: Record<string, unknown> = {}) => ({
  sub: '00000000-0000-4000-8000-0000000000d1', role: 'authenticated', aud: 'authenticated', iss: 'https://project.supabase.example/auth/v1',
  exp: Math.floor(Date.now() / 1000) + 600, client_id: 'synthetic-client', ...over,
});

async function es256(payload: unknown, kid = 'key-1') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const head = b64({ alg: 'ES256', typ: 'JWT', kid });
  const body = b64(payload);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid };
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ keys: [jwk] }));
  }) as unknown as typeof fetch;
  return { token: `${head}.${body}.${Buffer.from(sig).toString('base64url')}`, fetchImpl, calls };
}

beforeEach(resetJwksCache);

describe('verifyToken with the project signing keys (hosted projects)', () => {
  it('accepts a token signed by a published key and fetches the keys from the project only', async () => {
    const { token, fetchImpl, calls } = await es256(claims());
    expect(await verifyToken(token, env, fetchImpl)).toMatchObject({ client_id: 'synthetic-client' });
    expect(calls).toEqual(['https://project.supabase.example/auth/v1/.well-known/jwks.json']);
  });

  it('refuses a token signed by a different key, an unknown key id, or a tampered body', async () => {
    const good = await es256(claims());
    const other = await es256(claims());
    await expect(verifyToken(other.token, env, good.fetchImpl)).rejects.toThrow();
    resetJwksCache();
    const unknownKid = await es256(claims(), 'key-2');
    await expect(verifyToken(unknownKid.token, env, good.fetchImpl)).rejects.toThrow();
    resetJwksCache();
    const [h, , s] = good.token.split('.');
    await expect(verifyToken(`${h}.${b64(claims({ sub: '00000000-0000-4000-8000-000000000001' }))}.${s}`, env, good.fetchImpl)).rejects.toThrow();
  });

  it('refuses symmetric tokens when no local secret is configured, and unsigned tokens always', async () => {
    const { fetchImpl } = await es256(claims());
    const hs = `${b64({ alg: 'HS256' })}.${b64(claims())}.${Buffer.from('x').toString('base64url')}`;
    await expect(verifyToken(hs, env, fetchImpl)).rejects.toThrow();
    await expect(verifyToken(`${b64({ alg: 'none' })}.${b64(claims())}.`, env, fetchImpl)).rejects.toThrow();
  });

  it('checks expiry, issuer, audience, subject and client id after the signature', async () => {
    for (const over of [{ exp: 1 }, { iss: 'https://evil.example/auth/v1' }, { aud: 'x' }, { role: 'anon' }, { sub: 'not-a-uuid' }, { client_id: '' }, { client_id: 'web' }]) {
      resetJwksCache();
      const t = await es256(claims(over));
      await expect(verifyToken(t.token, env, t.fetchImpl), JSON.stringify(over)).rejects.toThrow();
    }
  });
});
