// 20261116000100: players cannot learn where the party is unless that page is visible to them.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, pool, resetFixtures } from './helpers.ts';

const PUBLIC = 'a0000000-0000-4000-8000-00000000000a';
const SECRET = 'a0000000-0000-4000-8000-00000000000b';
const DRAFT = 'a0000000-0000-4000-8000-00000000000c';

beforeEach(resetFixtures);
afterAll(async () => {
  await admin(`update public.campaign_settings set current_location_id = null`);
  await pool.end();
});

describe('current location', () => {
  it('a player cannot read the location id directly, whatever it points at', async () => {
    await admin(`update public.campaign_settings set current_location_id = $1`, [SECRET]);
    for (const sql of ['select current_location_id from public.campaign_settings', 'select * from public.campaign_settings']) {
      expect((await as('player', sql)).error?.code, sql).toBe('42501');
    }
    // Ordinary settings stay readable.
    expect((await as('player', 'select title, tagline, overview, banner_media_id, current_status from public.campaign_settings')).rowCount).toBe(1);
  });

  it('the function returns a hidden or draft location only to the DM; a visible one to members', async () => {
    for (const [loc, playerSees] of [[SECRET, false], [DRAFT, false], [PUBLIC, true]] as const) {
      await admin(`update public.campaign_settings set current_location_id = $1`, [loc]);
      const p = await as<{ id: string }>('player', 'select id from public.campaign_location()');
      expect(p.rows.map((r) => r.id), loc).toEqual(playerSees ? [loc] : []);
      expect((await as<{ id: string }>('dm', 'select id from public.campaign_location()')).rows.map((r) => r.id)).toEqual([loc]);
      for (const who of ['revoked', 'outsider'] as const) expect((await as(who, 'select * from public.campaign_location()')).rowCount, who).toBe(0);
      expect((await as('anon', 'select * from public.campaign_location()')).error?.code).toBe('42501');
    }
  });

  it('a hidden location and no location look the same to a player', async () => {
    await admin(`update public.campaign_settings set current_location_id = null`);
    const none = await as('player', 'select * from public.campaign_location()');
    await admin(`update public.campaign_settings set current_location_id = $1`, [SECRET]);
    const hidden = await as('player', 'select * from public.campaign_location()');
    expect(hidden).toEqual(none);
  });

  it('the DM can still set and read it; a player cannot set it', async () => {
    expect((await as('dm', `update public.campaign_settings set current_location_id = $1 returning title`, [SECRET])).rowCount).toBe(1);
    expect((await as('player', `update public.campaign_settings set current_location_id = $1`, [SECRET])).rowCount).toBe(0);
  });
});
