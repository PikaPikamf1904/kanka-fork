// Fog of war: players receive only the revealed areas of maps they can read, and only the DM can
// draw, reveal or remove areas or turn fog on and off.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, columns, pool, resetFixtures } from './helpers.ts';

const WORLD = 'd0000000-0000-4000-8000-000000000001';
const NEST = 'd0000000-0000-4000-8000-000000000002';

beforeEach(resetFixtures);
afterAll(() => pool.end());

describe('map fog of war', () => {
  it('a player sees only revealed areas, and none on a map they cannot read', async () => {
    const r = await as('player', 'select label, map_id from public.map_fog_areas order by label');
    expect(r.error).toBeUndefined();
    expect(columns(r.rows, 'label')).toEqual(['Harbour district']);
    const maps = await as('player', 'select slug, fog_enabled from public.maps');
    expect(maps.rows).toEqual([{ slug: 'world', fog_enabled: true }]);
  });

  it('anonymous visitors, outsiders and revoked players see nothing', async () => {
    for (const who of ['anon', 'outsider', 'revoked'] as const) {
      const r = await as(who, 'select * from public.map_fog_areas');
      expect(r.rows, who).toEqual([]);
    }
  });

  it('the DM sees every area, revealed or not', async () => {
    const r = await as('dm', 'select label, visibility from public.map_fog_areas order by label');
    expect(r.rows).toEqual([
      { label: 'FOGNEST entrance', visibility: 'players' },
      { label: 'FOGSECRET cove', visibility: 'dm' },
      { label: 'Harbour district', visibility: 'players' },
    ]);
  });

  it('a player cannot draw, reveal, move or remove an area, or turn fog off', async () => {
    const insert = await as('player', `insert into public.map_fog_areas (map_id, label, points, visibility) values ($1, 'mine', '[[0,0],[1,0],[1,1]]', 'players')`, [WORLD]);
    expect(insert.error?.code).toBe('42501');
    const reveal = await as('player', "update public.map_fog_areas set visibility = 'players' where label = 'FOGSECRET cove' returning id");
    expect(reveal.rows).toEqual([]);
    const remove = await as('player', "delete from public.map_fog_areas where label = 'Harbour district' returning id");
    expect(remove.rows).toEqual([]);
    const fogOff = await as('player', 'update public.maps set fog_enabled = false where id = $1 returning id', [WORLD]);
    expect(fogOff.error?.code ?? (fogOff.rows.length === 0 ? 'no rows' : 'changed')).not.toBe('changed');
  });

  it('the DM can draw, reveal and remove areas and turn fog on and off', async () => {
    const draw = await as('dm', `insert into public.map_fog_areas (map_id, label, points) values ($1, 'New area', '[[5,5],[15,5],[15,15],[5,15]]') returning visibility`, [WORLD]);
    expect(draw.error).toBeUndefined();
    expect(draw.rows).toEqual([{ visibility: 'dm' }]); // drawn areas start fogged
    const reveal = await as('dm', "update public.map_fog_areas set visibility = 'players' where label = 'FOGSECRET cove' returning id");
    expect(reveal.rowCount).toBe(1);
    const remove = await as('dm', "delete from public.map_fog_areas where label = 'Harbour district' returning id");
    expect(remove.rowCount).toBe(1);
    const toggle = await as('dm', 'update public.maps set fog_enabled = false where id = $1 returning fog_enabled', [NEST]);
    expect(toggle.rows).toEqual([{ fog_enabled: false }]);
  });

  it('refuses malformed areas', async () => {
    for (const points of ['[[0,0],[1,1]]', '{"x":1}', JSON.stringify(Array.from({ length: 201 }, (_, i) => [i, i]))]) {
      const r = await as('dm', `insert into public.map_fog_areas (map_id, points) values ($1, $2::jsonb)`, [WORLD, points]);
      expect(r.error?.code, points.slice(0, 20)).toBe('23514');
    }
  });

  it('areas go when their map is deleted', async () => {
    const r = await as('dm', 'delete from public.maps where id = $1 returning id', [NEST]);
    expect(r.rowCount).toBe(1);
  });
});
