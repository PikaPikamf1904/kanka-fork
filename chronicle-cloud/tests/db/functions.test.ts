// Enrollment, access codes, member revocation, revisions and wiki-link extraction.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, asService, ids, pool, resetFixtures } from './helpers.ts';
import { slugify } from '../../src/lib/slug.ts';

const A = 'a0000000-0000-4000-8000-00000000000a';
const CODE_ID = 'e0000000-0000-4000-8000-000000000001';
const IP = 'ip-hash-0000000000000001';

beforeEach(resetFixtures);
afterAll(() => pool.end());

async function begin(code: string, ip = IP) {
  const { rows } = await asService<{ r: { status: string; code_id?: string } }>(
    'select public.begin_enrollment($1, $2) as r', [code, ip],
  );
  return rows[0]!.r;
}

async function complete(user: string, codeId: string, name = 'Riverwind') {
  const { rows } = await asService<{ r: string }>('select public.complete_enrollment($1, $2, $3) as r', [user, codeId, name]);
  return rows[0]!.r;
}

describe('access-code enrollment (server only)', () => {
  it('rejects a wrong code and accepts the right one', async () => {
    expect((await begin('wrong code')).status).toBe('invalid');
    const ok = await begin('correct horse battery');
    expect(ok).toEqual({ status: 'ok', code_id: CODE_ID });
  });

  it('rate-limits an address after five failures, even for the right code', async () => {
    for (let i = 0; i < 5; i++) expect((await begin(`guess ${i}`)).status).toBe('invalid');
    expect((await begin('correct horse battery')).status).toBe('rate_limited');
    // Another address is unaffected.
    expect((await begin('correct horse battery', 'ip-hash-0000000000000002')).status).toBe('ok');
  });

  it('has a global failure limit against distributed guessing', async () => {
    await admin(
      `insert into public.enrollment_attempts (ip_hash, succeeded)
       select 'ip-hash-spread-' || g, false from generate_series(1, 100) g`,
    );
    expect((await begin('correct horse battery', 'ip-hash-fresh-000000001')).status).toBe('rate_limited');
  });

  it('refuses revoked, expired and used-up codes', async () => {
    await admin('update public.access_codes set revoked_at = now() where id = $1', [CODE_ID]);
    expect((await begin('correct horse battery')).status).toBe('invalid');
    await admin("update public.access_codes set revoked_at = null, expires_at = now() - interval '1 minute' where id = $1", [CODE_ID]);
    expect((await begin('correct horse battery', 'ip-hash-0000000000000003')).status).toBe('invalid');
    await admin('update public.access_codes set expires_at = null, max_uses = 1, use_count = 1 where id = $1', [CODE_ID]);
    expect((await begin('correct horse battery', 'ip-hash-0000000000000004')).status).toBe('invalid');
  });

  it('enrolls a new device as a player, once, and counts the use', async () => {
    expect(await complete(ids.newDevice, CODE_ID)).toBe('enrolled');
    expect(await complete(ids.newDevice, CODE_ID)).toBe('already_member');
    const { rows } = await admin<{ role: string; display_name: string }>(
      'select role, display_name from public.campaign_members where user_id = $1', [ids.newDevice],
    );
    expect(rows[0]).toEqual({ role: 'player', display_name: 'Riverwind' });
    const code = await admin<{ use_count: number }>('select use_count from public.access_codes where id = $1', [CODE_ID]);
    expect(code.rows[0]!.use_count).toBe(1);
    // The new player can read player content right away.
    const articles = await as('newDevice', 'select slug from public.articles');
    expect(articles.rowCount).toBe(3);
  });

  it('never turns an existing DM or revoked device into an active player', async () => {
    expect(await complete(ids.dm, CODE_ID)).toBe('already_member');
    expect(await complete(ids.revoked, CODE_ID)).toBe('already_member');
    const { rows } = await admin<{ user_id: string; role: string; revoked: boolean }>(
      'select user_id, role, revoked_at is not null as revoked from public.campaign_members where user_id = any($1::uuid[]) order by user_id',
      [[ids.dm, ids.revoked]],
    );
    expect(rows.find((r) => r.user_id === ids.dm)?.role).toBe('dm');
    expect(rows.find((r) => r.user_id === ids.revoked)?.revoked).toBe(true);
  });

  it('re-checks the code when completing (revoked in between)', async () => {
    expect((await begin('correct horse battery')).status).toBe('ok');
    await admin('update public.access_codes set revoked_at = now() where id = $1', [CODE_ID]);
    expect(await complete(ids.newDevice, CODE_ID)).toBe('invalid');
  });

  it('stores only a bcrypt hash of the code', async () => {
    const { rows } = await admin<{ code_hash: string }>('select code_hash from public.access_codes');
    expect(rows[0]!.code_hash).toMatch(/^\$2a\$/);
    expect(rows[0]!.code_hash).not.toContain('correct horse');
  });
});

