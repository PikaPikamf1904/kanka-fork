// The editing engine (migration 20261111000900): preview, approval, atomic apply, versions,
// idempotency, provenance and guarded restore. Synthetic fixtures on the LOCAL stack only.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, ids, pool, resetFixtures } from './helpers.ts';

const A = 'a0000000-0000-4000-8000-00000000000a'; // public-article: players / published
const ALL = '00000000-0000-4000-8000-0000000000aa';

beforeEach(async () => {
  await resetFixtures();
  await admin('delete from public.change_sets');
  await admin('delete from public.change_previews');
});
afterAll(() => pool.end());

type Who = keyof typeof ids;
interface Rpc { data?: Record<string, unknown>; error?: { code: string; sqlstate?: string; detail: Record<string, unknown> } }

/** Call an RPC as a user and COMMIT, like one request through PostgREST. */
async function rpc(who: Who, fn: string, args: unknown[], claims: Record<string, unknown> = {}): Promise<Rpc> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ids[who], role: 'authenticated', aal: 'aal1', ...claims }),
    ]);
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await client.query(`select public.${fn}(${placeholders}) as r`, args);
    await client.query('commit');
    return { data: rows[0]!.r };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    const e = error as { message: string; code?: string; detail?: string };
    return { error: { code: e.message, sqlstate: e.code, detail: e.detail ? JSON.parse(e.detail) : {} } };
  } finally {
    client.release();
  }
}

const version = async (slug: string) =>
  `v${(await admin<{ version: string }>('select version from public.articles where slug = $1', [slug])).rows[0]!.version}`;
const preview = (cs: unknown, who: Who = 'dm', claims = {}) => rpc(who, 'preview_change_set', [JSON.stringify(cs)], claims);
const apply = (p: Rpc, key: string, who: Who = 'dm', claims = {}) =>
  rpc(who, 'apply_change_set', [p.data!.preview_id, p.data!.digest, key], claims);
interface Row { id: string; [k: string]: unknown }
interface Bundle { title: string; summary: string; subtitle: string; visibility: string; status: string; sections: Row[]; infobox: Row[]; relations: Row[] | null }
const bundle = async (slug: string): Promise<Bundle> => {
  const { rows } = await admin<Bundle>(
    `select a.title, a.summary, a.subtitle, a.visibility, a.status,
       (select json_agg(json_build_object('id', s.id, 'heading', s.heading, 'body', s.body, 'position', s.position, 'visibility', s.visibility, 'status', s.status) order by s.position, s.id)
          from public.article_sections s where s.article_id = a.id) as sections,
       (select json_agg(json_build_object('id', f.id, 'label', f.label, 'value', f.value, 'position', f.position, 'visibility', f.visibility) order by f.position, f.id)
          from public.infobox_fields f where f.article_id = a.id) as infobox,
       (select json_agg(json_build_object('id', r.id, 'kind', r.kind) order by r.id) from public.relations r where r.source_article_id = a.id) as relations
     from public.articles a where a.slug = $1`, [slug]);
  return rows[0]!;
};
const counts = async () => (await admin<{ a: string; s: string; f: string; r: string; rev: string }>(
  `select (select count(*) from public.articles) a, (select count(*) from public.article_sections) s,
          (select count(*) from public.infobox_fields) f, (select count(*) from public.relations) r,
          (select count(*) from public.revisions) rev`)).rows[0]!;

const newHero = (extra: unknown[] = []) => ({
  label: 'Synthetic hero', source_kind: 'dm_confirmed',
  changes: [
    { operation: 'create_article', slug: 'synthetic-hero', title: 'Synthetic Hero', type: 'character', summary: 'A fictional fixture.' },
    { operation: 'upsert_section', article_slug: 'synthetic-hero', heading: 'Appearance', body: 'Goggles. [[public-two|Harbour]]' },
    { operation: 'upsert_section', article_slug: 'synthetic-hero', heading: 'Personality', body: 'Careful.' },
    { operation: 'upsert_section', article_slug: 'synthetic-hero', heading: 'History', body: 'Not recorded.' },
    { operation: 'upsert_infobox_field', article_slug: 'synthetic-hero', label: 'Race', value: 'Gnome' },
    { operation: 'add_relation', source_slug: 'synthetic-hero', target_slug: 'public-two', kind: 'resides_in', label: 'Lives in' },
    ...extra,
  ],
});

