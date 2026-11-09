import { describe, expect, it, vi } from 'vitest';
import { handleEnroll, supabaseDeps, type EnrollDeps, type EnrollEnv, type EnrollRequest } from './enroll.ts';

const env: EnrollEnv = {
  SUPABASE_URL: 'https://project.supabase.example',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  IP_HASH_SECRET: 'ip-secret',
};

function fakeDeps(overrides: Partial<EnrollDeps> = {}): EnrollDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    beginEnrollment: vi.fn(async (code: string, ipHash: string) => {
      calls.push(`begin:${ipHash}`);
      return code === 'right code' ? { status: 'ok', code_id: 'code-1' } : { status: 'invalid' };
    }),
    createUser: vi.fn(async () => {
      calls.push('create');
      return 'user-1';
    }),
    completeEnrollment: vi.fn(async () => {
      calls.push('complete');
      return 'enrolled';
    }),
    deleteUser: vi.fn(async (id: string) => {
      calls.push(`delete:${id}`);
    }),
    signIn: vi.fn(async () => {
      calls.push('signin');
      return { access_token: 'at', refresh_token: 'rt', expires_in: 3600, token_type: 'bearer' };
    }),
    verifyTurnstile: vi.fn(async (token: string) => token === 'good-token'),
    randomId: () => 'rand',
    randomPassword: () => 'random-password',
    hashIp: async (ip: string) => `hashed(${ip})`,
    ...overrides,
  };
}

const request = (overrides: Partial<EnrollRequest> = {}): EnrollRequest => ({
  method: 'POST',
  url: 'https://chronicle.pages.dev/api/enroll',
  origin: 'https://chronicle.pages.dev',
  contentType: 'application/json',
  ip: '203.0.113.9',
  body: { code: 'right code', displayName: 'Tanis' },
  ...overrides,
});

describe('handleEnroll', () => {
  it('enrolls with the right code and returns only a session', async () => {
    const deps = fakeDeps();
    const res = await handleEnroll(request(), env, deps);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ session: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, token_type: 'bearer' } });
    expect(JSON.stringify(res.body)).not.toContain('random-password');
    expect(deps.calls).toEqual(['begin:hashed(203.0.113.9)', 'create', 'complete', 'signin']);
    expect(deps.createUser).toHaveBeenCalledWith('player-rand@players.chronicle.invalid', 'random-password');
  });

  it('never passes the raw IP to the database', async () => {
    const deps = fakeDeps();
    await handleEnroll(request(), env, deps);
    expect(deps.calls[0]).not.toBe('begin:203.0.113.9');
  });

  it('rejects a wrong code without creating a user', async () => {
    const deps = fakeDeps();
    const res = await handleEnroll(request({ body: { code: 'wrong', displayName: 'Tanis' } }), env, deps);
    expect(res).toEqual({ status: 401, body: { error: 'That access code was not accepted.' } });
    expect(deps.createUser).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limited', async () => {
    const deps = fakeDeps({ beginEnrollment: async () => ({ status: 'rate_limited' }) });
    const res = await handleEnroll(request(), env, deps);
    expect(res.status).toBe(429);
  });

  it('rejects cross-site requests, other methods, non-JSON and bad input', async () => {
    const deps = fakeDeps();
    expect((await handleEnroll(request({ origin: 'https://evil.example' }), env, deps)).status).toBe(403);
    expect((await handleEnroll(request({ origin: null }), env, deps)).status).toBe(403);
    expect((await handleEnroll(request({ method: 'GET' }), env, deps)).status).toBe(405);
    expect((await handleEnroll(request({ contentType: 'text/plain' }), env, deps)).status).toBe(415);
    for (const body of [null, {}, { code: '', displayName: 'x' }, { code: 'x', displayName: '' }, { code: 'x'.repeat(201), displayName: 'x' }, { code: 1, displayName: 'x' }]) {
      expect((await handleEnroll(request({ body }), env, deps)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await handleEnroll(request({ ip: null }), env, deps)).status).toBe(400);
    expect(deps.beginEnrollment).not.toHaveBeenCalled();
  });

  it('requires a valid Turnstile token when configured', async () => {
    const withTurnstile = { ...env, TURNSTILE_SECRET_KEY: 'ts' };
    const deps = fakeDeps();
    expect((await handleEnroll(request(), withTurnstile, deps)).status).toBe(400);
    expect((await handleEnroll(request({ body: { code: 'right code', displayName: 'T', turnstileToken: 'bad' } }), withTurnstile, deps)).status).toBe(400);
    expect(deps.beginEnrollment).not.toHaveBeenCalled();
    const ok = await handleEnroll(request({ body: { code: 'right code', displayName: 'T', turnstileToken: 'good-token' } }), withTurnstile, deps);
    expect(ok.status).toBe(200);
  });

  it('deletes the new user when the code stops being valid before completion', async () => {
    const deps = fakeDeps({ completeEnrollment: async () => 'invalid' });
    const res = await handleEnroll(request(), env, deps);
    expect(res.status).toBe(401);
    expect(deps.calls).toContain('delete:user-1');
    expect(deps.signIn).not.toHaveBeenCalled();
  });

  it('deletes the new user when sign-in fails, and rethrows', async () => {
    const deps = fakeDeps({ signIn: async () => { throw new Error('boom'); } });
    await expect(handleEnroll(request(), env, deps)).rejects.toThrow('boom');
    expect(deps.calls).toContain('delete:user-1');
  });
});

describe('supabaseDeps', () => {
  it('sends the secret key only as apikey, and the publishable key for sign-in', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: init?.headers as Record<string, string> });
      const body = url.includes('admin/users') ? { id: 'u' } : url.includes('token') ? { access_token: 'a' } : { status: 'ok' };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const deps = supabaseDeps(env, fetchImpl);
    await deps.beginEnrollment('c', 'h');
    await deps.createUser('e@x.invalid', 'p');
    await deps.signIn('e@x.invalid', 'p');
    for (const call of seen.slice(0, 2)) {
      expect(call.headers.apikey).toBe('sb_secret_test');
      expect(call.headers.authorization ?? call.headers.Authorization).toBeUndefined();
    }
    expect(seen[2]!.headers.apikey).toBe('sb_publishable_test');
    expect(seen[2]!.url).toBe('https://project.supabase.example/auth/v1/token?grant_type=password');
  });

  it('hashes IPs with HMAC: stable, keyed and not the raw address', async () => {
    const a = await supabaseDeps(env).hashIp('203.0.113.9');
    const b = await supabaseDeps(env).hashIp('203.0.113.9');
    const c = await supabaseDeps({ ...env, IP_HASH_SECRET: 'other' }).hashIp('203.0.113.9');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('makes long random passwords', () => {
    const p = supabaseDeps(env).randomPassword();
    expect(p.length).toBeGreaterThanOrEqual(40);
    expect(p).not.toBe(supabaseDeps(env).randomPassword());
  });

  it('throws on a failed upstream call', async () => {
    const fetchImpl = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    await expect(supabaseDeps(env, fetchImpl).beginEnrollment('c', 'h')).rejects.toThrow('begin_enrollment failed with 500');
  });
});
