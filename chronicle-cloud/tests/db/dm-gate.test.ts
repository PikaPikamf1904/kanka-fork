// The DM screen passcode's attempt log (20261118000100): server-only, limited, and atomic.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, asService, pool } from './helpers.ts';

const ip = (n: number) => `${String(n).padStart(2, '0')}`.repeat(16);

beforeEach(async () => {
  await admin('delete from public.dm_gate_attempts');
});
afterAll(async () => {
  await admin('delete from public.dm_gate_attempts');
  await pool.end();
});

describe('dm gate attempts', () => {
  it('only the server key can use it; no signed-in role or visitor can read or call it', async () => {
    for (const who of ['dm', 'player', 'outsider', 'anon'] as const) {
      expect((await as(who, `select public.begin_dm_gate('${ip(1)}')`)).error?.code).toBe('42501');
      expect((await as(who, 'select count(*) from public.dm_gate_attempts')).error?.code).toBe('42501');
    }
    const r = await asService(`select public.begin_dm_gate('${ip(1)}') as r`);
    expect(r.rows[0]!.r.status).toBe('ok');
  });

  it('refuses a malformed address hash', async () => {
    await expect(asService(`select public.begin_dm_gate('short')`)).rejects.toThrow();
  });

  it('five failures from one address in 15 minutes stop further tries; another address is unaffected', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await asService(`select public.begin_dm_gate('${ip(2)}') as r`)).rows[0]!.r.status).toBe('ok');
    }
    expect((await asService(`select public.begin_dm_gate('${ip(2)}') as r`)).rows[0]!.r.status).toBe('rate_limited');
    expect((await asService(`select public.begin_dm_gate('${ip(3)}') as r`)).rows[0]!.r.status).toBe('ok');
  });

  it('a successful attempt does not count against the limit', async () => {
    for (let i = 0; i < 4; i += 1) await asService(`select public.begin_dm_gate('${ip(4)}')`);
    const { attempt } = (await asService(`select public.begin_dm_gate('${ip(4)}') as r`)).rows[0]!.r;
    await asService('select public.finish_dm_gate($1)', [attempt]);
    expect((await asService(`select public.begin_dm_gate('${ip(4)}') as r`)).rows[0]!.r.status).toBe('ok');
  });

  it('parallel guesses cannot all slip under the limit', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => asService(`select public.begin_dm_gate('${ip(5)}') as r`)),
    );
    expect(results.filter((x) => x.rows[0]!.r.status === 'ok')).toHaveLength(5);
  });

  it('a hundred failures in an hour from many addresses stop everyone', async () => {
    await admin(
      `insert into public.dm_gate_attempts (ip_hash) select md5(g::text) || md5(g::text) from generate_series(1, 100) g`,
    );
    expect((await asService(`select public.begin_dm_gate('${ip(6)}') as r`)).rows[0]!.r.status).toBe('rate_limited');
  });
});
