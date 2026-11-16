// CH-101 (20261113000200): an assistant connection writes only through a change set the DM
// approved on the website. Synthetic fixture world only.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, ids, pool, resetFixtures } from './helpers.ts';

const mcp = { client_id: 'synthetic-mcp-client' };
const A = 'a0000000-0000-4000-8000-00000000000a'; // 'public-article', published and player-visible
const B = 'a0000000-0000-4000-8000-00000000000b'; // 'secret-article', DM-only
const version = async (id: string) => `v${(await admin<{ version: string }>('select version from public.articles where id = $1', [id])).rows[0]!.version}`;

/** Several statements in ONE committed transaction as a given identity, like one API request. */
async function tx(claims: Record<string, unknown>, run: (q: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ids.dm, role: 'authenticated', aud: 'authenticated', aal: 'aal1', ...claims }),
    ]);
    await run((sql, params = []) => client.query(sql, params));
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function approvedPreview(changeSet: unknown) {
  let preview: { preview_id: string; digest: string } | undefined;
  await tx(mcp, async (q) => {
    preview = (await q('select public.preview_change_set($1) as r', [JSON.stringify(changeSet)])).rows[0]!.r as typeof preview;
  });
  await tx({}, async (q) => {
    await q('select public.approve_change_preview($1)', [preview!.preview_id]);
  });
  return preview!;
}

beforeEach(resetFixtures);
afterAll(() => pool.end());

describe('assistant writes go through approval only', () => {
  it('an approved change set that changes a page picture applies, including the visibility update it causes', async () => {
    // A picture wrongly marked player-visible on the DM-only page; removing it makes the sync run.
    const media = (await admin<{ id: string }>("insert into public.media (path, visibility) values ('media/approved-hero.webp', 'dm') returning id")).rows[0]!.id;
    await admin('update public.articles set hero_media_id = $1 where id = $2', [media, B]);
    await admin("update public.media set visibility = 'players' where id = $1", [media]);
    const p = await approvedPreview({ label: 'Picture', source_kind: 'dm_confirmed', changes: [{ operation: 'patch_article', slug: 'secret-article', expected_version: await version(B), fields: { hero_media_id: null } }] });
    await tx(mcp, async (q) => {
      await q('select public.apply_change_set($1, $2, $3)', [p.preview_id, p.digest, 'key-boundary-01']);
    });
    expect((await admin('select hero_media_id from public.articles where id = $1', [B])).rows[0]!.hero_media_id).toBeNull();
    expect((await admin('select visibility from public.media where id = $1', [media])).rows[0]!.visibility).toBe('dm');
  });

  it('the apply marker ends with the apply: a direct write later in the same request is refused', async () => {
    const p = await approvedPreview({ label: 'Summary', source_kind: 'dm_confirmed', changes: [{ operation: 'patch_article', slug: 'secret-article', expected_version: await version(B), fields: { summary: 'Approved summary.' } }] });
    await expect(tx(mcp, async (q) => {
      await q('select public.apply_change_set($1, $2, $3)', [p.preview_id, p.digest, 'key-boundary-02']);
      await q("update public.articles set summary = 'Sneaked in' where id = $1", [B]);
    })).rejects.toThrow(/propose changes/);
    expect((await admin('select summary from public.articles where id = $1', [B])).rows[0]!.summary).not.toBe('Sneaked in');
    // Without the extra write, the same approved change applies.
    await tx(mcp, async (q) => {
      await q('select public.apply_change_set($1, $2, $3)', [p.preview_id, p.digest, 'key-boundary-03']);
    });
    expect((await admin('select summary from public.articles where id = $1', [B])).rows[0]!.summary).toBe('Approved summary.');
  });

  it('an assistant cannot restore, snapshot, save or delete directly, and the website still can', async () => {
    const calls = [
      "select public.snapshot_article('a0000000-0000-4000-8000-00000000000a')",
      "delete from public.articles where id = 'a0000000-0000-4000-8000-00000000000a'",
      "insert into public.dm_notes (title, body) values ('x', 'y')",
      "update public.news_stories set reporter = 'nib'",
      "delete from public.revisions",
      "update public.campaign_settings set tagline = 'x' where id = true",
    ];
    for (const sql of calls) expect((await as('dm', sql, [], { extra: mcp })).error?.code, sql).toBe('42501');
    expect((await as('dm', calls[0]!)).error).toBeUndefined();
    expect((await as('dm', calls[2]!)).error).toBeUndefined();
  });

  it('the alternate client claim is treated the same way', async () => {
    const r = await as('dm', "update public.articles set summary = 'x' where id = $1", [A], { extra: { chronicle_client: 'other' } });
    expect(r.error?.code).toBe('42501');
  });

  it('players remain unable to write at all, with or without a client claim', async () => {
    for (const extra of [{}, mcp]) {
      const r = await as('player', "update public.articles set summary = 'x' where id = $1 returning id", [A], { extra });
      expect(Boolean(r.error) || r.rowCount === 0).toBe(true);
    }
  });
});
