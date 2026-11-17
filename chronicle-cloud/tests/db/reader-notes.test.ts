// Reader notes (20261117000100): reading lists, bookmarks, the private scratchpad and character
// journals. Lists, bookmarks and scratchpad are owner-only (not even the DM reads them); journal
// entries are readable by the DM but writable only by their owner. Synthetic fixtures only.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, ids, pool, resetFixtures, type ClaimsOverride, type Who } from './helpers.ts';

const OAUTH: ClaimsOverride = { extra: { client_id: 'synthetic-mcp-client' } };
const VISIBLE = 'a0000000-0000-4000-8000-00000000000a';
const VISIBLE2 = 'a0000000-0000-4000-8000-00000000000d';
const HIDDEN = 'a0000000-0000-4000-8000-00000000000b';
const MISSING = 'a0000000-0000-4000-8000-0000000000ff';
// The fixture user that is not yet a member becomes the "other player" in these tests.
const other = 'newDevice' as const;
const outsiders: Who[] = ['revoked', 'outsider'];

beforeEach(async () => {
  await resetFixtures();
  await admin(`delete from public.reading_lists`);
  await admin(`delete from public.scratchpad_notes`);
  await admin(`delete from public.journal_entries`);
  await admin(`insert into public.campaign_members (user_id, role, display_name) values ($1, 'player', 'Second Player') on conflict (user_id) do update set revoked_at = null, role = 'player'`, [ids[other]]);
});
afterAll(async () => {
  await admin(`delete from public.campaign_members where user_id = $1`, [ids[other]]);
  await pool.end();
});

const list = async (who: Exclude<Who, 'anon'>, name = 'Zz Suspects') =>
  (await admin<{ id: string }>(`insert into public.reading_lists (user_id, name) values ($1, $2) returning id`, [ids[who], name])).rows[0]!.id;
const mark = async (who: Exclude<Who, 'anon'>, article = VISIBLE, listId: string | null = null) =>
  (await admin<{ id: string }>(`insert into public.bookmarks (user_id, article_id, list_id) values ($1, $2, $3) returning id`, [ids[who], article, listId])).rows[0]!.id;
const note = async (who: Exclude<Who, 'anon'>, article: string | null = VISIBLE, body = 'Zz scratch') =>
  (await admin<{ id: string }>(`insert into public.scratchpad_notes (user_id, article_id, body) values ($1, $2, $3) returning id`, [ids[who], article, body])).rows[0]!.id;
const entry = async (who: Exclude<Who, 'anon'>, title = 'Zz Entry', body = 'ZZBODY words') =>
  (await admin<{ id: string }>(`insert into public.journal_entries (user_id, title, body) values ($1, $2, $3) returning id`, [ids[who], title, body])).rows[0]!.id;
const bulkArticles = (n: number) =>
  admin(`insert into public.articles (slug, type, title, visibility, status) select 'zz-bulk-' || g, 'lore', 'Bulk ' || g, 'players', 'published' from generate_series(1, ${n}) g`);