describe('create, atomically (DATA-01, DATA-02, DATA-19)', () => {
  it('creates an article with sections, a field and a relation, all DM-only drafts, with provenance', async () => {
    const p = await preview(newHero());
    expect(p.error).toBeUndefined();
    expect(p.data).toMatchObject({ review_required: true, created: ['synthetic-hero'], conflicts: [] });
    expect(String(p.data!.digest)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await counts()).toMatchObject({ a: '5' }); // preview wrote nothing

    const r = await apply(p, 'key-create-0001');
    expect(r.error).toBeUndefined();
    expect(r.data).toMatchObject({ created: ['synthetic-hero'], replayed: false });
    const b = await bundle('synthetic-hero');
    expect(b).toMatchObject({ visibility: 'dm', status: 'draft' });
    expect(b.sections).toHaveLength(3);
    expect(b.sections.every((s) => s.visibility === 'dm' && s.status === 'draft')).toBe(true);
    expect(b.infobox).toHaveLength(1);
    expect(b.relations).toHaveLength(1);
    const prov = await admin("select count(*) n from public.provenance p join public.articles a on a.id = p.article_id where a.slug = 'synthetic-hero' and p.kind = 'dm_confirmed'");
    expect(prov.rows[0]!.n).toBe('4');
    const links = await admin("select target_slug from public.article_links l join public.article_sections s on s.id = l.source_section_id join public.articles a on a.id = s.article_id where a.slug = 'synthetic-hero'");
    expect(links.rows.map((x) => x.target_slug)).toEqual(['public-two']);
  });

  it('a failure after some rows were written leaves no trace, across several articles', async () => {
    await admin("insert into public.articles (slug, title) values ('doomed-target', 'Doomed')");
    const before = await counts();
    const cs = {
      changes: [
        { operation: 'create_article', slug: 'first-new', title: 'First', type: 'lore' },
        { operation: 'upsert_section', article_slug: 'first-new', heading: 'One', body: 'x' },
        { operation: 'upsert_section', article_slug: 'first-new', heading: 'Two', body: 'y' },
        { operation: 'patch_article', slug: 'public-two', expected_version: await version('public-two'), fields: { summary: 'Changed' } },
        { operation: 'create_article', slug: 'second-new', title: 'Second', type: 'lore' },
        { operation: 'add_relation', source_slug: 'second-new', target_slug: 'doomed-target', kind: 'related_to' },
      ],
    };
    const p = await preview(cs);
    expect(p.data!.preview_id).toBeTruthy();
    await admin("delete from public.articles where slug = 'doomed-target'"); // the last write will now fail
    const r = await apply(p, 'key-rollback-01');
    expect(r.error?.code).toBe('VALIDATION_FAILED');
    expect(r.error?.sqlstate).toBe('PT422');
    expect(await counts()).toEqual({ ...before, a: String(Number(before.a) - 1) });
    const two = await admin("select summary from public.articles where slug = 'public-two'");
    expect(two.rows[0]!.summary).toBe('A town by the sea.');
    expect((await admin("select count(*) n from public.articles where slug in ('first-new','second-new')")).rows[0]!.n).toBe('0');
    expect((await admin('select count(*) n from public.change_sets')).rows[0]!.n).toBe('0');
    // The key was not used up, so a corrected retry is possible.
  });
});

