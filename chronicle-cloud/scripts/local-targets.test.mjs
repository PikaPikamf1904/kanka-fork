import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { assertDatabaseUrl, assertServiceUrl, assertBrowserUrl, assertLocalKey } from './local-targets.mjs';

test('only the exact local database connection strings are allowed', () => {
  assert.doesNotThrow(() => assertDatabaseUrl('postgres://supabase_admin@127.0.0.1:54322/postgres'));
  assert.doesNotThrow(() => assertDatabaseUrl('postgres://postgres@127.0.0.1:54322/postgres'));
  for (const value of [
    'postgres://supabase_admin@127.0.0.1:54322/postgres?host=production.example',
    'postgres://user:pass@production.example/postgres?x=@127.0.0.1:54322/',
    'postgres://postgres@localhost:54322/postgres',
    'postgres://postgres@127.0.0.1:54322/other',
  ]) assert.throws(() => assertDatabaseUrl(value));
});

test('service and browser targets must be exact local origins', () => {
  assert.doesNotThrow(() => assertServiceUrl('http://127.0.0.1:54321'));
  assert.doesNotThrow(() => assertBrowserUrl('http://127.0.0.1:8788'));
  for (const value of ['https://production.example', 'http://127.0.0.1:54321@production.example', 'http://127.0.0.1:54321/extra']) {
    assert.throws(() => assertServiceUrl(value));
  }
  for (const value of ['https://production.example', 'http://127.0.0.1:8788@production.example', 'http://localhost:8788']) {
    assert.throws(() => assertBrowserUrl(value));
  }
});


test('API credentials must be signed by this local stack and have the expected role', () => {
  const secret = 'a'.repeat(64);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role: 'service_role', iss: 'chronicle-local' })).toString('base64url');
  const data = `${header}.${payload}`;
  const token = `${data}.${crypto.createHmac('sha256', secret).update(data).digest('base64url')}`;
  assert.doesNotThrow(() => assertLocalKey(token, 'service_role', secret));
  assert.throws(() => assertLocalKey(token, 'anon', secret));
  assert.throws(() => assertLocalKey(token, 'service_role', 'b'.repeat(64)));
  assert.throws(() => assertLocalKey('not-a-token', 'service_role', secret));
});
