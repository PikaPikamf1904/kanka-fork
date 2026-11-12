// Pictures inside article text: a file reaches players only while it sits in a published,
// player-visible section of a published, player-visible page. Synthetic files only.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, columns, pool, resetFixtures } from './helpers.ts';

const A = 'a0000000-0000-4000-8000-00000000000a'; // published, player-visible character
const C = 'a0000000-0000-4000-8000-00000000000c'; // player audience, but a draft
const FILE = 'media/inline-synthetic.webp';
const OTHER = 'media/inline-synthetic-2.webp';
const img = (path: string, caption = 'A caption') => `Before.\n\n![Synthetic picture](media:${path} "${caption}")\n\nAfter.`;

beforeEach(async () => {
  await resetFixtures();
  await admin(`insert into public.media (path, alt, visibility) values ($1, 'Synthetic picture', 'dm'), ($2, 'Second', 'dm')`, [FILE, OTHER]);
  await admin(`insert into storage.objects (bucket_id, name) values ('chronicle-media', $1), ('chronicle-media', $2)`, [FILE, OTHER]);
});
afterAll(() => pool.end());

async function playerFiles() {
  const rows = await as<{ path: string }>('player', 'select path from public.media where path like $1', ['media/inline-%']);
  const objects = await as<{ name: string }>('player', "select name from storage.objects where bucket_id = 'chronicle-media' and name like 'media/inline-%'");
  return { rows: columns(rows.rows, 'path').sort(), objects: columns(objects.rows, 'name').sort() };
}
const addSection = (article: string, body: string, visibility = 'players', status = 'published') =>
  admin(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 20, 'Pictures', $2, $3, $4) returning id`, [article, body, visibility, status]);

describe('pictures in article text', () => {
  it('a picture in a published player section of a published page reaches players, file and all', async () => {
    expect(await playerFiles()).toEqual({ rows: [], objects: [] });
    await addSection(A, img(FILE));
    expect(await playerFiles()).toEqual({ rows: [FILE], objects: [FILE] });
  });

  it('a picture in a DM-only section, a draft section or a draft page stays private', async () => {
    await addSection(A, img(FILE), 'dm', 'published');
    await addSection(A, img(OTHER), 'players', 'draft');
    await addSection(C, img(FILE));
    expect(await playerFiles()).toEqual({ rows: [], objects: [] });
  });

  it('hiding the page, the section, or removing the picture takes it away again', async () => {
    const s = (await addSection(A, img(FILE))).rows[0]!.id as string;
    expect((await playerFiles()).rows).toEqual([FILE]);
    await admin(`update public.articles set status = 'draft' where id = $1`, [A]);
    expect((await playerFiles()).rows).toEqual([]);
    await admin(`update public.articles set status = 'published' where id = $1`, [A]);
    expect((await playerFiles()).rows).toEqual([FILE]);
    await admin(`update public.article_sections set visibility = 'dm' where id = $1`, [s]);
    expect((await playerFiles()).rows).toEqual([]);
    await admin(`update public.article_sections set visibility = 'players', body = $2 where id = $1`, [s, 'No picture any more.']);
    expect((await playerFiles()).rows).toEqual([]);
    await admin(`update public.article_sections set body = $2 where id = $1`, [s, img(FILE)]);
    expect((await playerFiles()).rows).toEqual([FILE]);
    await admin('delete from public.article_sections where id = $1', [s]);
    expect((await playerFiles()).rows).toEqual([]);
  });

  it('resynchronizes a picture when its section moves between public and private articles', async () => {
    const section = (await addSection(A, img(FILE))).rows[0]!.id as string;
    expect(await playerFiles()).toEqual({ rows: [FILE], objects: [FILE] });
    await admin('update public.article_sections set article_id = $1 where id = $2', [C, section]);
    expect(await playerFiles()).toEqual({ rows: [], objects: [] });
    await admin('update public.article_sections set article_id = $1 where id = $2', [A, section]);
    expect(await playerFiles()).toEqual({ rows: [FILE], objects: [FILE] });
    const second = (await addSection(A, img(FILE, 'Shared'))).rows[0]!.id as string;
    await admin('update public.article_sections set article_id = $1 where id = $2', [C, section]);
    expect(await playerFiles()).toEqual({ rows: [FILE], objects: [FILE] });
    await admin('update public.article_sections set article_id = $1 where id = $2', [C, second]);
    expect(await playerFiles()).toEqual({ rows: [], objects: [] });
  });

  it('a gallery shares exactly the pictures it contains', async () => {
    await addSection(A, `![one](media:${FILE} "One")\n![two](media:${OTHER} "Two")`);
    expect((await playerFiles()).rows).toEqual([FILE, OTHER].sort());
  });

  it('a similar-looking path does not share a different file', async () => {
    await addSection(A, `![x](media:${FILE}x "Not the same file")`);
    expect((await playerFiles()).rows).toEqual([]);
  });

  it('a picture still used elsewhere for players stays visible when one use goes', async () => {
    await addSection(A, img(FILE));
    const second = (await addSection(A, img(FILE, 'Again'))).rows[0]!.id as string;
    await admin('delete from public.article_sections where id = $1', [second]);
    expect((await playerFiles()).rows).toEqual([FILE]);
  });

  it('players cannot add, rename or credit library files', async () => {
    expect((await as('player', `update public.media set credit = 'me', alt = 'x' where path = $1 returning id`, [FILE])).rows).toEqual([]);
    expect((await as('player', `insert into public.media (path) values ('media/player.webp')`)).error?.code).toBe('42501');
  });
});
