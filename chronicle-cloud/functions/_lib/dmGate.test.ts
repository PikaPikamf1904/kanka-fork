import { describe, expect, it, vi } from 'vitest';
import { COOKIE, GATE_SECONDS, cookieIsValid, handleDmGate, sameText, type DmGateDeps, type DmGateEnv, type DmGateRequest } from './dmGate.ts';

// A synthetic passcode: the real one is only ever a Cloudflare secret.
const env: DmGateEnv = {
  SUPABASE_URL: 'https://project.supabase.example',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  IP_HASH_SECRET: 'ip-secret',
  DM_SCREEN_PASSCODE: '24680',
};
const NOW = 1_800_000_000_000;

function deps(status = 'ok', overrides: Partial<DmGateDeps> = {}): DmGateDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    begin: vi.fn(async (ip: string) => { calls.push(`begin:${ip}`); return status === 'ok' ? { status, attempt: 7 } : { status }; }),
    finish: vi.fn(async (a: number) => { calls.push(`finish:${a}`); }),
    hashIp: async (ip: string) => `h(${ip})`,
    now: () => NOW,
    ...overrides,
  };
}
const post = (body: unknown, o: Partial<DmGateRequest> = {}): DmGateRequest => ({
  method: 'POST', url: 'https://chronicle.pages.dev/api/dm-gate', origin: 'https://chronicle.pages.dev',
  contentType: 'application/json', ip: '203.0.113.9', cookie: null, body, ...o,
});
const get = (cookie: string | null = null): DmGateRequest => ({ ...post(null), method: 'GET', cookie });

describe('handleDmGate', () => {
  it('a wrong passcode is refused, counted, and sets no cookie', async () => {
    const d = deps();
    const r = await handleDmGate(post({ passcode: '00000' }), env, d);
    expect(r.status).toBe(401);
    expect(r.setCookie).toBeUndefined();
    expect(d.calls).toEqual(['begin:h(203.0.113.9)']);
    expect(JSON.stringify(r.body)).not.toContain('24680');
  });

  it('the right passcode sets a signed, HttpOnly, 12-hour cookie and marks the attempt a success', async () => {
    const d = deps();
    const r = await handleDmGate(post({ passcode: ' 24680 ' }), env, d);
    expect(r.status).toBe(200);
    expect(d.calls).toContain('finish:7');
    expect(r.setCookie).toMatch(new RegExp(`^${COOKIE}=\\d+\\.[0-9a-f]{64}; Max-Age=${GATE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict$`));
    expect(r.setCookie).not.toContain('24680');
    const value = r.setCookie!.split(';')[0]!;
    expect(await cookieIsValid(env, value, NOW + 1000)).toBe(true);
    const gate = await handleDmGate(get(value), env, d);
    expect(gate.body).toEqual({ configured: true, open: true });
  });

  it('is limited: a rate-limited address is refused before the passcode is even compared', async () => {
    const r = await handleDmGate(post({ passcode: '24680' }), env, deps('rate_limited'));
    expect(r.status).toBe(429);
    expect(r.setCookie).toBeUndefined();
  });

  it('refuses other sites, wrong content types, wrong methods and bad input without touching the database', async () => {
    const d = deps();
    expect((await handleDmGate(post({ passcode: '1' }, { origin: 'https://evil.example' }), env, d)).status).toBe(403);
    expect((await handleDmGate(post({ passcode: '1' }, { contentType: 'text/plain' }), env, d)).status).toBe(415);
    expect((await handleDmGate({ ...post(null), method: 'PUT' }, env, d)).status).toBe(405);
    expect((await handleDmGate(post({ passcode: '' }), env, d)).status).toBe(400);
    expect((await handleDmGate(post({ passcode: 'x'.repeat(65) }), env, d)).status).toBe(400);
    expect((await handleDmGate(post({ passcode: 12345 }), env, d)).status).toBe(400);
    expect((await handleDmGate(post({ passcode: '1' }, { ip: null }), env, d)).status).toBe(400);
    expect(d.begin).not.toHaveBeenCalled();
  });

  it('fails closed when no passcode is configured, and says so', async () => {
    const bare = { ...env, DM_SCREEN_PASSCODE: undefined };
    expect((await handleDmGate(post({ passcode: '24680' }), bare, deps())).status).toBe(503);
    expect((await handleDmGate(get(), bare, deps())).body).toEqual({ configured: false, open: false });
  });

  it('lock clears the cookie', async () => {
    const r = await handleDmGate(post({ lock: true }), env, deps());
    expect(r.setCookie).toContain('Max-Age=0');
  });
});

describe('the cookie', () => {
  it('is rejected when expired, edited, forged, or the passcode has changed', async () => {
    const ok = (await handleDmGate(post({ passcode: '24680' }), env, deps())).setCookie!.split(';')[0]!;
    const [name, value] = ok.split('=') as [string, string];
    const [expires, mac] = value.split('.') as [string, string];
    expect(await cookieIsValid(env, ok, NOW + GATE_SECONDS * 1000 + 1000)).toBe(false);
    expect(await cookieIsValid(env, `${name}=${Number(expires) + 99999}.${mac}`, NOW)).toBe(false);
    expect(await cookieIsValid(env, `${name}=${expires}.${'0'.repeat(64)}`, NOW)).toBe(false);
    expect(await cookieIsValid(env, `${name}=garbage`, NOW)).toBe(false);
    expect(await cookieIsValid(env, null, NOW)).toBe(false);
    expect(await cookieIsValid({ ...env, DM_SCREEN_PASSCODE: '13579' }, ok, NOW)).toBe(false);
    expect(await cookieIsValid({ ...env, IP_HASH_SECRET: 'other' }, ok, NOW)).toBe(false);
    expect(await cookieIsValid(env, `a=1; ${ok}; b=2`, NOW)).toBe(true);
  });

  it('sameText compares whole strings', () => {
    expect(sameText('abc', 'abc')).toBe(true);
    expect(sameText('abc', 'abd')).toBe(false);
    expect(sameText('abc', 'abcd')).toBe(false);
  });
});

describe('dmGateDeps', () => {
  it('reads the attempt id from begin and accepts the empty answer finish gets for a void function', async () => {
    const { dmGateDeps } = await import('./dmGate.ts');
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(String(url).split('/rpc/')[1]!);
      return String(url).endsWith('begin_dm_gate')
        ? new Response(JSON.stringify({ status: 'ok', attempt: 9 }), { status: 200 })
        : new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const d = dmGateDeps(env, fake);
    expect(await d.begin('x'.repeat(64))).toEqual({ status: 'ok', attempt: 9 });
    await expect(d.finish(9)).resolves.toBeUndefined();
    expect(calls).toEqual(['begin_dm_gate', 'finish_dm_gate']);
  });
});