describe('partial edits leave everything else alone (DATA-03, DATA-04, DATA-05)', () => {
  it('patching the summary, one field and one section changes only those', async () => {
    const before = await bundle('public-article');
    const sec = before.sections[0]!;
    const fld = before.infobox[0]!;
    const v = await version('public-article');
    const p = await preview({ expected_versions: { 'public-article': v }, changes: [
      { operation: 'patch_article', slug: 'public-article', fields: { summary: 'New summary.' } },
      { operation: 'upsert_infobox_field', article_slug: 'public-article', field_id: fld.id, label: fld.label, value: 'Half-elf' },
      { operation: 'upsert_section', article_slug: 'public-article', section_id: sec.id, heading: sec.heading, body: 'Rewritten history.' },
    ] });
    expect(p.data!.diffs).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'summary', before: 'A captain the party has met.', after: 'New summary.' }),
      expect.objectContaining({ field: 'Race', before: 'Human', after: 'Half-elf' }),
      expect.objectContaining({ field: 'body', section_id: sec.id, after: 'Rewritten history.' }),
    ]));
    expect((await apply(p, 'key-partial-01')).error).toBeUndefined();
    const after = await bundle('public-article');
    expect(after.title).toBe(before.title);
    expect(after.subtitle).toBe(before.subtitle);
    expect(after.summary).toBe('New summary.');
    expect(after.sections.slice(1)).toEqual(before.sections.slice(1));
    expect(after.sections[0]).toEqual({ ...sec, body: 'Rewritten history.' });
    expect(after.infobox.slice(1)).toEqual(before.infobox.slice(1));
    expect(after.infobox[0]).toEqual({ ...fld, value: 'Half-elf' });
    expect(after.relations).toEqual(before.relations);
    // Visibility of existing rows was not widened or narrowed by the edit.
    expect(after.visibility).toBe('players');
  });

  it('refuses changes to type, visibility, status or slug through a patch', async () => {
    const v = await version('public-article');
    for (const field of ['type', 'visibility', 'status', 'slug', 'source_ref']) {
      const p = await preview({ changes: [{ operation: 'patch_article', slug: 'public-article', expected_version: v, fields: { [field]: 'x' } }] });
      expect(p.error?.code, field).toBe('VALIDATION_FAILED');
    }
  });
});

describe('versions and conflicts (DATA-06)', () => {
  it('a stale preview cannot be applied after someone else changed the article', async () => {
    const v = await version('public-article');
    const p = await preview({ changes: [{ operation: 'patch_article', slug: 'public-article', expected_version: v, fields: { summary: 'Mine' } }] });
    await admin("update public.articles set summary = 'Theirs' where slug = 'public-article'");
    const r = await apply(p, 'key-conflict-1');
    expect(r.error?.code).toBe('CONFLICT');
    expect((await admin("select summary from public.articles where slug = 'public-article'")).rows[0]!.summary).toBe('Theirs');
  });

  it('a stale expected_version gets no preview id, only the conflict', async () => {
    const p = await preview({ changes: [{ operation: 'patch_article', slug: 'public-article', expected_version: 'v0', fields: { summary: 'x' } }] });
    expect(p.data!.preview_id).toBeNull();
    expect(p.data!.conflicts).toEqual([expect.objectContaining({ slug: 'public-article', expected: 'v0' })]);
  });

  it('every edit to an existing article needs an expected version', async () => {
    const p = await preview({ changes: [{ operation: 'upsert_section', article_slug: 'public-article', heading: 'X', body: 'Y' }] });
    expect(p.error?.code).toBe('VALIDATION_FAILED');
    expect(String(p.error?.detail.message)).toContain('expected_version');
  });

  it('a version bump follows any change to sections, fields, categories or relations', async () => {
    const v1 = await version('public-two');
    await admin("insert into public.article_sections (article_id, heading, body) select id, 'h', 'b' from public.articles where slug = 'public-two'");
    const v2 = await version('public-two');
    expect(v2).not.toBe(v1);
  });
});

