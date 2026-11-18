// Feedback Center (20261117000400): named and anonymous submissions, DM-only reading, and that an
// anonymous row carries nothing that identifies its author.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, ids, pool, resetFixtures } from './helpers.ts';

const oauth = { extra: { client_id: 'assistant' } };

/** Run as a signed-in user and COMMIT (as() always rolls back). */
async function committed(who: keyof typeof ids, sql: string, params: unknown[] = []) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ids[who], role: 'authenticated', aud: 'authenticated', aal: 'aal1' }),
    ]);
    const r = await client.query(sql, params);
    await client.query('commit');
    return r;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

beforeEach(async () => {
  await resetFixtures();
  await admin('delete from public.feedback');
  await admin('delete from private.feedback_quota');
  await admin('delete from private.feedback_salt');
});
afterAll(async () => {
  await admin('delete from public.feedback');
  await pool.end();
});

describe('Feedback Center', () => {
  it('named feedback is signed by the caller, whatever they send, and only they and the DM can read it', async () => {
    await committed('player', `insert into public.feedback (category, body, mode) values ('feature', 'More maps please', 'named')`);
    const row = await admin('select author_id, author_name, status, mode from public.feedback');
    expect(row.rows).toEqual([{ author_id: ids.player, author_name: 'Test Player', status: 'new', mode: 'named' }]);
    // Forging another author or a status is impossible (column grants and the trigger).
    expect((await as('player', `insert into public.feedback (category, body, mode, author_id) values ('bug', 'x', 'named', $1)`, [ids.dm])).error?.code).toBe('42501');
    expect((await as<{ body: string }>('player', 'select body from public.feedback')).rows).toEqual([{ body: 'More maps please' }]);
    expect((await as('dmMfa', 'select body from public.feedback', [], { aal: 'aal2' })).rows).toHaveLength(1);
    for (const who of ['revoked', 'outsider', 'anon'] as const) expect((await as(who, 'select * from public.feedback')).rows).toEqual([]);
    expect((await as('dm', 'select * from public.feedback', [], oauth)).rows).toEqual([]);
  });

  it('anonymous feedback stores no user, no name and no time of day, and nobody but the DM can read it', async () => {
    await committed('player', `select public.submit_anonymous_feedback('comfort', 'The spider scene was too much for me')`);
    const cols = await admin(`select * from public.feedback`);
    expect(cols.rows).toHaveLength(1);
    const r = cols.rows[0] as Record<string, unknown>;
    expect(r.author_id).toBeNull();
    expect(r.author_name).toBeNull();
    expect(r.mode).toBe('anonymous');
    expect(Object.keys(r)).not.toContain('created_at');
    expect(JSON.stringify(r)).not.toContain(ids.player);
    expect((await as('player', 'select * from public.feedback')).rows).toEqual([]);
    expect((await as('dm', 'select category from public.feedback')).rows).toEqual([{ category: 'comfort' }]);
    // The quota key is a keyed hash, not the user id.
    const quota = await admin<{ key: string }>('select key from private.feedback_quota');
    expect(quota.rows[0]!.key).not.toContain(ids.player);
  });

  it('anonymous feedback cannot be faked through a direct insert, answered, or sent by non-members or assistants', async () => {
    expect((await as('player', `insert into public.feedback (category, body, mode) values ('other', 'x', 'anonymous')`)).error?.code).toBe('42501');
    await committed('player', `select public.submit_anonymous_feedback('other', 'hello')`);
    expect((await as('dm', `update public.feedback set reply = 'thanks'`)).error?.message).toMatch(/cannot be answered/);
    for (const who of ['revoked', 'outsider'] as const) {
      expect((await as(who, `select public.submit_anonymous_feedback('other', 'x')`)).error?.code).toBe('42501');
    }
    expect((await as('anon', `select public.submit_anonymous_feedback('other', 'x')`)).error?.code).toBe('42501');
    expect((await as('player', `select public.submit_anonymous_feedback('other', 'x')`, [], oauth)).error?.code).toBe('42501');
  });

  it('limits anonymous feedback to five a day per person, and forgets yesterday', async () => {
    for (let i = 0; i < 5; i++) await committed('player', `select public.submit_anonymous_feedback('other', $1)`, [`note ${i}`]);
    await expect(committed('player', `select public.submit_anonymous_feedback('other', 'six')`)).rejects.toThrow(/a lot of anonymous feedback/);
    await admin(`update private.feedback_quota set day = current_date - 1`);
    await admin(`update private.feedback_salt set day = current_date - 1`);
    await committed('player', `select public.submit_anonymous_feedback('other', 'next day')`);
    expect((await admin(`select count(*)::int as n from private.feedback_salt`)).rows[0]!.n).toBe(1);
    expect((await admin(`select count(*)::int as n from private.feedback_quota where day < current_date`)).rows[0]!.n).toBe(0);
  });

  it('the DM triages and replies to named feedback; players cannot change it', async () => {
    await committed('player', `insert into public.feedback (category, body, mode) values ('bug', 'The map will not zoom', 'named')`);
    expect((await as('player', `update public.feedback set status = 'done'`)).rowCount).toBe(0);
    const r = await as<{ replied_at: string | null }>('dm', `update public.feedback set status = 'done', priority = 'high', reply = 'Fixed, thank you' returning replied_at`);
    expect(r.rows[0]!.replied_at).not.toBeNull();
  });
});
