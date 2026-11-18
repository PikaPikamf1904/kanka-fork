import { describe, expect, it, vi } from 'vitest';
import type { EnrollEnv } from './enroll.ts';
import { deviceLabel, handleJoin, sessionIdOf, sha256Hex, type JoinDeps, type JoinRequest } from './join.ts';

const env: EnrollEnv = {
  SUPABASE_URL: 'https://project.supabase.example',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  IP_HASH_SECRET: 'ip-secret',
};
const TOKEN = 'ab'.repeat(32);
const SESSION = '7a3a0983-27b1-409a-b3d7-1b023110c436';
const jwt = (claims: Record<string, unknown>) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.s`;

function fakeDeps(check: Awaited<ReturnType<JoinDeps['beginInvitation']>>, overrides: Partial<JoinDeps> = {}): JoinDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    beginInvitation: vi.fn(async (hash: string, _ip: string, claim: boolean) => {
      calls.push(`begin:${claim ? 'claim' : 'preview'}:${hash.slice(0, 6)}`);
      return check;
    }),
    releaseInvitation: vi.fn(async (id: string) => { calls.push(`release:${id}`); }),
    finishInvitation: vi.fn(async (id: string, user: string, session: string, label: string) => {
      calls.push(`finish:${id}:${user}:${session}:${label}`);
      return 'joined';
    }),
    createUser: vi.fn(async () => { calls.push('create'); return 'new-user'; }),
    getUserEmail: vi.fn(async (id: string) => { calls.push(`email:${id}`); return 'player-x@players.chronicle.invalid'; }),
    deleteUser: vi.fn(async (id: string) => { calls.push(`delete:${id}`); }),
    sessionFor: vi.fn(async () => {
      calls.push('session');
      return { access_token: jwt({ sub: 'u', session_id: SESSION }), refresh_token: 'rt', expires_in: 3600, token_type: 'bearer' };
    }),
    endSession: vi.fn(async () => { calls.push('end'); }),
    verifyTurnstile: vi.fn(async (t: string) => t === 'ok'),
    randomId: () => 'rand',
    hashIp: async (ip: string) => `hashed(${ip})`,
    ...overrides,
  };
}

const request = (body: unknown, overrides: Partial<JoinRequest> = {}): JoinRequest => ({
  method: 'POST',
  url: 'https://chronicle.pages.dev/api/join',
  origin: 'https://chronicle.pages.dev',
  contentType: 'application/json',
  ip: '203.0.113.9',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  body,
  ...overrides,
});

const newPlayer = { status: 'ok', invitation_id: 'inv-1', display_name: 'Eliza', member_user_id: null };
const returning = { status: 'ok', invitation_id: 'inv-2', display_name: 'Eliza', member_user_id: 'eliza-user' };

describe('handleJoin', () => {
  it('refuses other sites, wrong methods, bad tokens and unknown actions before touching the database', async () => {
    const deps = fakeDeps(newPlayer);
    expect((await handleJoin(request({ token: TOKEN, action: 'join' }, { origin: 'https://evil.example' }), env, deps)).status).toBe(403);
    expect((await handleJoin(request({ token: TOKEN, action: 'join' }, { method: 'GET' }), env, deps)).status).toBe(405);
    expect((await handleJoin(request({ token: 'short', action: 'join' }), env, deps)).status).toBe(400);
    expect((await handleJoin(request({ token: TOKEN, action: 'steal' }), env, deps)).status).toBe(400);
    expect((await handleJoin(request({ token: TOKEN, action: 'join' }, { ip: null }), env, deps)).status).toBe(400);
    expect(deps.calls).toEqual([]);
  });

  it('preview names the player and uses nothing up; the database only ever sees the hash', async () => {
    const deps = fakeDeps(newPlayer);
    const res = await handleJoin(request({ token: TOKEN, action: 'preview' }), env, deps);
    expect(res).toEqual({ status: 200, body: { displayName: 'Eliza', returning: false } });
    const hash = await sha256Hex(TOKEN);
    expect(deps.beginInvitation).toHaveBeenCalledWith(hash, 'hashed(203.0.113.9)', false);
    expect(JSON.stringify(deps.calls)).not.toContain(TOKEN);
  });

  it('a first join creates the account, starts a session and records the device', async () => {
    const deps = fakeDeps(newPlayer);
    const res = await handleJoin(request({ token: TOKEN, action: 'join' }), env, deps);
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Eliza');
    expect(deps.calls.slice(1)).toEqual(['create', 'session', `finish:inv-1:new-user:${SESSION}:Safari on iPhone`]);
  });

  it('a later invitation for the same player signs the same account in on another device', async () => {
    const deps = fakeDeps(returning);
    const res = await handleJoin(request({ token: TOKEN, action: 'join' }), env, deps);
    expect(res.status).toBe(200);
    expect(deps.calls.slice(1)).toEqual(['email:eliza-user', 'session', `finish:inv-2:eliza-user:${SESSION}:Safari on iPhone`]);
    expect(deps.createUser).not.toHaveBeenCalled();
  });

  it('used, expired, revoked or rate-limited links give one generic answer and no account', async () => {
    for (const [check, status] of [[{ status: 'invalid' }, 401], [{ status: 'rate_limited' }, 429]] as const) {
      const deps = fakeDeps(check);
      const res = await handleJoin(request({ token: TOKEN, action: 'join' }), env, deps);
      expect(res.status).toBe(status);
      expect(deps.createUser).not.toHaveBeenCalled();
      expect(deps.sessionFor).not.toHaveBeenCalled();
    }
  });

  it('if recording the device fails, nothing is left behind and the link can be tried again', async () => {
    const fresh = fakeDeps(newPlayer, { finishInvitation: vi.fn(async () => 'invalid') });
    await expect(handleJoin(request({ token: TOKEN, action: 'join' }), env, fresh)).rejects.toThrow();
    expect(fresh.calls).toContain('delete:new-user');
    expect(fresh.calls).toContain('release:inv-1');

    const again = fakeDeps(returning, { finishInvitation: vi.fn(async () => { throw new Error('db down'); }) });
    await expect(handleJoin(request({ token: TOKEN, action: 'join' }), env, again)).rejects.toThrow();
    expect(again.calls).toContain('end');
    expect(again.calls).toContain('release:inv-2');
    expect(again.deleteUser).not.toHaveBeenCalled();
  });

  it('asks for the Turnstile check on join only when it is configured', async () => {
    const deps = fakeDeps(newPlayer);
    const withTurnstile = { ...env, TURNSTILE_SECRET_KEY: 'x' };
    expect((await handleJoin(request({ token: TOKEN, action: 'join' }), withTurnstile, deps)).status).toBe(400);
    expect((await handleJoin(request({ token: TOKEN, action: 'join', turnstileToken: 'ok' }), withTurnstile, deps)).status).toBe(200);
    expect((await handleJoin(request({ token: TOKEN, action: 'preview' }), withTurnstile, fakeDeps(newPlayer))).status).toBe(200);
  });
});

describe('helpers', () => {
  it('reads the session id from an access token', () => {
    expect(sessionIdOf(jwt({ session_id: SESSION }))).toBe(SESSION);
    expect(sessionIdOf(jwt({ session_id: 'nope' }))).toBeNull();
    expect(sessionIdOf('garbage')).toBeNull();
  });

  it('labels devices from the user agent only', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge on Windows');
    expect(deviceLabel(null)).toBe('Unknown browser');
  });
});