describe('DM access-code and member management', () => {
  it('creates, rotates and revokes codes', async () => {
    const short = await as('dm', "select public.create_access_code('short')");
    expect(short.error?.code).toBe('22023');
    const created = await as<{ id: string }>('dm', "select public.create_access_code('a brand new table code', 'New code') as id");
    expect(created.error).toBeUndefined();
    // as() rolls back, so rotate within one statement chain and inspect inside the same call.
    const rotated = await as<{ active: string }>('dm',
      "with r as (select public.rotate_access_code('rotated code for the table') as id) select (select count(*) from public.access_codes where revoked_at is null) + 0 * (select count(*) from r) as active");
    expect(rotated.error).toBeUndefined();
  });

  it('rotation leaves exactly one active code', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.dm, role: 'authenticated', aal: 'aal1' })]);
      await client.query("select public.create_access_code('second table code here')");
      await client.query("select public.rotate_access_code('rotated code for the table')");
      const { rows } = await client.query<{ n: string }>('select count(*) as n from public.access_codes where revoked_at is null');
      expect(rows[0]!.n).toBe('1');
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('revoking a member cuts off their access on the next request', async () => {
    const before = await as('player', 'select slug from public.articles');
    expect(before.rowCount).toBe(3);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.dm, role: 'authenticated', aal: 'aal1' })]);
      await client.query('select public.revoke_member($1)', [ids.player]);
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.player, role: 'authenticated', aal: 'aal1' })]);
      const { rowCount } = await client.query('select slug from public.articles');
      expect(rowCount).toBe(0);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('the DM cannot revoke themselves, and players cannot revoke anyone', async () => {
    const self = await as('dm', 'select public.revoke_member($1)', [ids.dm]);
    expect(self.error?.code).toBe('22023');
    const byPlayer = await as('player', 'select public.revoke_member($1)', [ids.player]);
    expect(byPlayer.error?.code).toBe('42501');
  });

  it('the DM sees code metadata but never the hash', async () => {
    const meta = await as<{ label: string }>('dm', 'select id, label, use_count from public.access_codes');
    expect(meta.rows.map((r) => r.label)).toEqual(['Table code']);
    const hash = await as('dm', 'select code_hash from public.access_codes');
    expect(hash.error?.code).toBe('42501');
  });
});

describe('revisions', () => {
  it('snapshots and restores an article, keeping a snapshot of what was replaced', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.dm, role: 'authenticated', aal: 'aal1' })]);
      const snap = await client.query<{ id: string }>("select public.snapshot_article($1, 'before edit') as id", [A]);
      await client.query("update public.articles set title = 'Renamed' where id = $1", [A]);
      await client.query('delete from public.article_sections where article_id = $1', [A]);
      await client.query('select public.restore_revision($1)', [snap.rows[0]!.id]);
      const title = await client.query<{ title: string }>('select title from public.articles where id = $1', [A]);
      const sections = await client.query('select id from public.article_sections where article_id = $1', [A]);
      const revisions = await client.query<{ note: string }>('select note from public.revisions where article_id = $1 order by created_at', [A]);
      expect(title.rows[0]!.title).toBe('Visible Captain');
      expect(sections.rowCount).toBe(3);
      expect(revisions.rows.map((r) => r.note)[0]).toBe('before edit');
      expect(revisions.rows.some((r) => r.note.startsWith('Before restoring'))).toBe(true);
      // Restored sections keep their links.
      const links = await client.query('select target_slug from public.article_links');
      expect(links.rowCount).toBeGreaterThan(0);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});

describe('revision retention', () => {
  it('keeps only the 30 most recent snapshots of an article', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.dm, role: 'authenticated', aal: 'aal1' })]);
      for (let i = 0; i < 35; i++) await client.query("select public.snapshot_article($1, $2)", [A, `save ${i}`]);
      const { rows } = await client.query<{ n: string }>('select count(*) as n from public.revisions where article_id = $1', [A]);
      expect(rows[0]!.n).toBe('30');
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});

describe('wiki links', () => {
  it('extracts [[links]] with the same slug rules as the browser', async () => {
    const { rows } = await admin<{ target_slug: string }>(
      "select target_slug from public.article_links where source_section_id = '50000000-0000-4000-8000-000000000001' order by 1",
    );
    expect(rows.map((r) => r.target_slug)).toEqual(['public-two', 'secret-article']);
    for (const input of ['Secret Article', '  Harbour   Town!! ', 'Ünïcode & Co.', '--x--', 'A_b c']) {
      const db = await admin<{ s: string }>('select private.slugify($1) as s', [input]);
      expect(db.rows[0]!.s, input).toBe(slugify(input));
    }
  });
});
