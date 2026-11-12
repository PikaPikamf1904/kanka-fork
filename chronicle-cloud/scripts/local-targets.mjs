// Fail closed before any local test or seed can mutate a database or use an API key.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const localAdminUrl = 'postgres://supabase_admin@127.0.0.1:54322/postgres';
export function assertDatabaseUrl(url) {
  if (url !== localAdminUrl && url !== 'postgres://postgres@127.0.0.1:54322/postgres') {
    throw new Error('Refusing non-local or modified database URL.');
  }
}
export function assertServiceUrl(url) {
  if (url !== 'http://127.0.0.1:54321') throw new Error('Refusing non-local API URL.');
}
export function assertBrowserUrl(url) {
  if (url !== 'http://127.0.0.1:8788') throw new Error('Refusing non-local browser URL.');
}
export function assertLocalKey(token, role, secret) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3 || !/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid local API key.');
  const [header, payload, signature] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  if (signature !== expected) throw new Error('API key was not minted by this local stack.');
  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString());
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (h.alg !== 'HS256' || p.role !== role || p.iss !== 'chronicle-local') throw new Error();
  } catch {
    throw new Error('Invalid local API key claims.');
  }
}
export function readLocalEnv() {
  const env = Object.fromEntries(fs.readFileSync(path.join(root, '.local/env'), 'utf8')
    .split('\n').filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assertDatabaseUrl(env.DATABASE_URL);
  assertServiceUrl(env.SUPABASE_URL);
  const secret = fs.readFileSync(path.join(root, '.local/jwt_secret'), 'utf8').trim();
  assertLocalKey(env.SUPABASE_PUBLISHABLE_KEY, 'anon', secret);
  assertLocalKey(env.SUPABASE_SECRET_KEY, 'service_role', secret);
  return env;
}
export async function assertDisposableDatabase(url = localAdminUrl) {
  assertDatabaseUrl(url);
  const marker = fs.readFileSync(path.join(root, '.local/test-db-marker'), 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(marker)) throw new Error('Invalid local database marker.');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query('select marker from chronicle_local_test.identity');
    if (result.rows.length !== 1 || result.rows[0].marker !== marker) throw new Error('Database is not the disposable local stack.');
  } finally {
    await client.end();
  }
}