describe('idempotency (DATA-07, DATA-08, DATA-09)', () => {
  it('the same key and payload returns the stored result and writes nothing twice', async () => {
    const p = await preview(newHero());
    const first = await apply(p, 'key-retry-0001');
    const before = await counts();
    const again = await apply(p, 'key-retry-0001');
    expect(again.data).toMatchObject({ ...first.data, replayed: true });
    expect(await counts()).toEqual(before);
  });

  it('the same key with different changes is refused', async () => {
    const p1 = await preview(newHero());
    await apply(p1, 'key-mismatch-1');
    const p2 = await preview({ changes: [{ operation: 'create_article', slug: 'another-one', title: 'Another', type: 'lore' }] });
    const r = await apply(p2, 'key-mismatch-1');
    expect(r.error?.code).toBe('IDEMPOTENCY_MISMATCH');
    expect((await admin("select count(*) n from public.articles where slug = 'another-one'")).rows[0]!.n).toBe('0');
  });

  it('two applies racing with one key produce exactly one change', async () => {
    const p = await preview(newHero());
    const before = await counts();
    const [a, b] = await Promise.all([apply(p, 'key-race-00001'), apply(p, 'key-race-00001')]);
    expect([a.error, b.error]).toEqual([undefined, undefined]);
    expect([a.data!.replayed, b.data!.replayed].sort()).toEqual([false, true]);
    const after = await counts();
    expect(Number(after.a) - Number(before.a)).toBe(1);
    expect((await admin('select count(*) n from public.change_sets')).rows[0]!.n).toBe('1');
  });
});

describe('preview rules (DATA-10 to DATA-13)', () => {
  it('a preview has no time limit: an old preview still applies when nothing changed', async () => {
    const p = await preview(newHero());
    expect(p.data!.expires_at).toBe('infinity');
    await admin("update public.change_previews set created_at = now() - interval '45 days'");
    expect((await apply(p, 'key-old-preview-01')).error).toBeUndefined();
    expect((await admin("select count(*) n from public.articles where slug = 'synthetic-hero'")).rows[0]!.n).toBe('1');
  });

  it('an expired preview is refused', async () => {
    const p = await preview(newHero());
    await admin("update public.change_previews set expires_at = now() - interval '1 second'");
    expect((await apply(p, 'key-expired-01')).error?.code).toBe('PREVIEW_EXPIRED');
    expect((await admin("select count(*) n from public.articles where slug = 'synthetic-hero'")).rows[0]!.n).toBe('0');
  });

  it('a preview cannot be applied by another DM or another client', async () => {
    const p = await preview(newHero());
    expect((await apply(p, 'key-other-dm-1', 'dmMfa', { aal: 'aal2' })).error?.code).toBe('NOT_FOUND');
    expect((await apply(p, 'key-other-cl-1', 'dm', { client_id: 'some-mcp-client' })).error?.code).toBe('FORBIDDEN');
  });

  it('a digest that does not match the preview is refused', async () => {
    const p = await preview(newHero());
    const r = await rpc('dm', 'apply_change_set', [p.data!.preview_id, 'sha256:' + '0'.repeat(64), 'key-digest-01']);
    expect(r.error?.code).toBe('VALIDATION_FAILED');
  });

  it('an OAuth client needs a human approval from the website, and cannot give it itself', async () => {
    const mcp = { client_id: 'synthetic-mcp-client' };
    const p = await preview(newHero(), 'dm', mcp);
    const r = await apply(p, 'key-mcp-000001', 'dm', mcp);
    expect(r.error).toMatchObject({ code: 'FORBIDDEN', detail: expect.objectContaining({ review_required: true }) });
    expect((await rpc('dm', 'approve_change_preview', [p.data!.preview_id], mcp)).error?.code).toBe('FORBIDDEN');
    expect((await admin("select count(*) n from public.articles where slug = 'synthetic-hero'")).rows[0]!.n).toBe('0');
    // The DM approves in the website; the same client can now apply.
    expect((await rpc('dm', 'approve_change_preview', [p.data!.preview_id])).data).toMatchObject({ approved: true });
    expect((await apply(p, 'key-mcp-000002', 'dm', mcp)).data).toMatchObject({ created: ['synthetic-hero'] });
  });

  it('an OAuth client cannot change text players can already read', async () => {
    const mcp = { client_id: 'synthetic-mcp-client' };
    const v = await version('public-article');
    const sec = (await bundle('public-article')).sections[0]!;
    const p1 = await preview({ changes: [{ operation: 'patch_article', slug: 'public-article', expected_version: v, fields: { summary: 'x' } }] }, 'dm', mcp);
    expect(p1.error?.code).toBe('VALIDATION_FAILED');
    const p2 = await preview({ changes: [{ operation: 'upsert_section', article_slug: 'public-article', expected_version: v, section_id: sec.id, heading: 'x', body: 'y' }] }, 'dm', mcp);
    expect(p2.error?.code).toBe('VALIDATION_FAILED');
  });
});

