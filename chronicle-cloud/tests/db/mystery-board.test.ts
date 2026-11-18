// Mystery Studio (20261117000200) and the Investigation Board (20261117000300).
// Synthetic fixtures only. The main question everywhere: can anything unreleased or hidden reach a
// player, directly or through another table?
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, ids, pool, resetFixtures } from './helpers.ts';

const VISIBLE = 'a0000000-0000-4000-8000-00000000000a';
const SECRET = 'a0000000-0000-4000-8000-00000000000b';
const M_OPEN = 'c0000000-0000-4000-8000-0000000000a1';
const M_DRAFT = 'c0000000-0000-4000-8000-0000000000a2';
const C = {
  released: 'c1000000-0000-4000-8000-000000000001',
  scheduledPast: 'c1000000-0000-4000-8000-000000000002',
  scheduledFuture: 'c1000000-0000-4000-8000-000000000003',
  unreleased: 'c1000000-0000-4000-8000-000000000004',
  onSecretPage: 'c1000000-0000-4000-8000-000000000005',
  needsPrereq: 'c1000000-0000-4000-8000-000000000006',
  draftMystery: 'c1000000-0000-4000-8000-000000000007',
};
const oauth = { extra: { client_id: 'assistant' } };

async function clean() {
  await admin('delete from public.board_links');
  await admin('delete from public.board_items');
  await admin('delete from public.board_groups');
  await admin('delete from public.board_activity');
  await admin('delete from public.mysteries');
}

