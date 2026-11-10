// Player enrollment with the shared access code. Runs only on the server (Cloudflare Pages
// Function); the Supabase secret key never reaches the browser.
//
// 1. Reject cross-site requests and malformed input.
// 2. Optional Cloudflare Turnstile check (free) when TURNSTILE_SECRET_KEY is set.
// 3. begin_enrollment(code, hashed IP): rate limits + bcrypt check, in the database.
// 4. Create a fresh Auth user for this device with a random password that is never stored.
// 5. complete_enrollment(user, code): add the user as a player (re-checks the code).
// 6. Sign that user in and hand the session to the browser. supabase-js then keeps it fresh with
//    its refresh token, so the device stays signed in until the DM revokes it or the player leaves.

export interface EnrollEnv {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY: string;
  /** Random secret used to hash client IPs, so raw addresses are never stored. */
  IP_HASH_SECRET: string;
  TURNSTILE_SECRET_KEY?: string;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface EnrollDeps {
  beginEnrollment(code: string, ipHash: string): Promise<{ status: string; code_id?: string }>;
  createUser(email: string, password: string): Promise<string>;
  completeEnrollment(userId: string, codeId: string, displayName: string): Promise<string>;
  deleteUser(userId: string): Promise<void>;
  signIn(email: string, password: string): Promise<Session>;
  verifyTurnstile(token: string, ip: string): Promise<boolean>;
  randomId(): string;
  randomPassword(): string;
  hashIp(ip: string): Promise<string>;
}

export interface EnrollRequest {
  method: string;
  url: string;
  origin: string | null;
  contentType: string | null;
  ip: string | null;
  body: unknown;
}

export interface EnrollResponse {
  status: number;
  body: Record<string, unknown>;
}

const MESSAGES = {
  bad: 'That request was not valid.',
  invalid: 'That access code was not accepted.',
  limited: 'Too many attempts. Wait a few minutes and try again.',
  turnstile: 'Please complete the check and try again.',
  error: 'Something went wrong. Please try again.',
} as const;

const fail = (status: number, message: string): EnrollResponse => ({ status, body: { error: message } });

/** Largest enrollment request body accepted (a code, a name and an optional Turnstile token). */
export const MAX_BODY_BYTES = 4096;

/**
 * Read a JSON body without trusting its size: refuse anything over MAX_BODY_BYTES before parsing.
 * Returns null for a missing, oversized or malformed body; handleEnroll then answers 400.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) return null;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function handleEnroll(req: EnrollRequest, env: EnrollEnv, deps: EnrollDeps): Promise<EnrollResponse> {
  if (req.method !== 'POST') return fail(405, MESSAGES.bad);

  // CSRF: browsers always send Origin on a cross-site POST; only our own origin may enroll.
  const expected = new URL(req.url).origin;
  if (req.origin !== expected) return fail(403, MESSAGES.bad);
  if (!req.contentType?.toLowerCase().startsWith('application/json')) return fail(415, MESSAGES.bad);

  const body = req.body as { code?: unknown; displayName?: unknown; turnstileToken?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
  if (code.length < 1 || code.length > 200 || displayName.length < 1 || displayName.length > 60) {
    return fail(400, MESSAGES.bad);
  }
  if (!req.ip) return fail(400, MESSAGES.bad);

  if (env.TURNSTILE_SECRET_KEY) {
    const token = typeof body?.turnstileToken === 'string' ? body.turnstileToken : '';
    if (!token || !(await deps.verifyTurnstile(token, req.ip))) return fail(400, MESSAGES.turnstile);
  }

  const check = await deps.beginEnrollment(code, await deps.hashIp(req.ip));
  if (check.status === 'rate_limited') return fail(429, MESSAGES.limited);
  if (check.status !== 'ok' || !check.code_id) return fail(401, MESSAGES.invalid);

  const email = `player-${deps.randomId()}@players.chronicle.invalid`;
  const password = deps.randomPassword();
  const userId = await deps.createUser(email, password);
  try {
    const result = await deps.completeEnrollment(userId, check.code_id, displayName);
    if (result !== 'enrolled') {
      await deps.deleteUser(userId);
      return fail(401, MESSAGES.invalid);
    }
    const session = await deps.signIn(email, password);
    return {
      status: 200,
      body: {
        session: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
          token_type: session.token_type,
        },
      },
    };
  } catch (error) {
    await deps.deleteUser(userId).catch(() => undefined);
    throw error;
  }
}

/** Real dependencies: Supabase REST/Auth over fetch, Web Crypto, Turnstile. */
export function supabaseDeps(env: EnrollEnv, fetchImpl: typeof fetch = fetch): EnrollDeps {
  const base = env.SUPABASE_URL.replace(/\/+$/, '');
  // The secret key goes in the apikey header only: Supabase's new secret keys are not JWTs.
  const secretHeaders = { apikey: env.SUPABASE_SECRET_KEY, 'content-type': 'application/json' };

  async function json<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) throw new Error(`${what} failed with ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async beginEnrollment(code, ipHash) {
      const res = await fetchImpl(`${base}/rest/v1/rpc/begin_enrollment`, {
        method: 'POST',
        headers: secretHeaders,
        body: JSON.stringify({ p_code: code, p_ip_hash: ipHash }),
      });
      return json(res, 'begin_enrollment');
    },
    async createUser(email, password) {
      const res = await fetchImpl(`${base}/auth/v1/admin/users`, {
        method: 'POST',
        headers: secretHeaders,
        body: JSON.stringify({ email, password, email_confirm: true }),
      });
      const user = await json<{ id: string }>(res, 'create user');
      return user.id;
    },
    async completeEnrollment(userId, codeId, displayName) {
      const res = await fetchImpl(`${base}/rest/v1/rpc/complete_enrollment`, {
        method: 'POST',
        headers: secretHeaders,
        body: JSON.stringify({ p_user: userId, p_code_id: codeId, p_display_name: displayName }),
      });
      return json(res, 'complete_enrollment');
    },
    async deleteUser(userId) {
      await fetchImpl(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: secretHeaders,
      });
    },
    async signIn(email, password) {
      const res = await fetchImpl(`${base}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return json(res, 'sign in');
    },
    async verifyTurnstile(token, ip) {
      const form = new FormData();
      form.append('secret', env.TURNSTILE_SECRET_KEY ?? '');
      form.append('response', token);
      form.append('remoteip', ip);
      const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
      if (!res.ok) return false;
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    },
    randomId: () => crypto.randomUUID(),
    randomPassword: () => {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      return btoa(String.fromCharCode(...bytes));
    },
    async hashIp(ip) {
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(env.IP_HASH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      );
      const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
      return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
    },
  };
}
