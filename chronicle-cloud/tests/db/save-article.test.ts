// The website editor's atomic save (migration 20261111001000). Local stack, synthetic fixtures.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, ids, pool, resetFixtures } from './helpers.ts';

beforeEach(resetFixtures);
afterAll(() => pool.end());

async function save(who: keyof typeof ids, draft: unknown, expected: string | null, claims: Record<string, unknown> = {}) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids[who], role: 'authenticated', aal: 'aal1', ...claims })]);
    const { rows } = await c.query('select public.save_article($1, $2) as r', [JSON.stringify(draft), expected]);
    await c.query('commit');
    return { data: rows[0]!.r as Record<string, unknown> };
  } catch (error) {
    await c.query('rollback').catch(() => undefined);
    return { error: (error as Error).message };
  } finally {
    c.release();
  }
}
const load = async (slug: string) => (await admin(
  `select a.id, a.slug, a.type, a.title, a.subtitle, a.summary, a.hero_media_id, a.visibility, a.status, a.is_featured, a.is_party_member, a.importance, a.session_date, a.version,
     (select json_agg(json_build_object('id', s.id, 'heading', s.heading, 'body', s.body, 'visibility', s.visibility, 'status', s.status) order by s.position, s.id) from public.article_sections s where s.article_id = a.id) sections,
     (select json_agg(json_build_object('id', f.id, 'label', f.label, 'value', f.value, 'visibility', f.visibility) order by f.position, f.id) from public.infobox_fields f where f.article_id = a.id) infobox
   from public.articles a where a.slug = $1`, [slug])).rows[0]!;
const draftOf = (row: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { sections, infobox, version: _v, ...article } = row;
  void _v;
  return { article, sections: sections ?? [], infobox: infobox ?? [], categoryIds: [] as string[] };
};

describe('save_article', () => {
  it('saves article, sections and fields together, keeps ids of unchanged parts and snapshots first', async () => {
    const row = await load('public-article');
    const d = draftOf(row);
    d.article.summary = 'Edited summary';
    d.sections[0].body = 'Edited body';
    d.sections.splice(2, 1);
    d.sections.push({ id: null, heading: 'New', body: 'Added', visibility: 'dm', status: 'draft' });
    d.infobox[1].value = 'Changed';
    const r = await save('dm', d, `v${row.version}`);
    expect(r.error).toBeUndefined();
    const after = await load('public-article');
    expect(after.summary).toBe('Edited summary');
    expect(after.sections.map((s: { id: string }) => s.id).slice(0, 2)).toEqual(row.sections.map((s: { id: string }) => s.id).slice(0, 2));
    expect(after.sections.map((s: { heading: string }) => s.heading)).toEqual(['Known history', 'True allegiance', 'New']);
    expect(after.infobox[1]).toMatchObject({ id: row.infobox[1].id, value: 'Changed' });
    expect((await admin("select count(*) n from public.revisions r join public.articles a on a.id = r.article_id where a.slug = 'public-article'")).rows[0]!.n).toBe('1');
    expect(r.data!.version).toBe(`v${after.version}`);
  });

  it('a second tab holding a stale version gets CONFLICT and nothing is written', async () => {
    const row = await load('public-article');
    const tabA = draftOf(row);
    tabA.article.summary = 'Tab A';
    expect((await save('dm', tabA, `v${row.version}`)).error).toBeUndefined();
    const tabB = draftOf(row);
    tabB.article.summary = 'Tab B';
    tabB.sections = [];
    expect((await save('dm', tabB, `v${row.version}`)).error).toBe('CONFLICT');
    const after = await load('public-article');
    expect(after.summary).toBe('Tab A');
    expect(after.sections).toHaveLength(3);
  });

  it('rolls back everything when a later part fails', async () => {
    const row = await load('public-article');
    const d = draftOf(structuredClone(row));
    d.article.summary = 'Should not stick';
    d.sections[0].body = 'Should not stick either';
    d.infobox.push({ id: null, label: '', value: 'empty label violates a constraint', visibility: 'dm' });
    expect((await save('dm', d, `v${row.version}`)).error).toBeDefined();
    const after = await load('public-article');
    expect(after.summary).toBe(row.summary);
    expect(after.sections[0].body).toBe(row.sections[0].body);
    expect(after.version).toBe(row.version);
  });

  it('creates a new article in one step and refuses a taken address', async () => {
    const d = { article: { slug: 'fresh-save', type: 'character', title: 'Fresh', subtitle: '', summary: '', hero_media_id: null, visibility: 'dm', status: 'draft', is_featured: false, is_party_member: true, importance: 0, session_date: null },
      sections: [{ id: null, heading: 'Appearance', body: 'Tall.', visibility: 'dm', status: 'draft' }], infobox: [{ id: null, label: 'Race', value: 'Gnome', visibility: 'dm' }], categoryIds: [] };
    expect((await save('dm', d, null)).data).toMatchObject({ slug: 'fresh-save', version: expect.stringMatching(/^v\d+$/) });
    expect((await save('dm', d, null)).error).toBe('ALREADY_EXISTS');
  });

  it('is closed to players, to DMs without two-step, to OAuth clients and to anonymous callers', async () => {
    const d = draftOf(await load('public-article'));
    expect((await save('player', d, null)).error).toBe('FORBIDDEN');
    expect((await save('dmMfa', d, null)).error).toBe('MFA_REQUIRED');
    expect((await save('dm', d, null, { client_id: 'some-mcp-client' })).error).toBe('FORBIDDEN');
    expect((await as('anon', 'select public.save_article($1, null)', [JSON.stringify(d)])).error?.code).toBe('42501');
    expect((await as('anon', 'select public.mcp_whoami()')).error?.code).toBe('42501');
  });
});
