// Joining with a personal invitation link. Runs only on the server (Cloudflare Pages Function);
// the Supabase secret key never reaches the browser.
//
// The link is /join#<64 hex characters>. The browser posts the token here:
//   action "preview": is the link still good, and whose is it? Nothing is used up.
//   action "join":    claim the invitation (single use, under the enrollment lock and limits),
//                     create the player's account the first time or reuse it for another device,
//                     start a session without any password, and record the device by its session
//                     id so the DM can sign that one device out later.
// A name or an IP address is never treated as proof of identity: only the unguessable token is.

import { supabaseDeps, type EnrollEnv, type Session } from './enroll.ts';

export type JoinEnv = EnrollEnv;

export interface InvitationCheck {
  status: string;
  invitation_id?: string;
  display_name?: string;
  member_user_id?: string | null;
}

export interface JoinDeps {
  beginInvitation(tokenHash: string, ipHash: string, claim: boolean): Promise<InvitationCheck>;
  releaseInvitation(invitationId: string): Promise<void>;
  finishInvitation(invitationId: string, userId: string, sessionId: string, label: string): Promise<string>;
  createUser(email: string): Promise<string>;
  getUserEmail(userId: string): Promise<string>;
  deleteUser(userId: string): Promise<void>;
  /** A fresh session for this account, without a password (one-time magic-link token, exchanged at once). */
  sessionFor(email: string): Promise<Session>;
  /** End one session (used when the device could not be recorded, so no untracked session is left). */
  endSession(accessToken: string): Promise<void>;
  verifyTurnstile(token: string, ip: string): Promise<boolean>;
  randomId(): string;
  hashIp(ip: string): Promise<string>;
}

export interface JoinRequest {
  method: string;
  url: string;
  origin: string | null;
  contentType: string | null;
  ip: string | null;
  userAgent: string | null;
  body: unknown;
}

export interface JoinResponse {
  status: number;
  body: Record<string, unknown>;
}

export const JOIN_MESSAGES = {
  bad: 'That request was not valid.',
  invalid: 'This invitation link cannot be used. It may have been used already, replaced or expired. Ask your DM for a new link.',
  limited: 'Too many attempts. Wait a few minutes and try again.',
  turnstile: 'Please complete the check and try again.',
} as const;

const fail = (status: number, message: string): JoinResponse => ({ status, body: { error: message } });

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The session id inside a Supabase access token (the token came straight from our own Auth server). */
export function sessionIdOf(accessToken: string): string | null {
  const part = accessToken.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const claims = JSON.parse(json) as { session_id?: unknown };
    return typeof claims.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(claims.session_id) ? claims.session_id : null;
  } catch {
    return null;
  }
}