beforeEach(async () => {
  await resetFixtures();
  await clean();
  await admin(`insert into public.mysteries (id, title, player_title, dm_notes, status) values
    ($1, 'The Blue Wing supply plot', 'Strange shipments', 'SECRETPLOT: the Dragon Army moves steel', 'active'),
    ($2, 'Future arc', 'Not yet', 'DRAFTNOTE', 'draft')`, [M_OPEN, M_DRAFT]);
  await admin(`insert into public.clues (id, mystery_id, title, body, attach_article_id, release_at, released_at, requires_clue_id) values
    ($1, $8, 'Torn letter', 'RELEASEDBODY', $9, null, now(), null),
    ($2, $8, 'Notice on the door', 'PASTBODY', null, now() - interval '1 hour', null, null),
    ($3, $8, 'Sealed orders', 'FUTUREBODY', null, now() + interval '1 day', null, null),
    ($4, $8, 'Unsent letter', 'UNRELEASEDBODY', null, null, null, null),
    ($5, $8, 'Ledger page', 'SECRETPAGEBODY', $10, null, now(), null),
    ($6, $8, 'Second half of the letter', 'PREREQBODY', null, null, now(), $1),
    ($7, $11, 'Draft clue', 'DRAFTBODY', null, null, now(), null)`,
    [C.released, C.scheduledPast, C.scheduledFuture, C.unreleased, C.onSecretPage, C.needsPrereq, C.draftMystery, M_OPEN, VISIBLE, SECRET, M_DRAFT]);
  await admin(`insert into public.clue_hints (clue_id, body, released_at) values ($1, 'HINTOUT', now()), ($1, 'HINTLATER', null), ($2, 'HINTONHIDDEN', now())`, [C.released, C.unreleased]);
});
afterAll(async () => {
  await clean();
  await pool.end();
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

describe('Mystery Studio', () => {
  it('a player sees exactly the released, scheduled-past clues on pages they can read', async () => {
    const r = await as<{ title: string }>('player', 'select title from public.clues');
    expect(titles(r.rows)).toEqual(['Notice on the door', 'Torn letter']);
    const bodies = await as<{ b: string }>('player', `select string_agg(body, ' ') as b from public.clues`);
    for (const word of ['FUTUREBODY', 'UNRELEASEDBODY', 'SECRETPAGEBODY', 'PREREQBODY', 'DRAFTBODY']) expect(bodies.rows[0]!.b).not.toContain(word);
    expect((await as('dm', 'select id from public.clues')).rows).toHaveLength(7);
  });

  it('a scheduled clue appears on its own once its time passes; a manual release works at once', async () => {
    await admin(`update public.clues set release_at = now() - interval '1 second' where id = $1`, [C.scheduledFuture]);
    await admin(`update public.clues set released_at = now() where id = $1`, [C.unreleased]);
    expect(titles((await as<{ title: string }>('player', 'select title from public.clues')).rows)).toContain('Sealed orders');
    expect(titles((await as<{ title: string }>('player', 'select title from public.clues')).rows)).toContain('Unsent letter');
  });

  it('a prerequisite clue must be discovered first, and only visible clues can be discovered', async () => {
    expect((await as('player', 'insert into public.clue_discoveries (clue_id) values ($1)', [C.unreleased])).error?.code).toBe('42501');
    expect((await as('player', 'insert into public.clue_discoveries (clue_id) values ($1)', [C.needsPrereq])).error?.code).toBe('42501');
    await admin('insert into public.clue_discoveries (clue_id, user_id) values ($1, $2)', [C.released, ids.player]);
    expect(titles((await as<{ title: string }>('player', 'select title from public.clues')).rows)).toContain('Second half of the letter');
    // Someone else's discovery unlocks nothing for this player, and is not visible to them.
    await admin('delete from public.clue_discoveries');
    await admin('insert into public.clue_discoveries (clue_id, user_id) values ($1, $2)', [C.released, ids.dmMfa]);
    expect(titles((await as<{ title: string }>('player', 'select title from public.clues')).rows)).not.toContain('Second half of the letter');
    expect((await as('player', 'select * from public.clue_discoveries')).rows).toEqual([]);
  });

  it('mysteries, DM notes and hints stay hidden; the player index shows only the spoiler-safe name', async () => {
    expect((await as('player', 'select * from public.mysteries')).rows).toEqual([]);
    const index = await as<{ title: string; clues: string }>('player', 'select title, clues from public.mystery_index()');
    expect(index.rows).toEqual([{ title: 'Strange shipments', clues: '2' }]);
    expect(JSON.stringify(index.rows)).not.toMatch(/Blue Wing|SECRETPLOT|Not yet/);
    const hints = await as<{ body: string }>('player', 'select body from public.clue_hints');
    expect(hints.rows.map((h) => h.body)).toEqual(['HINTOUT']);
  });

  it('removed members, outsiders, anonymous visitors and assistants get nothing and can change nothing', async () => {
    for (const who of ['revoked', 'outsider', 'anon'] as const) {
      expect((await as(who, 'select id from public.clues')).rows).toEqual([]);
      expect((await as(who, 'select * from public.mystery_index()')).rows ?? []).toEqual([]);
    }
    expect((await as('dm', 'select id from public.clues', [], oauth)).rows).toEqual([]);
    expect((await as('dm', 'select id from public.mysteries', [], oauth)).rows).toEqual([]);
    expect((await as('player', `update public.clues set released_at = now() where id = $1`, [C.unreleased])).rowCount).toBe(0);
    expect((await as('player', `insert into public.mysteries (title) values ('x')`)).error?.code).toBe('42501');
  });

  it('the DM previews what one player can see, with the same rules', async () => {
    const r = await as<{ title: string }>('dm', 'select title from public.dm_preview_clues($1)', [ids.player]);
    expect(titles(r.rows)).toEqual(['Notice on the door', 'Torn letter']);
    expect((await as('player', 'select * from public.dm_preview_clues($1)', [ids.player])).error?.code).toBe('42501');
  });
});

describe('Investigation Board', () => {
  const pin = (who: 'player' | 'dm', type: string, id: string) =>
    as<{ id: string }>(who, `insert into public.board_items (kind, ref_type, ref_id) values ('pin', $1, $2) returning id`, [type, id]);

  it('members pin only what they can see; the DM pins only what players can see', async () => {
    expect((await pin('player', 'article', VISIBLE)).error).toBeUndefined();
    expect((await pin('player', 'article', SECRET)).error?.code).toBe('42501');
    expect((await pin('player', 'clue', C.released)).error).toBeUndefined();
    expect((await pin('player', 'clue', C.unreleased)).error?.code).toBe('42501');
    expect((await pin('dm', 'article', SECRET)).error?.code).toBe('42501');
    expect((await pin('dm', 'clue', C.unreleased)).error?.code).toBe('42501');
    expect((await pin('dm', 'article', VISIBLE)).error).toBeUndefined();
  });

  it('authorship, collaboration, versions and activity behave as designed', async () => {
    // Written by the DM (an admin insert has no signed-in author, like a card whose author left).
    const created = await admin<{ id: string; version: number }>(
      `insert into public.board_items (kind, title, theory_status) values ('theory', 'The steel goes north', 'unresolved') returning id, version`);
    const id = created.rows[0]!.id;
    // A player who is not the author may move it and set its status, not rewrite it.
    expect((await as('player', 'update public.board_items set x = 10, y = 20 where id = $1 and version = $2', [id, created.rows[0]!.version])).rowCount).toBe(1);
    expect((await as('player', `update public.board_items set theory_status = 'disproven' where id = $1`, [id])).rowCount).toBe(1);
    expect((await as('player', `update public.board_items set title = 'Mine now' where id = $1`, [id])).error?.code).toBe('42501');
    expect((await as('player', `update public.board_items set created_by = $2 where id = $1`, [id, ids.player])).error?.code).toBe('42501');
    expect((await as('player', 'delete from public.board_items where id = $1', [id])).rowCount).toBe(0);
    // A stale version changes nothing.
    expect((await as('player', 'update public.board_items set x = 99 where id = $1 and version = 0', [id])).rowCount).toBe(0);
  });

  it('a player\'s own cards: authored, versioned, logged without pinned titles', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.player, role: 'authenticated', aud: 'authenticated', aal: 'aal1' })]);
      const p = await client.query<{ id: string; author_name: string; is_dm: boolean }>(
        `insert into public.board_items (kind, ref_type, ref_id, created_by, is_dm) values ('pin', 'article', $1, $2, true) returning id, author_name, is_dm`, [VISIBLE, ids.dm]);
      expect(p.rows[0]).toMatchObject({ author_name: 'Test Player', is_dm: false });
      const n = await client.query<{ id: string; version: number }>(`insert into public.board_items (kind, title) values ('note', 'Who paid the smith?') returning id, version`);
      const moved = await client.query<{ version: number }>('update public.board_items set x = 5 where id = $1 and version = $2 returning version', [n.rows[0]!.id, n.rows[0]!.version]);
      expect(moved.rows[0]!.version).toBe(2);
      await client.query(`insert into public.board_links (from_item, to_item, label) values ($1, $2, 'paid by?')`, [p.rows[0]!.id, n.rows[0]!.id]);
      const log = await client.query<{ action: string; detail: string }>('select action, detail from public.board_activity order by id');
      expect(log.rows).toEqual([
        { action: 'added', detail: '' },
        { action: 'added', detail: 'Who paid the smith?' },
        { action: 'linked', detail: 'paid by?' },
      ]);
      expect((await client.query('select count(*)::int as n from public.board_items')).rows[0]!.n).toBe(2);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('removed members, outsiders, anonymous visitors and assistants cannot read or write the board', async () => {
    await admin(`insert into public.board_items (kind, title) values ('note', 'PARTYNOTE')`);
    for (const who of ['revoked', 'outsider', 'anon'] as const) {
      expect((await as(who, 'select * from public.board_items')).rows).toEqual([]);
      expect((await as(who, 'select * from public.board_activity')).rows).toEqual([]);
    }
    expect((await as('player', 'select * from public.board_items', [], oauth)).rows).toEqual([]);
    expect((await as('player', `insert into public.board_items (kind, title) values ('note', 'x')`, [], oauth)).error?.code).toBe('42501');
    expect((await as('player', `insert into public.board_activity (action, item_kind) values ('added', 'note')`)).error?.code).toBe('42501');
    expect((await as('player', 'select title from public.board_items')).rows).toEqual([{ title: 'PARTYNOTE' }]);
  });
});
