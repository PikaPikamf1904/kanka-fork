// Maintenance status for the website notice. Three sources:
//   1. MAINTENANCE_MODE=on in the Pages environment: the DM's manual switch (always works).
//   2. A "deploy" record in the optional CHRONICLE_STATUS KV namespace, posted by a deploy step
//      with the MAINTENANCE_TOKEN secret. It expires on its own (TTL), so a forgotten "end" cannot
//      leave the notice on.
//   3. "development" heartbeats (for example from a Claude Code session hook). These are recorded
//      but shown to visitors only when MAINTENANCE_SHOW_DEVELOPMENT=on, because editing a draft
//      branch does not disturb the live site.
// Visitors only ever learn whether to show the notice; nothing about who or what is working.

export interface StatusKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
export interface StatusEnv {
  MAINTENANCE_MODE?: string;
  MAINTENANCE_SHOW_DEVELOPMENT?: string;
  MAINTENANCE_TOKEN?: string;
  CHRONICLE_STATUS?: StatusKV;
}

export const NOTICE =
  'Declan is currently performing maintenance on Chronicle. Some features may be temporarily unavailable or behave unexpectedly. Please save your work before refreshing.';

const KINDS = ['deploy', 'development'] as const;
type Kind = (typeof KINDS)[number];
const MIN_TTL = 60;
const MAX_TTL = 3600;

export async function readStatus(env: StatusEnv): Promise<{ notice: boolean; message: string | null }> {
  let on = (env.MAINTENANCE_MODE ?? '').toLowerCase() === 'on';
  if (!on && env.CHRONICLE_STATUS) {
    try {
      on = (await env.CHRONICLE_STATUS.get('deploy')) !== null
        || ((env.MAINTENANCE_SHOW_DEVELOPMENT ?? '').toLowerCase() === 'on' && (await env.CHRONICLE_STATUS.get('development')) !== null);
    } catch {
      on = false; // a status store outage must not put a notice on the site
    }
  }
  return { notice: on, message: on ? NOTICE : null };
}

/** Constant-time comparison, so the token cannot be guessed byte by byte from response times. */
export function sameToken(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export async function writeStatus(env: StatusEnv, authHeader: string | null, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.MAINTENANCE_TOKEN || env.MAINTENANCE_TOKEN.length < 32) return { status: 404, body: { error: 'Not found.' } };
  const token = (authHeader ?? '').replace(/^Bearer\s+/i, '');
  if (!sameToken(token, env.MAINTENANCE_TOKEN)) return { status: 401, body: { error: 'Not allowed.' } };
  if (!env.CHRONICLE_STATUS) return { status: 501, body: { error: 'No status store is configured (bind a KV namespace as CHRONICLE_STATUS).' } };
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const kind = b.kind as Kind;
  const state = b.state;
  if (!KINDS.includes(kind) || !['start', 'heartbeat', 'end'].includes(state as string)) {
    return { status: 400, body: { error: 'Expected {"kind": "deploy" | "development", "state": "start" | "heartbeat" | "end"}.' } };
  }
  if (state === 'end') {
    await env.CHRONICLE_STATUS.delete(kind);
    return { status: 200, body: { ok: true } };
  }
  const ttl = Math.min(MAX_TTL, Math.max(MIN_TTL, Number(b.ttlSeconds) || 900));
  await env.CHRONICLE_STATUS.put(kind, JSON.stringify({ since: new Date().toISOString() }), { expirationTtl: ttl });
  return { status: 200, body: { ok: true, expiresInSeconds: ttl } };
}
