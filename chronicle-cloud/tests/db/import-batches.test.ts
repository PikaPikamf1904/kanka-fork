// Staged lore imports (20261115000100): only the DM sees them; an assistant can stage and read but
// never approve, record progress, rewrite or delete; staging writes nothing to the wiki; and saving
// an approved batch through the engine creates DM-only drafts, once, even when retried.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { analyzeImport, buildChunks, emptyDecisions, nextChunk, parseImportFiles, progressFromResult, recoverProgress, type ProgressEntry, type WikiIndex } from '../../src/lib/loreImport.ts';
import { admin, as, ids, pool, resetFixtures, type ClaimsOverride } from './helpers.ts';

const OAUTH: ClaimsOverride = { extra: { client_id: 'synthetic-mcp-client' } };
const staged = parseImportFiles([
  { name: 'synthetic.md', text: '---\ntitle: Synthetic Harbour\ntype: location\ncanon: confirmed\n---\nA harbour.\n\n## Docks\nBusy. See [[Synthetic Ferryman]].' },
  { name: 'ferry.md', text: '---\ntitle: Synthetic Ferryman\ntype: character\n---\nRows boats.\n\n## Facts\n- Race: Human' },
]);
const insert = `insert into public.import_batches (label, source_name, staged) values ('Synthetic', 'synthetic.md', $1::jsonb) returning id, status, decisions, progress, created_via`;

beforeEach(async () => {
  await resetFixtures();
  await admin('delete from public.import_batches');
  await admin(`delete from public.articles where slug like 'synthetic-%'`);
  await admin('delete from public.change_sets');
  await admin('delete from public.change_previews');
});
afterAll(() => pool.end());

async function dmTx<T>(claims: Record<string, unknown>, fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.dm, role: 'authenticated', aud: 'authenticated', aal: 'aal1', ...claims })]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

