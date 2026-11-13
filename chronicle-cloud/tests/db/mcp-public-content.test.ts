// CH-102 (20261113000400): an assistant's approved change set never changes what players can
// see, whatever the operation; DM-only material stays editable. Synthetic fixture world only.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, ids, pool, resetFixtures } from './helpers.ts';

const A = 'a0000000-0000-4000-8000-00000000000a'; // public-article (published, players)
const B = 'a0000000-0000-4000-8000-00000000000b'; // secret-article (DM-only)
const MCP = { client_id: 'synthetic-mcp-client' };

async function call(claims: Record<string, unknown>, fn: string, args: unknown[]) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.dm, role: 'authenticated', aud: 'authenticated', aal: 'aal1', ...claims })]);
    const { rows } = await c.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args);
    await c.query('commit');
    return { data: rows[0].r as Record<string, unknown> };
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    const err = e as { message: string; code?: string; detail?: string };
    return { error: { message: err.message, code: err.code, detail: err.detail } };
  } finally {
    c.release();
  }
}
const version = async (id: string) => `v${(await admin<{ version: string }>('select version from public.articles where id = $1', [id])).rows[0]!.version}`;

/** Assistant proposes, the DM approves on the website, the assistant applies. */
async function assistantApplies(changes: unknown[], key: string) {
  const p = await call(MCP, 'preview_change_set', [JSON.stringify({ label: 'Synthetic', source_kind: 'dm_confirmed', changes })]);
  if (p.error) return p;
  const preview = p.data as { preview_id: string; digest: string };
  const ok = await call({}, 'approve_change_preview', [preview.preview_id]);
  if (ok.error) return ok;
  return call(MCP, 'apply_change_set', [preview.preview_id, preview.digest, key]);
}

beforeEach(resetFixtures);
afterAll(() => pool.end());

describe('an assistant cannot change what players see', () => {
  it('removing a visible infobox field is refused; a DM-only field can go', async () => {
    const race = (await admin<{ id: string }>(`select id from public.infobox_fields where article_id = $1 and label = 'Race'`, [A])).rows[0]!.id;
    const secret = (await admin<{ id: string }>(`select id from public.infobox_fields where article_id = $1 and label = 'True identity'`, [A])).rows[0]!.id;
    const refused = await assistantApplies([{ operation: 'remove_infobox_field', article_slug: 'public-article', expected_version: await version(A), field_id: race }], 'key-ch102-field-1');
    expect(refused.error?.code).toBe('42501');
    expect((await admin('select 1 from public.infobox_fields where id = $1', [race])).rowCount).toBe(1);
    const allowed = await assistantApplies([{ operation: 'remove_infobox_field', article_slug: 'public-article', expected_version: await version(A), field_id: secret }], 'key-ch102-field-2');
    expect(allowed.error).toBeUndefined();
    expect((await admin('select 1 from public.infobox_fields where id = $1', [secret])).rowCount).toBe(0);
  });

  it('removing a visible connection is refused; a DM-only connection can go', async () => {
    const visible = (await admin<{ id: string }>(`select id from public.relations where source_article_id = $1 and kind = 'resides_in'`, [A])).rows[0]!.id;
    const hidden = (await admin<{ id: string }>(`select id from public.relations where source_article_id = $1 and kind = 'serves'`, [A])).rows[0]!.id;
    const rr = await assistantApplies([{ operation: 'remove_relation', relation_id: visible, expected_version: await version(A) }], 'key-ch102-rel-1');
    expect(rr.error?.code).toBe('42501');
    expect((await admin('select 1 from public.relations where id = $1', [visible])).rowCount).toBe(1);
    expect((await assistantApplies([{ operation: 'remove_relation', relation_id: hidden, expected_version: await version(A) }], 'key-ch102-rel-2')).error).toBeUndefined();
  });

  it('classifying a published page (adding or removing a category) is refused; a DM-only page can be classified', async () => {
    expect((await assistantApplies([{ operation: 'remove_category_link', article_slug: 'public-article', expected_version: await version(A), category_slug: 'sailors' }], 'key-ch102-cat-1')).error?.code).toBe('42501');
    expect((await assistantApplies([{ operation: 'add_category_link', article_slug: 'public-article', expected_version: await version(A), category_slug: 'traitors' }], 'key-ch102-cat-2')).error?.code).toBe('42501');
    expect((await admin(`select count(*)::int n from public.article_categories where article_id = $1`, [A])).rows[0]!.n).toBe(2);
    expect((await assistantApplies([{ operation: 'add_category_link', article_slug: 'secret-article', expected_version: await version(B), category_slug: 'traitors' }], 'key-ch102-cat-3')).error).toBeUndefined();
  });

  it('restoring an old revision of a published page is refused (it would change and hide the page)', async () => {
    await admin(`update public.articles set summary = 'Older summary.' where id = $1`, [A]);
    const rev = (await call({}, 'snapshot_article', [A, 'synthetic old version'])).data as unknown as string;
    await admin(`update public.articles set summary = 'Current summary.' where id = $1`, [A]);
    const r = await assistantApplies([{ operation: 'restore_revision', article_slug: 'public-article', expected_version: await version(A), revision_id: rev }], 'key-ch102-rev-1');
    expect(r.error?.code).toBe('42501');
    expect((await admin('select summary, status from public.articles where id = $1', [A])).rows[0]).toEqual({ summary: 'Current summary.', status: 'published' });
  });

  it('the website DM can still make every one of these changes through a change set', async () => {
    const race = (await admin<{ id: string }>(`select id from public.infobox_fields where article_id = $1 and label = 'Race'`, [A])).rows[0]!.id;
    const p = await call({}, 'preview_change_set', [JSON.stringify({ label: 'Website', source_kind: 'dm_confirmed', changes: [
      { operation: 'remove_infobox_field', article_slug: 'public-article', expected_version: await version(A), field_id: race },
      { operation: 'remove_category_link', article_slug: 'public-article', category_slug: 'sailors' },
    ] })]);
    const preview = p.data as { preview_id: string; digest: string };
    expect((await call({}, 'apply_change_set', [preview.preview_id, preview.digest, 'key-ch102-web-1'])).error).toBeUndefined();
  });

  it('an OAuth client literally named "web" gets no website privileges', async () => {
    const fake = { client_id: 'web' };
    const p = await call(fake, 'preview_change_set', [JSON.stringify({ label: 'Fake', source_kind: 'dm_confirmed', changes: [{ operation: 'create_article', slug: 'fake-web', title: 'Fake', type: 'lore' }] })]);
    const preview = p.data as { preview_id: string; digest: string };
    expect((await call(fake, 'approve_change_preview', [preview.preview_id])).error?.message).toBe('FORBIDDEN');
    expect((await call(fake, 'apply_change_set', [preview.preview_id, preview.digest, 'key-ch102-fake-1'])).error?.message).toBe('FORBIDDEN');
    expect((await admin(`select 1 from public.articles where slug = 'fake-web'`)).rowCount).toBe(0);
  });
});