describe('reading lists', () => {
  it('the owner can create, rename, reorder and delete a list; the name is trimmed', async () => {
    const created = await as('player', `insert into public.reading_lists (name, position) values ('  Zz Suspects  ', 2) returning name, user_id`);
    expect(created.error).toBeUndefined();
    expect(created.rows[0]).toEqual({ name: 'Zz Suspects', user_id: ids.player });
    const id = await list('player');
    expect((await as('player', `update public.reading_lists set name = 'Zz Allies', position = 3 where id = $1 returning name`, [id])).rows[0]!.name).toBe('Zz Allies');
    expect((await as('player', `delete from public.reading_lists where id = $1`, [id])).rowCount).toBe(1);
  });

  it('user_id is forced to the caller, and cannot be changed', async () => {
    const r = await as('player', `insert into public.reading_lists (user_id, name) values ($1, 'Zz Forced') returning user_id`, [ids.dm]);
    expect(r.rows[0]!.user_id).toBe(ids.player);
    const id = await list('player');
    expect((await as('player', `update public.reading_lists set user_id = $2 where id = $1`, [id, ids.dm])).error?.code).toBe('42501');
  });

  it('names must be 1 to 60 characters and unique per person ignoring case', async () => {
    await list('player', 'Zz Suspects');
    expect((await as('player', `insert into public.reading_lists (name) values ('ZZ SUSPECTS')`)).error?.code).toBe('23505');
    expect((await as(other, `insert into public.reading_lists (name) values ('ZZ SUSPECTS')`)).error).toBeUndefined();
    expect((await as('player', `insert into public.reading_lists (name) values ('   ')`)).error?.code).toBe('23514');
    expect((await as('player', `insert into public.reading_lists (name) values (repeat('x', 61))`)).error?.code).toBe('23514');
  });

  it('nobody else sees or changes it: another player, the DM, revoked, outsider, anon, assistants', async () => {
    const id = await list('player');
    for (const who of ['dm', other, ...outsiders] as Who[]) {
      expect((await as(who, `select * from public.reading_lists`)).rowCount, who).toBe(0);
      expect((await as(who, `update public.reading_lists set name = 'Zz Taken' where id = $1`, [id])).rowCount, who).toBe(0);
      expect((await as(who, `delete from public.reading_lists where id = $1`, [id])).rowCount, who).toBe(0);
    }
    for (const who of outsiders) expect((await as(who, `insert into public.reading_lists (name) values ('Zz In')`)).error?.code, who).toBe('42501');
    expect((await as('anon', `select * from public.reading_lists`)).error?.code).toBe('42501');
    expect((await as('player', `select * from public.reading_lists`, [], OAUTH)).rowCount).toBe(0);
    expect((await as('player', `insert into public.reading_lists (name) values ('Zz Bot')`, [], OAUTH)).error?.code).toBe('42501');
    expect((await as('player', `delete from public.reading_lists where id = $1`, [id], OAUTH)).rowCount).toBe(0);
  });

  it('keeps at most 50 per person', async () => {
    await admin(`insert into public.reading_lists (user_id, name) select $1, 'List ' || g from generate_series(1, 50) g`, [ids.player]);
    const r = await as('player', `insert into public.reading_lists (name) values ('One too many')`);
    expect(r.error?.message).toBe('VALIDATION_FAILED');
    expect((await as(other, `insert into public.reading_lists (name) values ('Fine')`)).error).toBeUndefined();
  });
});