describe('import batches', () => {
  it('the DM stages a batch; it starts clean whatever the request says, and nothing reaches the wiki', async () => {
    const r = await as('dm', `insert into public.import_batches (label, staged, decisions, progress, status, created_via) values ('X', $1::jsonb, '{"items":{"synthetic-harbour":"approve"}}', '[{"chunk":0}]', 'done', 'forged') returning status, decisions, progress, created_via`, [JSON.stringify(staged)]);
    expect(r.error).toBeUndefined();
    expect(r.rows[0]).toEqual({ status: 'staged', decisions: { items: {}, relations: {}, types: {} }, progress: [], created_via: 'web' });
    expect((await admin(`select count(*)::int n from public.articles where slug like 'synthetic-%'`)).rows[0]!.n).toBe(0);
  });

  it('players, revoked members, outsiders and anonymous visitors can neither see nor stage batches', async () => {
    await admin(`insert into public.import_batches (label, staged) values ('Private', '{}'::jsonb)`);
    for (const who of ['player', 'revoked', 'outsider'] as const) {
      expect((await as(who, 'select * from public.import_batches')).rowCount, who).toBe(0);
      expect((await as(who, insert, [JSON.stringify(staged)])).error?.code, who).toBe('42501');
    }
    expect((await as('anon', 'select * from public.import_batches')).error?.code).toBe('42501');
  });

  it('an assistant can stage and read, but cannot approve, record progress, rewrite or delete', async () => {
    const r = await as('dm', insert, [JSON.stringify(staged)], OAUTH);
    expect(r.error).toBeUndefined();
    expect(r.rows[0]!.created_via).toBe('synthetic-mcp-client');
    const id = (await admin<{ id: string }>(`insert into public.import_batches (label, staged) values ('Y', $1::jsonb) returning id`, [JSON.stringify(staged)])).rows[0]!.id;
    expect((await as('dm', 'select id from public.import_batches where id = $1', [id], OAUTH)).rowCount).toBe(1);
    for (const sql of [
      `update public.import_batches set decisions = '{"items":{"synthetic-harbour":"approve"}}' where id = $1`,
      `update public.import_batches set progress = '[{"chunk":0,"status":"applied"}]' where id = $1`,
      `update public.import_batches set status = 'done' where id = $1`,
      `delete from public.import_batches where id = $1`,
    ]) expect((await as('dm', sql, [id], OAUTH)).error?.code, sql).toBe('42501');
    expect((await as('dm', 'select 1', [], { extra: { chronicle_client: 'x' } })).error).toBeUndefined();
  });

  it('the website DM records choices and progress, but cannot rewrite the staged entries', async () => {
    const id = (await admin<{ id: string }>(`insert into public.import_batches (label, staged) values ('Z', $1::jsonb) returning id`, [JSON.stringify(staged)])).rows[0]!.id;
    expect((await as('dm', `update public.import_batches set decisions = '{"items":{"synthetic-harbour":"reject"},"relations":{},"types":{}}', status = 'saving' where id = $1 returning status`, [id])).rows[0]).toEqual({ status: 'saving' });
    expect((await as('dm', `update public.import_batches set staged = '{"items":[]}' where id = $1`, [id])).error?.code).toBe('42501');
    expect((await as('dm', `update public.import_batches set status = 'published' where id = $1`, [id])).error?.code).toBe('23514');
    expect((await as('dm', `update public.import_batches set created_by = $2 where id = $1`, [id, ids.player])).error?.code).toBe('42501');
    // Deleting the account that staged it only clears the link.
    await admin(`update public.import_batches set created_by = $2 where id = $1`, [id, ids.dm]).catch(() => undefined);
    expect((await admin(`update public.import_batches set created_by = null where id = $1 returning id`, [id])).rowCount).toBe(1);
  });

  it('saving approved entries creates DM-only drafts once, even when every part is retried', async () => {
    const id = (await admin<{ id: string }>(`insert into public.import_batches (label, staged) values ('Save', $1::jsonb) returning id`, [JSON.stringify(staged)])).rows[0]!.id;
    const wiki: WikiIndex = {
      articles: (await admin('select id, slug, title, type::text, version, visibility::text, status::text from public.articles')).rows as WikiIndex['articles'],
      fields: (await admin('select article_id, label, value from public.infobox_fields')).rows as WikiIndex['fields'],
      redirects: (await admin('select from_slug, article_id from public.redirects')).rows as WikiIndex['redirects'],
      categories: (await admin('select id, slug, name from public.categories')).rows as WikiIndex['categories'],
    };
    const analysis = analyzeImport(staged, wiki);
    const d = emptyDecisions();
    d.relations[analysis.relations[0]!.key] = 'approve';
    const chunks = buildChunks(staged, analysis, d, id, 'Save', wiki);
    // Both pages are new, so their connection is saved with them, in one part.
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.relationKeys).toEqual([analysis.relations[0]!.key]);
    const save = (c: (typeof chunks)[number]) => dmTx({}, async (db) => {
      const p = (await db.query('select public.preview_change_set($1::jsonb) as r', [JSON.stringify(c.changeSet)])).rows[0].r;
      return (await db.query('select public.apply_change_set($1, $2, $3) as r', [p.preview_id, p.digest, c.idempotencyKey])).rows[0].r as { replayed: boolean; created: string[] };
    });
    for (const c of chunks) await save(c);
    // A lost answer: the same parts are sent again. Nothing is created twice.
    const again = await Promise.all(chunks.map(save));
    expect(again.every((r) => r.replayed)).toBe(true);
    const rows = (await admin<{ slug: string; visibility: string; status: string }>(`select slug, visibility::text, status::text from public.articles where slug like 'synthetic-%' order by slug`)).rows;
    expect(rows).toEqual([
      { slug: 'synthetic-ferryman', visibility: 'dm', status: 'draft' },
      { slug: 'synthetic-harbour', visibility: 'dm', status: 'draft' },
    ]);
    expect((await admin(`select count(*)::int n from public.article_sections s join public.articles a on a.id = s.article_id where a.slug like 'synthetic-%' and (s.visibility <> 'dm' or s.status <> 'draft')`)).rows[0]!.n).toBe(0);
    expect((await admin(`select count(*)::int n from public.relations r join public.articles a on a.id = r.source_article_id where a.slug = 'synthetic-harbour' and r.visibility = 'dm'`)).rows[0]!.n).toBe(1);
    const prov = (await admin<{ kind: string; reference: string }>(`select p.kind::text, p.reference from public.provenance p join public.articles a on a.id = p.article_id where a.slug = 'synthetic-harbour'`)).rows;
    expect(prov).toEqual([{ kind: 'dm_confirmed', reference: 'synthetic.md' }]);
    expect((await as('player', `select 1 from public.articles where slug like 'synthetic-%'`)).rowCount).toBe(0);
  });

  it('additions to an existing page need its current version, and never replace its text or facts', async () => {
    const before = (await admin<{ id: string; version: number; summary: string }>(`select id, version, summary from public.articles where slug = 'public-article'`)).rows[0]!;
    const fieldsBefore = (await admin('select label, value, visibility::text from public.infobox_fields where article_id = $1 order by label', [before.id])).rows;
    const s = parseImportFiles([{ name: 'x.md', text: '---\ntitle: Public Article\nslug: public-article\n---\nImported summary.\n\n## Facts\n- Race: Dragon\n- Synthetic label: New\n\n## Extra\nImported text.' }]);
    const wiki: WikiIndex = {
      articles: (await admin('select id, slug, title, type::text, version, visibility::text, status::text from public.articles')).rows as WikiIndex['articles'],
      fields: (await admin('select article_id, label, value from public.infobox_fields')).rows as WikiIndex['fields'],
      redirects: [], categories: [],
    };
    const a = analyzeImport(s, wiki);
    expect(a.items[0]!.conflicts.map((c) => c.label)).toEqual(['Race']);
    const d = emptyDecisions();
    d.items['public-article'] = 'approve';
    const [chunk] = buildChunks(s, a, d, 'c0ffee00-0000-4000-8000-000000000000', 'Add', wiki);
    // Someone edits the page after the review: saving is refused.
    await admin(`update public.articles set summary = summary || ' (edited)' where id = $1`, [before.id]);
    await expect(dmTx({}, (db) => db.query('select public.preview_change_set($1::jsonb) as r', [JSON.stringify(chunk!.changeSet)]).then((r) => {
      if (r.rows[0].r.conflicts.length) throw new Error('CONFLICT');
    }))).rejects.toThrow(/CONFLICT/);
    await admin(`update public.articles set summary = $2 where id = $1`, [before.id, before.summary]);
    // Re-reviewed against the current version: only additions, all DM-only drafts.
    const fresh = analyzeImport(s, { ...wiki, articles: (await admin('select id, slug, title, type::text, version, visibility::text, status::text from public.articles')).rows as WikiIndex['articles'] });
    const [c2] = buildChunks(s, fresh, d, 'c0ffee00-0000-4000-8000-000000000000', 'Add', { articles: (await admin('select id, slug, title, type::text, version, visibility::text, status::text from public.articles')).rows as WikiIndex['articles'] });
    await dmTx({}, async (db) => {
      const p = (await db.query('select public.preview_change_set($1::jsonb) as r', [JSON.stringify(c2!.changeSet)])).rows[0].r;
      expect(p.conflicts).toEqual([]);
      await db.query('select public.apply_change_set($1, $2, $3)', [p.preview_id, p.digest, c2!.idempotencyKey]);
    });
    const after = (await admin<{ summary: string; visibility: string; status: string }>(`select summary, visibility::text, status::text from public.articles where id = $1`, [before.id])).rows[0]!;
    expect(after).toEqual({ summary: before.summary, visibility: 'players', status: 'published' });
    const fieldsAfter = (await admin('select label, value, visibility::text from public.infobox_fields where article_id = $1 order by label', [before.id])).rows;
    expect(fieldsAfter.filter((f) => f.label !== 'Synthetic label')).toEqual(fieldsBefore);
    expect(fieldsAfter.find((f) => f.label === 'Synthetic label')).toEqual({ label: 'Synthetic label', value: 'New', visibility: 'dm' });
    const added = (await admin<{ heading: string; visibility: string; status: string }>(`select heading, visibility::text, status::text from public.article_sections where article_id = $1 and heading like '%imported from%' order by heading`, [before.id])).rows;
    expect(added).toEqual([
      { heading: 'Extra (imported from x.md)', visibility: 'dm', status: 'draft' },
      { heading: 'Summary (imported from x.md)', visibility: 'dm', status: 'draft' },
    ]);
    // Players see exactly what they saw before.
    const seen = (await as<{ heading: string }>('player', 'select heading from public.article_sections where article_id = $1', [before.id])).rows.map((r) => r.heading);
    expect(seen.some((h) => h.includes('imported'))).toBe(false);
  });

  it('an interrupted 45-page import resumes from the engine record and saves everything exactly once', async () => {
    const files = Array.from({ length: 45 }, (_, i) => ({ name: `places/synthetic-place-${i}.md`, text: `# Synthetic Place ${i}\nA place.${i > 0 ? ` Next to [[Synthetic Place ${i - 1}]].` : ''}\n\n## Notes\nText ${i}.` }));
    const big = parseImportFiles(files);
    expect(big.errors).toEqual([]);
    const id = (await admin<{ id: string }>(`insert into public.import_batches (label, staged) values ('Big', $1::jsonb) returning id`, [JSON.stringify(big)])).rows[0]!.id;
    const index = async (): Promise<WikiIndex> => ({
      articles: (await admin('select id, slug, title, type::text, version, visibility::text, status::text from public.articles')).rows as WikiIndex['articles'],
      fields: (await admin('select article_id, label, value from public.infobox_fields')).rows as WikiIndex['fields'],
      redirects: [], categories: [],
    });
    const d = emptyDecisions();
    for (const r of analyzeImport(big, await index()).relations) d.relations[r.key] = 'approve';
    let progress: ProgressEntry[] = [];
    const saveNext = async () => {
      const { chunk } = nextChunk(big, await index(), d, id, 'Big', progress);
      if (!chunk) return null;
      const result = await dmTx({}, async (db) => {
        const p = (await db.query('select public.preview_change_set($1::jsonb) as r', [JSON.stringify(chunk.changeSet)])).rows[0].r;
        expect(p.conflicts).toEqual([]);
        return (await db.query('select public.apply_change_set($1, $2, $3) as r', [p.preview_id, p.digest, chunk.idempotencyKey])).rows[0].r as { change_set_id: string };
      });
      return { chunk, result };
    };
    // Part 1 saved and recorded.
    const first = (await saveNext())!;
    progress.push({ chunk: first.chunk.index, key: first.chunk.idempotencyKey, slugs: first.chunk.slugs, relations: first.chunk.relationKeys, status: 'applied', at: 'now' });
    // Part 2 saved, but the browser closed before it was recorded.
    const lost = (await saveNext())!;
    expect(lost.chunk.slugs).toHaveLength(20);
    // On return: the engine's own record shows what was saved.
    const saved = (await admin(`select id, idempotency_key, result from public.change_sets order by created_at`)).rows as { id: string; idempotency_key: string; result: { created: string[] } }[];
    progress = recoverProgress(id, progress, saved, analyzeImport(big, await index()));
    expect(progress).toHaveLength(2);
    expect(progress[1]!.slugs.sort()).toEqual([...lost.chunk.slugs].sort());
    // Carry on until nothing is left.
    for (let guard = 0; guard < 20; guard++) {
      const next = await saveNext();
      if (!next) break;
      progress.push({ chunk: next.chunk.index, key: next.chunk.idempotencyKey, slugs: next.chunk.slugs, relations: next.chunk.relationKeys, status: 'applied', at: 'now' });
    }
    expect(nextChunk(big, await index(), d, id, 'Big', progress).chunk).toBeNull();
    const counts = (await admin<{ pages: number; dm: number }>(`select count(*)::int pages, count(*) filter (where visibility = 'dm' and status = 'draft')::int dm from public.articles where slug like 'synthetic-place-%'`)).rows[0]!;
    expect(counts).toEqual({ pages: 45, dm: 45 });
    expect((await admin<{ n: number }>(`select count(*)::int n from public.article_sections s join public.articles a on a.id = s.article_id where a.slug like 'synthetic-place-%'`)).rows[0]!.n).toBe(45); // one "Notes" section each; the first line is the summary
    const rels = (await admin<{ n: number; distinct_pairs: number }>(`select count(*)::int n, count(distinct (source_article_id, target_article_id))::int distinct_pairs from public.relations r join public.articles a on a.id = r.source_article_id where a.slug like 'synthetic-place-%'`)).rows[0]!;
    expect(rels).toEqual({ n: 44, distinct_pairs: 44 });
  });

  it('a page created by someone else between review and save is never overwritten, and the entry is not counted as saved', async () => {
    const s2 = parseImportFiles([{ name: 'race.md', text: '# Synthetic Racer\nImported text.\n\n## Notes\nIMPORTEDNOTES' }]);
    const index = async (): Promise<WikiIndex> => ({ articles: (await admin('select id, slug, title, type::text, version, visibility::text, status::text from public.articles')).rows as WikiIndex['articles'], fields: [], redirects: [], categories: [] });
    const [chunk] = buildChunks(s2, analyzeImport(s2, await index()), emptyDecisions(), 'f00d0000-0000-4000-8000-000000000000', 'Race', await index());
    // Meanwhile the DM writes the page by hand.
    await admin(`insert into public.articles (slug, type, title, summary, visibility, status) values ('synthetic-racer', 'character', 'Synthetic Racer', 'Written by hand.', 'players', 'published')`);
    const result = await dmTx({}, async (db) => {
      const p = (await db.query('select public.preview_change_set($1::jsonb) as r', [JSON.stringify(chunk!.changeSet)])).rows[0].r;
      return (await db.query('select public.apply_change_set($1, $2, $3) as r', [p.preview_id, p.digest, chunk!.idempotencyKey])).rows[0].r as { change_set_id: string; skipped: string[] };
    });
    expect(result.skipped).toContain('synthetic-racer');
    const page = (await admin<{ summary: string; visibility: string; status: string; n: number }>(`select a.summary, a.visibility::text, a.status::text, (select count(*)::int from public.article_sections s where s.article_id = a.id) n from public.articles a where slug = 'synthetic-racer'`)).rows[0];
    expect(page).toEqual({ summary: 'Written by hand.', visibility: 'players', status: 'published', n: 0 });
    const p = progressFromResult(chunk!, result, 'now');
    expect(p.slugs).toEqual([]);
    // Asked again, the entry is now an addition to that page, not approved unless the DM chooses it.
    const next = nextChunk(s2, await index(), emptyDecisions(), 'f00d0000-0000-4000-8000-000000000000', 'Race', [p]);
    expect(next.analysis.items[0]).toMatchObject({ action: 'add_to_existing', default_decision: 'review' });
    expect(next.chunk).toBeNull();
  });
});