/** A short, human label for a device from its user agent ("Safari on iPhone"). Never the IP. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const os = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /CrOS/.test(ua) ? 'Chromebook'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : '';
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'Unknown browser';
}

export async function handleJoin(req: JoinRequest, env: JoinEnv, deps: JoinDeps): Promise<JoinResponse> {
  if (req.method !== 'POST') return fail(405, JOIN_MESSAGES.bad);
  const expected = new URL(req.url).origin;
  if (req.origin !== expected) return fail(403, JOIN_MESSAGES.bad);
  if (!req.contentType?.toLowerCase().startsWith('application/json')) return fail(415, JOIN_MESSAGES.bad);

  const body = req.body as { token?: unknown; action?: unknown; turnstileToken?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token.trim().toLowerCase() : '';
  const action = body?.action === 'preview' || body?.action === 'join' ? body.action : null;
  if (!/^[0-9a-f]{64}$/.test(token) || !action || !req.ip) return fail(400, JOIN_MESSAGES.bad);

  if (env.TURNSTILE_SECRET_KEY && action === 'join') {
    const t = typeof body?.turnstileToken === 'string' ? body.turnstileToken : '';
    if (!t || !(await deps.verifyTurnstile(t, req.ip))) return fail(400, JOIN_MESSAGES.turnstile);
  }

  const tokenHash = await sha256Hex(token);
  const ipHash = await deps.hashIp(req.ip);
  const check = await deps.beginInvitation(tokenHash, ipHash, action === 'join');
  if (check.status === 'rate_limited') return fail(429, JOIN_MESSAGES.limited);
  if (check.status !== 'ok' || !check.invitation_id || !check.display_name) return fail(401, JOIN_MESSAGES.invalid);
  if (action === 'preview') return { status: 200, body: { displayName: check.display_name, returning: !!check.member_user_id } };

  const invitationId = check.invitation_id;
  let createdUser: string | null = null;
  let session: Session | null = null;
  try {
    let userId = check.member_user_id ?? null;
    let email: string;
    if (userId) {
      email = await deps.getUserEmail(userId);
    } else {
      email = `player-${deps.randomId()}@players.chronicle.invalid`;
      userId = createdUser = await deps.createUser(email);
    }
    session = await deps.sessionFor(email);
    const sessionId = sessionIdOf(session.access_token);
    if (!sessionId) throw new Error('session without an id');
    const result = await deps.finishInvitation(invitationId, userId, sessionId, deviceLabel(req.userAgent));
    if (result !== 'joined') throw new Error(`finish returned ${result}`);
    return {
      status: 200,
      body: {
        displayName: check.display_name,
        session: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
          token_type: session.token_type,
        },
      },
    };
  } catch (error) {
    // Leave nothing half-done: no untracked session, no orphan account, and the link still usable.
    if (session && !createdUser) await deps.endSession(session.access_token).catch(() => undefined);
    if (createdUser) await deps.deleteUser(createdUser).catch(() => undefined);
    await deps.releaseInvitation(invitationId).catch(() => undefined);
    throw error;
  }
}

/** Real dependencies: Supabase REST/Auth over fetch. */
export function joinDeps(env: JoinEnv, fetchImpl: typeof fetch = fetch): JoinDeps {
  const base = env.SUPABASE_URL.replace(/\/+$/, '');
  const secretHeaders = { apikey: env.SUPABASE_SECRET_KEY, 'content-type': 'application/json' };
  const shared = supabaseDeps(env, fetchImpl);

  async function json<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) throw new Error(`${what} failed with ${res.status}`);
    return (await res.json()) as T;
  }
  const rpc = async <T>(name: string, args: Record<string, unknown>) =>
    json<T>(await fetchImpl(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers: secretHeaders, body: JSON.stringify(args) }), name);

  return {
    beginInvitation: (tokenHash, ipHash, claim) =>
      rpc<InvitationCheck>('begin_player_invitation', { p_token_hash: tokenHash, p_ip_hash: ipHash, p_claim: claim }),
    async releaseInvitation(invitationId) {
      await fetchImpl(`${base}/rest/v1/rpc/release_player_invitation`, {
        method: 'POST', headers: secretHeaders, body: JSON.stringify({ p_invitation: invitationId }),
      });
    },
    finishInvitation: (invitationId, userId, sessionId, label) =>
      rpc<string>('finish_player_invitation', { p_invitation: invitationId, p_user: userId, p_session: sessionId, p_label: label }),
    async createUser(email) {
      const res = await fetchImpl(`${base}/auth/v1/admin/users`, {
        method: 'POST', headers: secretHeaders, body: JSON.stringify({ email, email_confirm: true }),
      });
      return (await json<{ id: string }>(res, 'create user')).id;
    },
    async getUserEmail(userId) {
      const res = await fetchImpl(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers: secretHeaders });
      const user = await json<{ email?: string }>(res, 'read user');
      if (!user.email) throw new Error('player account has no sign-in address');
      return user.email;
    },
    deleteUser: shared.deleteUser,
    async sessionFor(email) {
      const link = await json<{ hashed_token?: string; properties?: { hashed_token?: string } }>(
        await fetchImpl(`${base}/auth/v1/admin/generate_link`, {
          method: 'POST', headers: secretHeaders, body: JSON.stringify({ type: 'magiclink', email }),
        }),
        'generate link',
      );
      const tokenHash = link.properties?.hashed_token ?? link.hashed_token;
      if (!tokenHash) throw new Error('no one-time token');
      return json<Session>(
        await fetchImpl(`${base}/auth/v1/verify`, {
          method: 'POST',
          headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
        }),
        'start session',
      );
    },
    async endSession(accessToken) {
      await fetchImpl(`${base}/auth/v1/logout?scope=local`, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${accessToken}` },
      });
    },
    verifyTurnstile: shared.verifyTurnstile,
    randomId: shared.randomId,
    hashIp: shared.hashIp,
  };
}
