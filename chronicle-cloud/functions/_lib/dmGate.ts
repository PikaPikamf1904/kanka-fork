// The DM screen passcode. Runs only on the server (Cloudflare Pages Function).
//
// The passcode is the Pages secret DM_SCREEN_PASSCODE; it never reaches the browser or the repository.
// A correct passcode sets an HttpOnly cookie that proves "this browser passed the DM screen" for
// twelve hours. The cookie is signed with IP_HASH_SECRET and the passcode's own digest, so changing
// the passcode ends every open DM screen.
//
// The passcode IS the DM sign-in (the owner's choice, 2026-11-18): a correct passcode also starts a
// session for the campaign's one active DM account, without a password. Two-step sign-in, if the DM
// account has it turned on, is still asked for afterwards. Row Level Security still decides what that
// session may read. Wrong guesses are limited in the database (5 per address per 15 minutes, 100 per
// hour overall).

import { supabaseDeps, type EnrollEnv, type Session } from './enroll.ts';
import { joinDeps } from './join.ts';

export interface DmGateEnv extends EnrollEnv {
  DM_SCREEN_PASSCODE?: string;
}

export const COOKIE = 'chronicle_dm_gate';
export const GATE_SECONDS = 12 * 60 * 60;

export interface DmGateDeps {
  begin(ipHash: string): Promise<{ status: string; attempt?: number }>;
  finish(attempt: number): Promise<void>;
  hashIp(ip: string): Promise<string>;
  now(): number;
  /** A fresh session for the campaign's one active DM account (no password). */
  dmSession(): Promise<Session>;
}

export interface DmGateRequest {
  method: string;
  url: string;
  origin: string | null;
  contentType: string | null;
  ip: string | null;
  cookie: string | null;
  body: unknown;
}

export interface DmGateResponse {
  status: number;
  body: Record<string, unknown>;
  setCookie?: string;
}

export const GATE_MESSAGES = {
  bad: 'That request was not valid.',
  wrong: 'That passcode was not accepted.',
  limited: 'Too many attempts. Wait a few minutes and try again.',
  unconfigured: 'The DM screen is not configured.',
} as const;

const fail = (status: number, message: string): DmGateResponse => ({ status, body: { error: message } });
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(text: string) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Compare two strings without stopping at the first difference. */
export function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function sign(env: DmGateEnv, expires: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.IP_HASH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const message = `dm-gate|${expires}|${await sha256Hex(env.DM_SCREEN_PASSCODE ?? '')}`;
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

export async function makeCookieValue(env: DmGateEnv, now: number): Promise<string> {
  const expires = Math.floor(now / 1000) + GATE_SECONDS;
  return `${expires}.${await sign(env, expires)}`;
}

export async function cookieIsValid(env: DmGateEnv, cookieHeader: string | null, now: number): Promise<boolean> {
  if (!env.DM_SCREEN_PASSCODE) return false;
  const raw = (cookieHeader ?? '').split(';').map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE}=`));
  const value = raw?.slice(COOKIE.length + 1) ?? '';
  const [expiresText, mac] = value.split('.');
  const expires = Number(expiresText);
  if (!mac || !Number.isInteger(expires) || expires * 1000 < now) return false;
  return sameText(mac, await sign(env, expires));
}

const cookie = (value: string, maxAge: number) =>
  `${COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;

export async function handleDmGate(req: DmGateRequest, env: DmGateEnv, deps: DmGateDeps): Promise<DmGateResponse> {
  const configured = !!env.DM_SCREEN_PASSCODE;
  if (req.method === 'GET') {
    return { status: 200, body: { configured, open: await cookieIsValid(env, req.cookie, deps.now()) } };
  }
  if (req.method !== 'POST') return fail(405, GATE_MESSAGES.bad);
  if (req.origin !== new URL(req.url).origin) return fail(403, GATE_MESSAGES.bad);
  if (!req.contentType?.toLowerCase().startsWith('application/json')) return fail(415, GATE_MESSAGES.bad);

  const body = req.body as { passcode?: unknown; lock?: unknown } | null;
  if (body?.lock === true) return { status: 200, body: { open: false }, setCookie: cookie('', 0) };
  if (!configured) return fail(503, GATE_MESSAGES.unconfigured);
  const passcode = typeof body?.passcode === 'string' ? body.passcode.trim() : '';
  if (!passcode || passcode.length > 64 || !req.ip) return fail(400, GATE_MESSAGES.bad);

  // The attempt is recorded as a failure first, under a lock, so parallel guesses all count.
  const check = await deps.begin(await deps.hashIp(req.ip));
  if (check.status === 'rate_limited') return fail(429, GATE_MESSAGES.limited);
  if (check.status !== 'ok' || typeof check.attempt !== 'number') return fail(500, GATE_MESSAGES.bad);

  const [given, wanted] = await Promise.all([sha256Hex(passcode), sha256Hex(env.DM_SCREEN_PASSCODE!)]);
  if (!sameText(given, wanted)) return fail(401, GATE_MESSAGES.wrong);

  await deps.finish(check.attempt);
  const session = await deps.dmSession();
  return {
    status: 200,
    body: {
      open: true,
      session: { access_token: session.access_token, refresh_token: session.refresh_token, expires_in: session.expires_in, token_type: session.token_type },
    },
    setCookie: cookie(await makeCookieValue(env, deps.now()), GATE_SECONDS),
  };
}

export function dmGateDeps(env: DmGateEnv, fetchImpl: typeof fetch = fetch): DmGateDeps {
  const base = env.SUPABASE_URL.replace(/\/+$/, '');
  const headers = { apikey: env.SUPABASE_SECRET_KEY, 'content-type': 'application/json' };
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await fetchImpl(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args) });
    if (!res.ok) throw new Error(`${name} failed with ${res.status}`);
    return res;
  };
  return {
    async begin(ipHash) {
      return (await (await call('begin_dm_gate', { p_ip_hash: ipHash })).json()) as { status: string; attempt?: number };
    },
    // finish_dm_gate returns nothing, so there is no body to read.
    async finish(attempt) {
      await call('finish_dm_gate', { p_attempt: attempt });
    },
    hashIp: supabaseDeps(env, fetchImpl).hashIp,
    now: () => Date.now(),
    async dmSession() {
      const res = await fetchImpl(`${base}/rest/v1/campaign_members?role=eq.dm&revoked_at=is.null&select=user_id`, {
        headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` },
      });
      if (!res.ok) throw new Error(`find DM failed with ${res.status}`);
      const rows = (await res.json()) as { user_id: string }[];
      // Exactly one active DM, or no session at all: never guess which account to open.
      if (rows.length !== 1) throw new Error(`expected one active DM, found ${rows.length}`);
      const join = joinDeps(env, fetchImpl);
      return join.sessionFor(await join.getUserEmail(rows[0]!.user_id));
    },
  };
}