describe('collisions, links and limits (DATA-14, DATA-15, DATA-17, DATA-18)', () => {
  it('an existing slug or source_ref is a conflict, or a skip when asked', async () => {
    const conflict = await preview({ changes: [{ operation: 'create_article', slug: 'public-article', title: 'Dup', type: 'lore' }] });
    expect(conflict.data).toMatchObject({ preview_id: null, conflicts: [expect.objectContaining({ code: 'ALREADY_EXISTS' })] });
    const skip = await preview({ changes: [
      { operation: 'create_article', slug: 'public-article', title: 'Dup', type: 'lore', on_exists: 'skip' },
      { operation: 'upsert_section', article_slug: 'public-article', heading: 'h', body: 'b' },
    ] });
    expect(skip.data).toMatchObject({ skipped: ['public-article', 'public-article'], created: [] });
    const before = await bundle('public-article');
    expect((await apply(skip, 'key-skip-00001')).error).toBeUndefined();
    expect(await bundle('public-article')).toEqual(before);
  });

  it('warns about links to pages that do not exist, without creating them', async () => {
    const p = await preview(newHero([{ operation: 'upsert_section', article_slug: 'synthetic-hero', heading: 'Allies', body: '[[nobody-yet|Someone]] and [[public-three]]' }]));
    expect(p.data!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'BROKEN_LINK', target_slug: 'nobody-yet' })]));
    await apply(p, 'key-links-0001');
    expect((await admin("select count(*) n from public.articles where slug = 'nobody-yet'")).rows[0]!.n).toBe('0');
  });

  it('refuses oversized, malformed and unknown input before writing', async () => {
    const cases: unknown[] = [
      { changes: [] },
      { changes: 'x' },
      { changes: [{ operation: 'drop_table' }] },
      { changes: [{ operation: 'create_article', slug: 'Bad Slug', title: 'x', type: 'lore' }] },
      { changes: [{ operation: 'create_article', slug: 'ok', title: 'x'.repeat(201), type: 'lore' }] },
      { changes: [{ operation: 'create_article', slug: 'ok', title: 'x', type: 'spell' }] },
      { changes: [{ operation: 'create_article', slug: 'ok', title: 'x', type: 'lore' }, { operation: 'upsert_section', article_slug: 'ok', heading: 'h', body: 'x'.repeat(100001) }] },
      { changes: [{ operation: 'upsert_section', article_slug: 'public-article', expected_version: 'v1', section_id: ALL, heading: 'h', body: 'b' }] },
      { source_kind: 'rumour', changes: [{ operation: 'create_article', slug: 'ok', title: 'x', type: 'lore' }] },
      { changes: [{ operation: 'add_relation', source_slug: 'public-article', expected_version: 'v1', target_slug: 'public-article', kind: 'knows' }] },
    ];
    for (const cs of cases) expect((await preview(cs)).error?.code, JSON.stringify(cs).slice(0, 80)).toBe('VALIDATION_FAILED');
    const tooMany = { changes: [{ operation: 'create_article', slug: 'many', title: 'Many', type: 'lore' },
      ...Array.from({ length: 31 }, (_, i) => ({ operation: 'upsert_section', article_slug: 'many', heading: `h${i}`, body: 'b' }))] };
    const p = await preview(tooMany);
    expect((await apply(p, 'key-toomany-01')).error?.code).toBe('VALIDATION_FAILED');
    expect((await admin("select count(*) n from public.articles where slug = 'many'")).rows[0]!.n).toBe('0');
  });

  it('ignores requests for player visibility or publication, with a warning', async () => {
    const p = await preview({ changes: [
      { operation: 'create_article', slug: 'sneaky', title: 'Sneaky', type: 'lore', visibility: 'players', status: 'published' },
      { operation: 'upsert_section', article_slug: 'sneaky', heading: 'h', body: 'b', visibility: 'players', status: 'published' },
      { operation: 'upsert_infobox_field', article_slug: 'sneaky', label: 'L', value: 'V', visibility: 'players' },
      { operation: 'add_relation', source_slug: 'sneaky', target_slug: 'public-two', kind: 'knows', visibility: 'players' },
    ] });
    expect(p.data!.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'VISIBILITY_IGNORED' })]));
    await apply(p, 'key-sneaky-001');
    const rows = await admin(`select
      (select count(*) from public.articles where slug = 'sneaky' and (visibility <> 'dm' or status <> 'draft')) a,
      (select count(*) from public.article_sections s join public.articles x on x.id = s.article_id where x.slug = 'sneaky' and (s.visibility <> 'dm' or s.status <> 'draft')) s,
      (select count(*) from public.infobox_fields f join public.articles x on x.id = f.article_id where x.slug = 'sneaky' and f.visibility <> 'dm') f,
      (select count(*) from public.relations r join public.articles x on x.id = r.source_article_id where x.slug = 'sneaky' and r.visibility <> 'dm') r`);
    expect(rows.rows[0]).toEqual({ a: '0', s: '0', f: '0', r: '0' });
  });
});