describe('bookmarks', () => {
  it('the owner can save, move between lists, reorder, and remove a page', async () => {
    const created = await as('player', `insert into public.bookmarks (article_id) values ($1) returning user_id, list_id, position`, [VISIBLE]);
    expect(created.error).toBeUndefined();
    expect(created.rows[0]).toEqual({ user_id: ids.player, list_id: null, position: 0 });
    const l = await list('player');
    const id = await mark('player', VISIBLE);
    expect((await as('player', `update public.bookmarks set list_id = $2, position = 4 where id = $1 returning list_id, position`, [id, l])).rows[0]).toEqual({ list_id: l, position: 4 });
    expect((await as('player', `delete from public.bookmarks where id = $1`, [id])).rowCount).toBe(1);
  });

  it('a page can be saved once unsorted and once per list, never twice in the same place', async () => {
    const l = await list('player');
    await mark('player', VISIBLE);
    expect((await as('player', `insert into public.bookmarks (article_id) values ($1)`, [VISIBLE])).error?.code).toBe('23505');
    expect((await as('player', `insert into public.bookmarks (article_id, list_id) values ($1, $2)`, [VISIBLE, l])).error).toBeUndefined();
    await mark('player', VISIBLE, l);
    expect((await as('player', `insert into public.bookmarks (article_id, list_id) values ($1, $2)`, [VISIBLE, l])).error?.code).toBe('23505');
  });

  it('refuses a page the caller cannot read (hidden, draft, missing) and stores no title or address', async () => {
    for (const article of [HIDDEN, 'a0000000-0000-4000-8000-00000000000c', MISSING]) {
      expect((await as('player', `insert into public.bookmarks (article_id) values ($1)`, [article])).error?.code, article).toBe('42501');
    }
    // The DM can read everything, so the same page is allowed for them.
    expect((await as('dm', `insert into public.bookmarks (article_id) values ($1)`, [HIDDEN])).error).toBeUndefined();
    const cols = (await admin<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'bookmarks'`)).rows.map((r) => r.column_name).sort();
    expect(cols).toEqual(['article_id', 'created_at', 'id', 'list_id', 'position', 'user_id']);
  });

  it('refuses moving a saved page onto a page that has since become hidden', async () => {
    const l = await list('player');
    const id = await mark('player', VISIBLE);
    await admin(`update public.articles set visibility = 'dm' where id = $1`, [VISIBLE]);
    expect((await as('player', `update public.bookmarks set list_id = $2 where id = $1`, [id, l])).error?.code).toBe('42501');
    // They can still remove it, and the row reveals only the id they once could read.
    expect((await as('player', `delete from public.bookmarks where id = $1`, [id])).rowCount).toBe(1);
    expect((await as('player', `select a.title from public.bookmarks b join public.articles a on a.id = b.article_id`)).rowCount).toBe(0);
  });

  it("refuses another person's list, and moving onto it", async () => {
    const theirs = await list(other, 'Zz Theirs');
    expect((await as('player', `insert into public.bookmarks (article_id, list_id) values ($1, $2)`, [VISIBLE, theirs])).error?.code).toBe('42501');
    const id = await mark('player', VISIBLE);
    expect((await as('player', `update public.bookmarks set list_id = $2 where id = $1`, [id, theirs])).error?.code).toBe('42501');
    expect((await as('player', `insert into public.bookmarks (article_id, list_id) values ($1, $2)`, [VISIBLE, MISSING])).error?.code).toBe('42501');
  });

  it('user_id is forced and immutable', async () => {
    expect((await as('player', `insert into public.bookmarks (user_id, article_id) values ($1, $2) returning user_id`, [ids.dm, VISIBLE])).rows[0]!.user_id).toBe(ids.player);
    const id = await mark('player', VISIBLE2);
    expect((await as('player', `update public.bookmarks set user_id = $2 where id = $1`, [id, ids.dm])).error?.code).toBe('42501');
  });

  it('nobody else sees or changes them, not even the DM; assistants and outsiders get nothing', async () => {
    const id = await mark('player', VISIBLE);
    for (const who of ['dm', other, ...outsiders] as Who[]) {
      expect((await as(who, `select * from public.bookmarks`)).rowCount, who).toBe(0);
      expect((await as(who, `update public.bookmarks set position = 9 where id = $1`, [id])).rowCount, who).toBe(0);
      expect((await as(who, `delete from public.bookmarks where id = $1`, [id])).rowCount, who).toBe(0);
    }
    for (const who of outsiders) expect((await as(who, `insert into public.bookmarks (article_id) values ($1)`, [VISIBLE])).error?.code, who).toBe('42501');
    expect((await as('anon', `select * from public.bookmarks`)).error?.code).toBe('42501');
    expect((await as('player', `select * from public.bookmarks`, [], OAUTH)).rowCount).toBe(0);
    expect((await as('player', `insert into public.bookmarks (article_id) values ($1)`, [VISIBLE2], OAUTH)).error?.code).toBe('42501');
    expect((await as('player', `delete from public.bookmarks where id = $1`, [id], OAUTH)).rowCount).toBe(0);
  });

  it('reorder_bookmarks rewrites positions for the caller only, within one list', async () => {
    const a = await mark('player', VISIBLE);
    const b = await mark('player', VISIBLE2);
    const c = await mark('player', 'a0000000-0000-4000-8000-00000000000e');
    const l = await list('player');
    const inList = await mark('player', VISIBLE, l);
    const theirs = await mark(other, VISIBLE);
    // Several statements as the player in one transaction, so the new order can be read back.
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.player, role: 'authenticated', aud: 'authenticated', aal: 'aal1' })]);
      const n = await client.query(`select public.reorder_bookmarks(null, array[$1, $2, $3, $4, $5]::uuid[]) as n`, [c, a, b, inList, theirs]);
      expect(n.rows[0].n).toBe(3); // the list item and the other person's row are untouched
      const order = await client.query(`select id from public.bookmarks where list_id is null order by position`);
      expect(order.rows.map((r) => r.id)).toEqual([c, a, b]);
      expect((await client.query(`select position from public.bookmarks where id = $1`, [inList])).rows[0].position).toBe(0);
    } finally {
      await client.query('rollback');
      client.release();
    }
    expect((await admin(`select position from public.bookmarks where id = $1`, [theirs])).rows[0]!.position).toBe(0);
    expect((await as('dm', `select public.reorder_bookmarks(null, array[$1]::uuid[]) as n`, [a])).rows[0]!.n).toBe(0);
    expect((await as('player', `select public.reorder_bookmarks(null, array[$1]::uuid[]) as n`, [a], OAUTH)).rows[0]!.n).toBe(0);
    expect((await as('anon', `select public.reorder_bookmarks(null, array[$1]::uuid[])`, [a])).error?.code).toBe('42501');
  });

  it('keeps at most 1000 per person', async () => {
    await bulkArticles(1000);
    await admin(`insert into public.bookmarks (user_id, article_id) select $1, id from public.articles where slug like 'zz-bulk-%'`, [ids.player]);
    const r = await as('player', `insert into public.bookmarks (article_id) values ($1)`, [VISIBLE]);
    expect(r.error?.message).toBe('VALIDATION_FAILED');
    expect((await as(other, `insert into public.bookmarks (article_id) values ($1)`, [VISIBLE])).error).toBeUndefined();
  });

  it('are deleted with the page, or with the list, but the page survives the list', async () => {
    const l = await list('player');
    await mark('player', VISIBLE, l);
    await mark('player', VISIBLE2);
    await admin(`delete from public.reading_lists where id = $1`, [l]);
    expect((await admin(`select count(*)::int as n from public.bookmarks`)).rows[0]!.n).toBe(1);
    expect((await admin(`select count(*)::int as n from public.articles where id = $1`, [VISIBLE])).rows[0]!.n).toBe(1);
    await admin(`delete from public.articles where id = $1`, [VISIBLE2]);
    expect((await admin(`select count(*)::int as n from public.bookmarks`)).rows[0]!.n).toBe(0);
  });
});

describe('private scratchpad', () => {
  it('saves a note for a page and a general note; the first save has no expected version', async () => {
    const r = await as<{ version: number; user_id: string; article_id: string }>('player', `select * from public.save_scratchpad($1, 'Zz first', null)`, [VISIBLE]);
    expect(r.error).toBeUndefined();
    expect(r.rows[0]).toMatchObject({ version: 1, user_id: ids.player, article_id: VISIBLE });
    expect((await as<{ article_id: string | null }>('player', `select * from public.save_scratchpad(null, 'Zz general', null)`)).rows[0]!.article_id).toBeNull();
  });

  it('a save sends the version it loaded; a matching one bumps the version', async () => {
    await note('player', VISIBLE, 'Zz v1');
    const ok = await as<{ version: number; body: string }>('player', `select * from public.save_scratchpad($1, 'Zz v2', 1)`, [VISIBLE]);
    expect(ok.rows[0]).toMatchObject({ version: 2, body: 'Zz v2' });
    const general = await note('player', null, 'Zz general');
    expect(general).toBeTruthy();
    expect((await as('player', `select * from public.save_scratchpad(null, 'Zz general 2', 1)`)).error).toBeUndefined();
  });

  it('a stale version, or a note that appeared since the page loaded, is refused as CONFLICT and nothing changes', async () => {
    await note('player', VISIBLE, 'Zz newer');
    await admin(`update public.scratchpad_notes set version = 3 where user_id = $1`, [ids.player]);
    const stale = await as('player', `select * from public.save_scratchpad($1, 'Zz mine', 1)`, [VISIBLE]);
    expect(stale.error?.message).toBe('CONFLICT');
    expect(stale.error?.code).toBe('PT409');
    const firstSaveAgain = await as('player', `select * from public.save_scratchpad($1, 'Zz mine', null)`, [VISIBLE]);
    expect(firstSaveAgain.error?.message).toBe('CONFLICT');
    expect((await as('player', `select * from public.save_scratchpad($1, 'Zz mine', 2)`, [MISSING])).error).toBeDefined();
    expect((await admin<{ body: string }>(`select body from public.scratchpad_notes where user_id = $1`, [ids.player])).rows[0]!.body).toBe('Zz newer');
  });

  it('a plain UPDATE cannot rewrite the text past the version check', async () => {
    const id = await note('player', VISIBLE, 'Zz kept');
    const r = await as('player', `update public.scratchpad_notes set body = 'Zz overwritten' where id = $1`, [id]);
    expect(r.error?.message).toBe('CONFLICT');
    expect((await as('player', `update public.scratchpad_notes set version = 99 where id = $1`, [id])).error?.code).toBe('42501'); // no column privilege
  });

  it('refuses a hidden or missing page, and an empty or oversized note', async () => {
    for (const a of [HIDDEN, MISSING]) {
      expect((await as('player', `select * from public.save_scratchpad($1, 'Zz sneaky', null)`, [a])).error?.code, a).toBe('42501');
      expect((await as('player', `insert into public.scratchpad_notes (article_id, body) values ($1, 'Zz sneaky')`, [a])).error?.code, a).toBe('42501');
    }
    expect((await as('player', `select * from public.save_scratchpad($1, '', null)`, [VISIBLE])).error?.message).toBe('VALIDATION_FAILED');
    expect((await as('player', `select * from public.save_scratchpad($1, repeat('x', 5001), null)`, [VISIBLE])).error?.message).toBe('VALIDATION_FAILED');
    expect((await as('player', `select * from public.save_scratchpad($1, repeat('x', 5000), null)`, [VISIBLE])).error).toBeUndefined();
  });

  it('a page hidden after the note was written no longer accepts saves, but the note can be deleted', async () => {
    const id = await note('player', VISIBLE);
    await admin(`update public.articles set visibility = 'dm' where id = $1`, [VISIBLE]);
    expect((await as('player', `select * from public.save_scratchpad($1, 'Zz later', 1)`, [VISIBLE])).error).toBeDefined();
    expect((await as('player', `delete from public.scratchpad_notes where id = $1`, [id])).rowCount).toBe(1);
  });

  it('is visible to its owner only: not the DM, another player, revoked, outsider, anon or an assistant', async () => {
    const id = await note('player');
    expect((await as('player', `select * from public.scratchpad_notes`)).rowCount).toBe(1);
    for (const who of ['dm', 'dmMfa', other, ...outsiders] as Who[]) {
      expect((await as(who, `select * from public.scratchpad_notes`)).rowCount, who).toBe(0);
      expect((await as(who, `delete from public.scratchpad_notes where id = $1`, [id])).rowCount, who).toBe(0);
      expect((await as(who, `update public.scratchpad_notes set body = 'Zz x' where id = $1`, [id])).rowCount, who).toBe(0);
    }
    for (const who of outsiders) expect((await as(who, `select * from public.save_scratchpad($1, 'Zz x', null)`, [VISIBLE])).error?.code, who).toBe('42501');
    expect((await as('anon', `select * from public.scratchpad_notes`)).error?.code).toBe('42501');
    expect((await as('anon', `select * from public.save_scratchpad($1, 'Zz x', null)`, [VISIBLE])).error?.code).toBe('42501');
    expect((await as('player', `select * from public.scratchpad_notes`, [], OAUTH)).rowCount).toBe(0);
    expect((await as('player', `select * from public.save_scratchpad($1, 'Zz x', null)`, [VISIBLE], OAUTH)).error?.code).toBe('42501');
    // The DM has no policy at all on this table.
    const policies = await admin<{ policyname: string; roles: string[]; qual: string }>(`select policyname, roles, qual from pg_policies where tablename = 'scratchpad_notes'`);
    expect(policies.rows.length).toBeGreaterThan(0);
    expect(policies.rows.every((p) => !/is_dm/.test(p.qual ?? ''))).toBe(true);
  });

  it('keeps at most 2000 per person, and is deleted with the page', async () => {
    await bulkArticles(2000);
    await admin(`insert into public.scratchpad_notes (user_id, article_id, body) select $1, id, 'x' from public.articles where slug like 'zz-bulk-%'`, [ids.player]);
    expect((await as('player', `select * from public.save_scratchpad(null, 'one too many', null)`)).error?.message).toBe('VALIDATION_FAILED');
    expect((await as(other, `select * from public.save_scratchpad(null, 'fine', null)`)).error).toBeUndefined();
    await admin(`delete from public.articles where slug like 'zz-bulk-%'`);
    expect((await admin(`select count(*)::int as n from public.scratchpad_notes`)).rows[0]!.n).toBe(0);
  });
});

describe('character journals', () => {
  const save = `select * from public.save_journal_entry($1, $2, $3, $4, $5, $6, $7)`;

  it('the owner can create, edit, link pages and delete; the date and tags are kept', async () => {
    const created = await as<{ id: string; version: number; entry_date: Date; tags: string[]; user_id: string }>('player', save,
      [null, 'Zz Theory', 'It was the harbourmaster.', '2026-11-03', ['theory', 'suspicion'], [VISIBLE, VISIBLE2], null]);
    expect(created.error).toBeUndefined();
    expect(created.rows[0]).toMatchObject({ version: 1, tags: ['theory', 'suspicion'], user_id: ids.player });
    const id = await entry('player');
    await admin(`insert into public.journal_entry_links (entry_id, article_id) values ($1, $2), ($1, $3)`, [id, VISIBLE, VISIBLE2]);
    const edited = await as<{ version: number; title: string }>('player', save, [id, 'Zz Renamed', 'New text', null, ['note'], [VISIBLE], 1]);
    expect(edited.rows[0]).toMatchObject({ version: 2, title: 'Zz Renamed' });
    expect((await as('player', `delete from public.journal_entries where id = $1`, [id])).rowCount).toBe(1);
  });

  it('replaces links on save, and a stale save is refused rather than overwriting', async () => {
    const id = await entry('player');
    await admin(`insert into public.journal_entry_links (entry_id, article_id) values ($1, $2)`, [id, VISIBLE]);
    await admin(`update public.journal_entries set version = 5 where id = $1`, [id]);
    const stale = await as('player', save, [id, 'Zz Stale', 'x', null, [], [], 1]);
    expect(stale.error?.message).toBe('CONFLICT');
    expect(stale.error?.code).toBe('PT409');
    expect((await admin<{ title: string }>(`select title from public.journal_entries where id = $1`, [id])).rows[0]!.title).toBe('Zz Entry');
    expect((await admin(`select 1 from public.journal_entry_links where entry_id = $1`, [id])).rowCount).toBe(1);
    // A save from someone else's id never matches, even with the right version.
    expect((await as(other, save, [id, 'Zz Theirs', 'x', null, [], [], 5])).error?.message).toBe('CONFLICT');
  });

  it('a plain UPDATE of the text is refused; only the page flow saves', async () => {
    const id = await entry('player');
    expect((await as('player', `update public.journal_entries set body = 'Zz overwritten' where id = $1`, [id])).error?.message).toBe('CONFLICT');
    expect((await as('player', `update public.journal_entries set version = 9 where id = $1`, [id])).error?.code).toBe('42501');
  });

  it('refuses a bad title, tag or oversized body', async () => {
    for (const [title, body, tags] of [['  ', 'x', []], ['x'.repeat(121), 'x', []], ['ok', 'x'.repeat(20001), []], ['ok', 'x', ['gossip']]] as [string, string, string[]][]) {
      expect((await as('player', save, [null, title, body, null, tags, [], null])).error?.code).toBe('23514');
    }
    expect((await as('player', save, [null, 'ok', '', null, [], [], null])).error).toBeUndefined();
  });

  it('refuses linking a hidden or missing page, directly or through the save', async () => {
    const id = await entry('player');
    for (const a of [HIDDEN, MISSING]) {
      expect((await as('player', `insert into public.journal_entry_links (entry_id, article_id) values ($1, $2)`, [id, a])).error?.code, a).toBe('42501');
      expect((await as('player', save, [null, 'Zz Linking', 'x', null, [], [a], null])).error?.code, a).toBe('42501');
    }
  });

  it("refuses linking to someone else's entry", async () => {
    const theirs = await entry(other, 'Zz Theirs');
    expect((await as('player', `insert into public.journal_entry_links (entry_id, article_id) values ($1, $2)`, [theirs, VISIBLE])).error?.code).toBe('42501');
    expect((await as('dm', `insert into public.journal_entry_links (entry_id, article_id) values ($1, $2)`, [theirs, VISIBLE])).error?.code).toBe('42501');
  });

  it('an owner reading their link to a page hidden later gets only an id; the page itself no longer comes back', async () => {
    const id = await entry('player');
    await admin(`insert into public.journal_entry_links (entry_id, article_id) values ($1, $2)`, [id, VISIBLE]);
    await admin(`update public.articles set visibility = 'dm' where id = $1`, [VISIBLE]);
    expect((await as('player', `select article_id from public.journal_entry_links where entry_id = $1`, [id])).rows).toEqual([{ article_id: VISIBLE }]);
    expect((await as('player', `select title from public.articles where id = $1`, [VISIBLE])).rowCount).toBe(0);
  });

  it('the DM can read every entry and link, but cannot change or delete them', async () => {
    const id = await entry('player', 'Zz Player Entry', 'ZZSECRETTHEORY');
    await admin(`insert into public.journal_entry_links (entry_id, article_id) values ($1, $2)`, [id, VISIBLE]);
    for (const who of ['dm', 'dmMfa'] as const) {
      // dmMfa has a verified factor, so it needs an aal2 session to count as the DM.
      const claims: ClaimsOverride = who === 'dmMfa' ? { aal: 'aal2' } : {};
      expect((await as(who, `select body from public.journal_entries`, [], claims)).rows, who).toEqual([{ body: 'ZZSECRETTHEORY' }]);
      expect((await as(who, `select article_id from public.journal_entry_links`, [], claims)).rows, who).toEqual([{ article_id: VISIBLE }]);
    }
    expect((await as('dmMfa', `select * from public.journal_entries`)).rowCount).toBe(0); // aal1 with MFA enrolled: not the DM
    expect((await as('dm', `update public.journal_entries set title = 'Zz Edited' where id = $1`, [id])).rowCount).toBe(0);
    expect((await as('dm', `delete from public.journal_entries where id = $1`, [id])).rowCount).toBe(0);
    expect((await as('dm', `delete from public.journal_entry_links where entry_id = $1`, [id])).rowCount).toBe(0);
    expect((await as('dm', save, [id, 'Zz Edited', 'x', null, [], [], 1])).error?.message).toBe('CONFLICT');
    expect((await as('dm', save, [null, 'Zz Own', 'x', null, [], [], null])).rows[0]).toMatchObject({ user_id: ids.dm });
  });

  it('other players, revoked members, outsiders, anon and assistants get nothing', async () => {
    const id = await entry('player', 'Zz Mine', 'ZZMINE');
    await admin(`insert into public.journal_entry_links (entry_id, article_id) values ($1, $2)`, [id, VISIBLE]);
    for (const who of [other, ...outsiders] as Who[]) {
      expect((await as(who, `select * from public.journal_entries`)).rowCount, who).toBe(0);
      expect((await as(who, `select * from public.journal_entry_links`)).rowCount, who).toBe(0);
      expect((await as(who, `update public.journal_entries set title = 'Zz Taken' where id = $1`, [id])).rowCount, who).toBe(0);
      expect((await as(who, `delete from public.journal_entries where id = $1`, [id])).rowCount, who).toBe(0);
      expect((await as(who, `delete from public.journal_entry_links where entry_id = $1`, [id])).rowCount, who).toBe(0);
    }
    for (const who of outsiders) {
      expect((await as(who, save, [null, 'Zz In', 'x', null, [], [], null])).error?.code, who).toBe('42501');
      expect((await as(who, `insert into public.journal_entries (title) values ('Zz In')`)).error?.code, who).toBe('42501');
    }
    expect((await as('anon', `select * from public.journal_entries`)).error?.code).toBe('42501');
    expect((await as('anon', `select * from public.journal_entry_links`)).error?.code).toBe('42501');
    expect((await as('anon', save, [null, 'Zz In', 'x', null, [], [], null])).error?.code).toBe('42501');
    expect((await as('player', `select * from public.journal_entries`, [], OAUTH)).rowCount).toBe(0);
    expect((await as('dm', `select * from public.journal_entries`, [], OAUTH)).rowCount).toBe(0);
    expect((await as('dm', `select * from public.journal_entry_links`, [], OAUTH)).rowCount).toBe(0);
    expect((await as('player', save, [null, 'Zz Bot', 'x', null, [], [], null], OAUTH)).error?.code).toBe('42501');
    expect((await as('player', `insert into public.journal_entry_links (entry_id, article_id) values ($1, $2)`, [id, VISIBLE2], OAUTH)).error?.code).toBe('42501');
  });

  it('a revoked member loses access to their own entries too', async () => {
    await entry('revoked', 'Zz Old', 'x');
    expect((await as('revoked', `select * from public.journal_entries`)).rowCount).toBe(0);
  });

  it('keeps at most 2000 entries per person and 50 links per entry', async () => {
    await admin(`insert into public.journal_entries (user_id, title) select $1, 'E' || g from generate_series(1, 2000) g`, [ids.player]);
    expect((await as('player', save, [null, 'One too many', 'x', null, [], [], null])).error?.message).toBe('VALIDATION_FAILED');
    expect((await as(other, save, [null, 'Fine', 'x', null, [], [], null])).error).toBeUndefined();
    await bulkArticles(51);
    const id = await entry(other);
    const arts = (await admin<{ id: string }>(`select id from public.articles where slug like 'zz-bulk-%' order by slug`)).rows.map((r) => r.id);
    await admin(`insert into public.journal_entry_links (entry_id, article_id) select $1, unnest($2::uuid[])`, [id, arts.slice(0, 50)]);
    expect((await as(other, `insert into public.journal_entry_links (entry_id, article_id) values ($1, $2)`, [id, arts[50]])).error?.message).toBe('VALIDATION_FAILED');
    expect((await as(other, save, [id, 'x', 'x', null, [], arts, 1])).error?.message).toBe('VALIDATION_FAILED');
  });

  it('links go with the page or the entry; the page and entry survive the other', async () => {
    const id = await entry('player');
    await admin(`insert into public.journal_entry_links (entry_id, article_id) values ($1, $2), ($1, $3)`, [id, VISIBLE, VISIBLE2]);
    await admin(`delete from public.articles where id = $1`, [VISIBLE2]);
    expect((await admin(`select count(*)::int as n from public.journal_entry_links`)).rows[0]!.n).toBe(1);
    expect((await admin(`select count(*)::int as n from public.journal_entries`)).rows[0]!.n).toBe(1);
    await admin(`delete from public.journal_entries where id = $1`, [id]);
    expect((await admin(`select count(*)::int as n from public.journal_entry_links`)).rows[0]!.n).toBe(0);
    expect((await admin(`select count(*)::int as n from public.articles where id = $1`, [VISIBLE])).rows[0]!.n).toBe(1);
  });
});

describe('account removal', () => {
  it("deleting a user removes all of their lists, saved pages, notes and entries", async () => {
    const l = await list(other);
    await mark(other, VISIBLE, l);
    await note(other);
    const e = await entry(other);
    await admin(`insert into public.journal_entry_links (entry_id, article_id) values ($1, $2)`, [e, VISIBLE]);
    await admin(`delete from public.campaign_members where user_id = $1`, [ids[other]]);
    await admin(`delete from auth.users where id = $1`, [ids[other]]);
    for (const t of ['reading_lists', 'bookmarks', 'scratchpad_notes', 'journal_entries', 'journal_entry_links']) {
      expect((await admin(`select count(*)::int as n from public.${t}`)).rows[0]!.n, t).toBe(0);
    }
    // Restore the fixture user for later tests.
    await admin(`insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', 'newdevice@test.chronicle.invalid', now(), now())`, [ids[other]]);
  });
});
