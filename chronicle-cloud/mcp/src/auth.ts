// Bearer-token verification for the Chronicle MCP server.
//
// Tokens are issued by the Supabase Auth OAuth 2.1 server of the Chronicle project, so the subject
// IS the Supabase user: the same token is then used for every database call and Row Level Security
// decides what it can read or write. This module only checks that the token is genuine, current,
// meant for this project, and was issued to an OAuth client (never a website session).
export interface AuthEnv {
  SUPABASE_URL: string;
  /** Local development and tests only: HS256 secret. Hosted projects use asymmetric keys (JWKS). */
  SUPABASE_JWT_SECRET?: string;
}

export interface Claims {
  sub: string;
  role: string;
  aud: string | string[];
  iss?: string;
  exp: number;
  client_id: string;
  aal?: string;
  scope?: string;
}

export class AuthError extends Error {}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let jwksCache: { url: string; at: number; keys: (JsonWebKey & { kid?: string })[] } | null = null;

async function jwks(url: string, fetchImpl: typeof fetch): Promise<(JsonWebKey & { kid?: string })[]> {
  if (jwksCache && jwksCache.url === url && Date.now() - jwksCache.at < 600_000) return jwksCache.keys;
  const res = await fetchImpl(url);
  if (!res.ok) throw new AuthError('signing keys unavailable');
  const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  jwksCache = { url, at: Date.now(), keys: body.keys ?? [] };
  return jwksCache.keys;
}

async function verifySignature(header: { alg?: string; kid?: string }, data: Uint8Array, sig: Uint8Array, env: AuthEnv, fetchImpl: typeof fetch): Promise<boolean> {
  if (header.alg === 'HS256') {
    // Symmetric tokens are only accepted when a secret is configured (local stack).
    if (!env.SUPABASE_JWT_SECRET) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SUPABASE_JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('HMAC', key, sig as BufferSource, data as BufferSource);
  }
  if (header.alg !== 'ES256' && header.alg !== 'RS256') return false;
  const keys = await jwks(`${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`, fetchImpl);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return false;
  const params = header.alg === 'ES256' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const key = await crypto.subtle.importKey('jwk', jwk, params, false, ['verify']);
  return crypto.subtle.verify(header.alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : params, key, sig as BufferSource, data as BufferSource);
}

/** Returns the verified claims, or throws AuthError. The reason is never sent to the client. */
export async function verifyToken(token: string, env: AuthEnv, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<Claims> {
  const parts = token.split('.');
  if (parts.length !== 3 || token.length > 8192) throw new AuthError('malformed');
  let header: { alg?: string; kid?: string };
  let claims: Partial<Claims>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(parts[0]!)));
    claims = JSON.parse(new TextDecoder().decode(b64url(parts[1]!)));
  } catch {
    throw new AuthError('malformed');
  }
  let ok: boolean;
  try {
    ok = await verifySignature(header, new TextEncoder().encode(`${parts[0]}.${parts[1]}`), b64url(parts[2]!), env, fetchImpl);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    ok = false;
  }
  if (!ok) throw new AuthError('bad signature');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) throw new AuthError('expired');
  const issuer = `${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`;
  if (claims.iss !== issuer) throw new AuthError('wrong issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes('authenticated') || claims.role !== 'authenticated') throw new AuthError('wrong audience');
  if (typeof claims.sub !== 'string' || !UUID.test(claims.sub)) throw new AuthError('no subject');
  // A website session token has no client_id. Accepting one here would let it pass as "the
  // website" inside the database and approve its own changes, so it is refused.
  if (typeof claims.client_id !== 'string' || claims.client_id.length < 1 || claims.client_id === 'web') throw new AuthError('not an OAuth client token');
  return claims as Claims;
}

export function resetJwksCache() {
  jwksCache = null;
}
