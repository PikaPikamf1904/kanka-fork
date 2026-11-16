import { describe, expect, it } from 'vitest';
import { NOTICE, readStatus, sameToken, writeStatus, type StatusKV } from './status.ts';

function kv(): StatusKV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, put: async (k, v) => { data.set(k, v); }, delete: async (k) => { data.delete(k); } };
}
const TOKEN = 'x'.repeat(40);

describe('maintenance status', () => {
  it('is off by default and on with the manual switch, with the exact visitor message', async () => {
    expect(await readStatus({})).toEqual({ notice: false, message: null });
    expect(await readStatus({ MAINTENANCE_MODE: 'on' })).toEqual({ notice: true, message: NOTICE });
    expect(NOTICE).not.toMatch(/\b(AI|Claude|ChatGPT|agents?|bot)\b/i);
  });

  it('shows deploys, and development only when opted in', async () => {
    const store = kv();
    const env = { MAINTENANCE_TOKEN: TOKEN, CHRONICLE_STATUS: store };
    expect((await writeStatus(env, `Bearer ${TOKEN}`, { kind: 'development', state: 'start' })).status).toBe(200);
    expect((await readStatus(env)).notice).toBe(false);
    expect((await readStatus({ ...env, MAINTENANCE_SHOW_DEVELOPMENT: 'on' })).notice).toBe(true);
    await writeStatus(env, `Bearer ${TOKEN}`, { kind: 'deploy', state: 'start', ttlSeconds: 5 });
    expect((await readStatus(env)).notice).toBe(true);
    await writeStatus(env, `Bearer ${TOKEN}`, { kind: 'deploy', state: 'end' });
    expect((await readStatus(env)).notice).toBe(false);
  });

  it('refuses writes without the right token, with a short token, or without a store', async () => {
    const store = kv();
    expect((await writeStatus({ CHRONICLE_STATUS: store }, `Bearer ${TOKEN}`, { kind: 'deploy', state: 'start' })).status).toBe(404);
    expect((await writeStatus({ MAINTENANCE_TOKEN: 'short', CHRONICLE_STATUS: store }, 'Bearer short', { kind: 'deploy', state: 'start' })).status).toBe(404);
    expect((await writeStatus({ MAINTENANCE_TOKEN: TOKEN, CHRONICLE_STATUS: store }, 'Bearer wrong', { kind: 'deploy', state: 'start' })).status).toBe(401);
    expect((await writeStatus({ MAINTENANCE_TOKEN: TOKEN }, `Bearer ${TOKEN}`, { kind: 'deploy', state: 'start' })).status).toBe(501);
    expect((await writeStatus({ MAINTENANCE_TOKEN: TOKEN, CHRONICLE_STATUS: store }, `Bearer ${TOKEN}`, { kind: 'other', state: 'start' })).status).toBe(400);
    expect(store.data.size).toBe(0);
  });

  it('caps the lifetime and survives a status store outage', async () => {
    const puts: number[] = [];
    const store: StatusKV = { get: async () => { throw new Error('down'); }, put: async (_k, _v, o) => { puts.push(o?.expirationTtl ?? 0); }, delete: async () => undefined };
    await writeStatus({ MAINTENANCE_TOKEN: TOKEN, CHRONICLE_STATUS: store }, `Bearer ${TOKEN}`, { kind: 'deploy', state: 'heartbeat', ttlSeconds: 99999 });
    expect(puts).toEqual([3600]);
    expect((await readStatus({ CHRONICLE_STATUS: store })).notice).toBe(false);
    expect(sameToken('abc', 'abc')).toBe(true);
    expect(sameToken('abc', 'abd')).toBe(false);
  });
});
