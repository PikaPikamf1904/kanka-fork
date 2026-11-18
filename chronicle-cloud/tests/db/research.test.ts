// Knowledge Studio (20261117000600): private-by-default research collections, party sharing by
// players only, and sources limited to pages the owner can read.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, ids, pool, resetFixtures } from './helpers.ts';

const VISIBLE = 'a0000000-0000-4000-8000-00000000000a';
const SECRET = 'a0000000-0000-4000-8000-00000000000b';
const SECOND = '00000000-0000-4000-8000-0000000000f2';
const oauth = { extra: { client_id: 'assistant' } };

async function asCommitted(user: string, sql: string, params: unknown[] = []) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: 'authenticated', aud: 'authenticated', aal: 'aal1' })]);
    const r = await client.query(sql, params);
    await client.query('commit');
    return r;
  } finally {
    client.release();
  }
}

let collection = '';
beforeEach(async () => {
  await resetFixtures();
  await admin('delete from public.research_collections');
  await admin('delete from auth.users where id = $1', [SECOND]);
  await admin(`insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', 'second@test.chronicle.invalid', now(), now())`, [SECOND]);
  await admin(`insert into public.campaign_members (user_id, role, display_name) values ($1, 'player', 'Second Player')`, [SECOND]);
  const c = await asCommitted(ids.player, `insert into public.research_collections (title, user_id) values ('Who funds the cult?', $1) returning id`, [ids.dm]);
  collection = c.rows[0]!.id as string;
  await asCommitted(ids.player, `insert into public.research_sources (collection_id, article_id, topic, excerpt) values ($1, $2, 'Leaders', 'A captain the party has met.')`, [collection, VISIBLE]);
  await asCommitted(ids.player, `insert into public.research_notes (collection_id, title, body) values ($1, 'Summary', 'The captain is involved [1].')`, [collection]);
});
afterAll(async () => {
  await admin('delete from public.research_collections');
  await admin('delete from auth.users where id = $1', [SECOND]);
  await pool.end();
});

describe('Knowledge Studio', () => {
  it('a collection is owned by its creator and private by default, even from the DM', async () => {
    expect((await admin('select user_id from public.research_collections')).rows).toEqual([{ user_id: ids.player }]);
    expect((await as('player', 'select title from public.research_collections')).rows).toHaveLength(1);
    for (const who of ['dm', 'revoked', 'outsider', 'anon'] as const) {
      expect((await as(who, 'select * from public.research_collections')).rows).toEqual([]);
      expect((await as(who, 'select * from public.research_sources')).rows).toEqual([]);
      expect((await as(who, 'select * from public.research_notes')).rows).toEqual([]);
    }
    expect((await as('player', 'select * from public.research_collections', [], oauth)).rows).toEqual([]);
  });

  it('only pages the owner can read can be added', async () => {
    expect((await as('player', 'insert into public.research_sources (collection_id, article_id) values ($1, $2)', [collection, SECRET])).error?.code).toBe('42501');
    expect((await as('dm', 'insert into public.research_sources (collection_id, article_id) values ($1, $2)', [collection, SECRET])).error?.code).toBe('42501');
  });

  it('a player can share with the party, read-only; the DM cannot share', async () => {
    await asCommitted(ids.player, 'update public.research_collections set shared = true where id = $1', [collection]);
    const other = { extra: {} };
    const read = await pool.connect();
    try {
      await read.query('begin');
      await read.query('set local role authenticated');
      await read.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: SECOND, role: 'authenticated', aud: 'authenticated', aal: 'aal1', ...other.extra })]);
      expect((await read.query('select title from public.research_collections')).rows).toEqual([{ title: 'Who funds the cult?' }]);
      expect((await read.query('select excerpt from public.research_sources')).rows).toHaveLength(1);
      expect((await read.query('select title from public.research_notes')).rows).toHaveLength(1);
      expect((await read.query(`update public.research_notes set body = 'mine'`)).rowCount).toBe(0);
      expect((await read.query(`update public.research_collections set title = 'mine'`)).rowCount).toBe(0);
      await read.query('rollback');
    } finally {
      read.release();
    }
    expect((await as('dm', 'select title from public.research_collections')).rows).toHaveLength(1);
    const dmCollection = await as('dm', `insert into public.research_collections (title, shared) values ('DM private', true)`);
    expect(dmCollection.error?.message).toMatch(/stays private/);
  });

  it('ownership cannot be moved and summaries carry a version', async () => {
    expect((await as('player', 'update public.research_collections set user_id = $1', [SECOND])).error?.code).toBe('42501');
    const r = await as<{ version: number }>('player', `update public.research_notes set body = 'revised' returning version`);
    expect(r.rows[0]!.version).toBe(2);
  });
});
