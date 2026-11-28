// mentions(): where a page is named in plain text. It must only ever look at text the caller may
// read, through their own row-level security, and must never reveal a hidden page or alias.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, as, columns, pool, resetFixtures } from './helpers.ts';

const BOB = 'b1000000-0000-4000-8000-000000000001'; // published party member
const SESSION = 'b1000000-0000-4000-8000-000000000002'; // published session naming Bob in text
const SECRETPAGE = 'b1000000-0000-4000-8000-000000000003'; // published page, Bob named only in a DM-only section
const DRAFT = 'b1000000-0000-4000-8000-000000000004'; // draft page naming Bob
const HIDDEN = 'b1000000-0000-4000-8000-000000000005'; // DM-only character named in public text
const ALIASED = 'b1000000-0000-4000-8000-000000000006'; // item with a DM-only alias and a public alias
const NOISE = 'b1000000-0000-4000-8000-000000000007'; // words that must NOT match
const MARA = 'b1000000-0000-4000-8000-000000000008'; // "Mara Venn", named as "Mara"

beforeAll(async () => {
  await resetFixtures();
  await admin(`insert into public.articles (id, slug, type, title, summary, visibility, status) values
    ($1, 'bob-test', 'character', 'Bob', 'A mushroom knight.', 'players', 'published'),
    ($2, 'quarry-night', 'session', 'Quarry Night', 'Bob chose the brass egg while Mara watched the ridge.', 'players', 'published'),
    ($3, 'war-council', 'event', 'War Council', 'A meeting.', 'players', 'published'),
    ($4, 'unwritten', 'session', 'Unwritten Session', 'Bob does something next week.', 'players', 'draft'),
    ($5, 'hidden-villain', 'character', 'Varkis Duskmantle', 'HIDDENVILLAINWORD', 'dm', 'published'),
    ($6, 'far-speaker', 'item', 'Far Speaker', 'A device.', 'players', 'published'),
    ($7, 'noise', 'lore', 'Noise Page', 'bob bobbed. Bobby and Bobcat. frost on the window.', 'players', 'published'),
    ($8, 'mara-test', 'character', 'Mara Venn', 'An intelligence contact.', 'players', 'published')`,
    [BOB, SESSION, SECRETPAGE, DRAFT, HIDDEN, ALIASED, NOISE, MARA]);
  await admin(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values
    ($1, 1, 'Out', 'The party saw Varkis Duskmantle from the ridge, and later used the Fargab.', 'players', 'published'),
    ($2, 1, 'Seen by all', 'The council met.', 'players', 'published'),
    ($2, 2, 'DM only', 'Bob will betray them. Whisperline is listening.', 'dm', 'published'),
    ($3, 1, 'Not yet', 'Bob again.', 'players', 'published')`, [SESSION, SECRETPAGE, DRAFT]);
  await admin(`insert into public.redirects (from_slug, article_id, visibility) values
    ('fargab', $1, 'players'), ('whisperline', $1, 'dm')`, [ALIASED]);
});
afterAll(() => pool.end());

const mentionsOf = async (who: 'player' | 'dm', id: string) => {
  const r = await as<{ slug: string }>(who, 'select slug from public.mentions($1)', [id]);
  expect(r.error).toBeUndefined();
  return columns(r.rows, 'slug');
};

describe('mentions()', () => {
  it('finds a plain-text mention in a published page the player can read', async () => {
    expect(await mentionsOf('player', BOB)).toEqual(['quarry-night']);
  });
  it('never uses a DM-only section or a draft page for a player, but the DM sees them', async () => {
    const player = await mentionsOf('player', BOB);
    expect(player).not.toContain('war-council');
    expect(player).not.toContain('unwritten');
    const dm = await mentionsOf('dm', BOB);
    expect(dm).toEqual(expect.arrayContaining(['quarry-night', 'war-council', 'unwritten']));
  });
  it('matches whole, case-sensitive words only', async () => {
    expect(await mentionsOf('player', BOB)).not.toContain('noise'); // bob, bobbed, Bobby, Bobcat
  });
  it('matches a character by a name part ("Mara" for Mara Venn)', async () => {
    expect(await mentionsOf('player', MARA)).toEqual(['quarry-night']);
  });
  it('reveals nothing about a page the player cannot read, even when public text names it', async () => {
    expect(await mentionsOf('player', HIDDEN)).toEqual([]);
    expect(await mentionsOf('dm', HIDDEN)).toEqual(['quarry-night']);
  });
  it('uses only aliases the caller may read', async () => {
    // Public alias "Fargab" is named in public text: found.
    expect(await mentionsOf('player', ALIASED)).toEqual(['quarry-night']);
    // DM-only alias "Whisperline" appears only in a DM-only section; the DM finds it, the player cannot.
    expect(await mentionsOf('dm', ALIASED)).toEqual(expect.arrayContaining(['quarry-night', 'war-council']));
  });
  it('never returns the page itself, and returns nothing for an unknown page', async () => {
    expect(await mentionsOf('dm', SESSION)).not.toContain('quarry-night');
    expect(await mentionsOf('player', '00000000-0000-4000-8000-00000000abcd')).toEqual([]);
  });
  it('is refused to visitors who are not signed in', async () => {
    const r = await as('anon', 'select * from public.mentions($1)', [BOB]);
    expect(r.error?.message).toMatch(/permission denied/);
  });
});

const namedIn = async (who: 'player' | 'dm', id: string) => {
  const r = await as<{ slug: string }>(who, 'select slug from public.named_in($1)', [id]);
  expect(r.error).toBeUndefined();
  return columns(r.rows, 'slug');
};

describe('named_in()', () => {
  it('lists the pages a session names in its visible text, never a hidden page', async () => {
    const player = await namedIn('player', SESSION);
    expect(player.sort()).toEqual(['bob-test', 'far-speaker', 'mara-test']);
    expect(player).not.toContain('hidden-villain'); // named in public text, but the page is DM-only
    expect(await namedIn('dm', SESSION)).toContain('hidden-villain');
  });
  it('does not read a DM-only section or a DM-only alias for a player', async () => {
    // War Council names Bob and "Whisperline" (a DM-only alias of Far Speaker) only in a DM-only section.
    expect(await namedIn('player', SECRETPAGE)).toEqual([]);
    expect((await namedIn('dm', SECRETPAGE)).sort()).toEqual(['bob-test', 'far-speaker']);
  });
  it('returns nothing for a page the player cannot read', async () => {
    expect(await namedIn('player', DRAFT)).toEqual([]);
  });
  it('is refused to visitors who are not signed in', async () => {
    const r = await as('anon', 'select * from public.named_in($1)', [SESSION]);
    expect(r.error?.message).toMatch(/permission denied/);
  });
});
