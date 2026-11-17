// The DM's maintenance switch (20261117000700): DM-only, always expiring, members see only on/off.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, pool, resetFixtures } from './helpers.ts';

beforeEach(async () => {
  await resetFixtures();
  await admin('update public.campaign_settings set maintenance_until = null');
});
afterAll(async () => {
  await admin('update public.campaign_settings set maintenance_until = null');
  await pool.end();
});

describe('maintenance switch', () => {
  it('only the DM on the website can switch it, for at most eight hours', async () => {
    for (const who of ['player', 'revoked', 'outsider'] as const) {
      expect((await as(who, 'select public.set_maintenance(30)')).error?.code).toBe('42501');
    }
    expect((await as('anon', 'select public.set_maintenance(30)')).error?.code).toBe('42501');
    expect((await as('dm', 'select public.set_maintenance(30)', [], { extra: { client_id: 'assistant' } })).error?.code).toBe('42501');
    expect((await as('dm', 'select public.set_maintenance(481)')).error?.code).toBe('22023');
    expect((await as('dm', 'select public.set_maintenance(30) as until')).rows[0]!.until).not.toBeNull();
  });

  it('members see whether it is on; it switches itself off when the time is up', async () => {
    await admin(`update public.campaign_settings set maintenance_until = now() + interval '10 minutes'`);
    expect((await as('player', 'select public.maintenance_switch() as until')).rows[0]!.until).not.toBeNull();
    expect((await as('outsider', 'select public.maintenance_switch() as until')).rows).toEqual([{ until: null }]);
    expect((await as('anon', 'select public.maintenance_switch()')).error?.code).toBe('42501');
    await admin(`update public.campaign_settings set maintenance_until = now() - interval '1 second'`);
    expect((await as('player', 'select public.maintenance_switch() as until')).rows[0]!.until).toBeNull();
    // The column itself is not readable through the API.
    expect((await as('player', 'select maintenance_until from public.campaign_settings')).error?.code).toBe('42501');
  });
});