describe('restore (DATA-16)', () => {
  it('restores atomically as a draft and never widens a section that is now DM-only', async () => {
    const sec = (await bundle('public-article')).sections[0]!; // players / published
    const snap = await rpc('dm', 'snapshot_article', [A, 'before']);
    await admin("update public.article_sections set body = 'Edited later', visibility = 'dm' where id = $1", [sec.id]);
    await admin("update public.articles set title = 'Renamed' where id = $1", [A]);
    const p = await preview({ changes: [{ operation: 'restore_revision', article_slug: 'public-article', expected_version: await version('public-article'), revision_id: snap.data }] });
    expect(p.data!.diffs).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'title', before: 'Renamed', after: 'Visible Captain' })]));
    expect((await apply(p, 'key-restore-01')).error).toBeUndefined();
    const after = await bundle('public-article');
    expect(after.title).toBe('Visible Captain');
    expect(after.status).toBe('draft');
    expect(after.sections.find((s) => s.id === sec.id)).toMatchObject({ body: sec.body, visibility: 'dm' });
  });
});

describe('who may use it', () => {
  it('players, revoked members, outsiders and DMs without two-step get nothing', async () => {
    for (const who of ['player', 'revoked', 'outsider'] as const) {
      expect((await preview(newHero(), who)).error?.code, who).toBe('FORBIDDEN');
    }
    expect((await preview(newHero(), 'dmMfa')).error?.code).toBe('MFA_REQUIRED');
    const p = await preview(newHero());
    expect((await apply(p, 'key-player-001', 'player')).error?.code).toBe('FORBIDDEN');
    expect((await as('anon', 'select public.preview_change_set($1)', [JSON.stringify(newHero())])).error?.code).toBe('42501');
  });

  it('players cannot read previews, change sets or provenance', async () => {
    const p = await preview(newHero());
    await apply(p, 'key-privacy-01');
    for (const table of ['change_previews', 'change_sets', 'provenance']) {
      expect((await as('player', `select * from public.${table}`)).rowCount, table).toBe(0);
    }
    expect((await as('dm', 'insert into public.change_previews (principal_id, client_id, change_set, base_versions, digest, result, expires_at) values ($1, \'web\', \'{}\', \'{}\', \'x\', \'{}\', now())', [ids.dm])).error?.code).toBe('42501');
    expect((await as('dm', "update public.change_previews set approved_at = now()")).error?.code).toBe('42501');
  });
});
