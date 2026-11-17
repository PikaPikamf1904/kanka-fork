// Personal invitations, one identity per player, and per-device revocation (20261117000500).
// Synthetic users only. The server-side steps run as service_role, exactly as /api/join does.
import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, as, ids, pool, resetFixtures } from './helpers.ts';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const IP = 'a'.repeat(64);
const NEW_USER = '00000000-0000-4000-8000-0000000000e1';
const SESSION_A = '5e550000-0000-4000-8000-00000000000a';
const SESSION_B = '5e550000-0000-4000-8000-00000000000b';
const VISIBLE = 'a0000000-0000-4000-8000-00000000000a';

async function invite(name: string, member: string | null = null, days = 7) {
  const r = await as<{ inv: { id: string; token: string } }>('dm', 'select public.create_player_invitation($1, $2, $3) as inv', [name, member, days]);
  expect(r.error).toBeUndefined();
  return r.rows[0]!.inv;
}

/** Create an invitation and keep it (as() always rolls back). */
async function inviteCommitted(name: string, member: string | null = null, days = 7): Promise<{ id: string; token: string }> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ids.dm, role: 'authenticated', aud: 'authenticated', aal: 'aal1' }),
    ]);
    const r = await client.query<{ inv: { id: string; token: string } }>('select public.create_player_invitation($1, $2, $3) as inv', [name, member, days]);
    await client.query('commit');
    return r.rows[0]!.inv;
  } finally {
    client.release();
  }
}

async function serviceCall<T>(sql: string, params: unknown[]): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role service_role');
    const r = await client.query(sql, params);
    await client.query('commit');
    return r.rows[0] as T;
  } finally {
    client.release();
  }
}
const begin = (token: string, claim: boolean, ip = IP) =>
  serviceCall<{ r: { status: string; invitation_id?: string; display_name?: string; member_user_id?: string | null } }>(
    'select public.begin_player_invitation($1, $2, $3) as r', [sha(token), ip, claim]).then((x) => x.r);
const finish = (inv: string, user: string, session: string) =>
  serviceCall<{ r: string }>('select public.finish_player_invitation($1, $2, $3, $4) as r', [inv, user, session, 'Safari on iPhone']).then((x) => x.r);

beforeEach(async () => {
  await resetFixtures();
  await admin('delete from public.member_devices');
  await admin('delete from public.player_invitations');
  await admin('delete from auth.users where id = $1', [NEW_USER]);
  await admin(
    `insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', 'player-new@players.chronicle.invalid', now(), now())`,
    [NEW_USER],
  );
});
afterAll(async () => {
  await admin('delete from public.member_devices');
  await admin('delete from public.player_invitations');
  await admin('delete from auth.users where id = $1', [NEW_USER]);
  await pool.end();
});

describe('creating invitations', () => {
  it('only the DM on the website creates them; the token is returned once and only its hash is stored', async () => {
    const inv = await invite('Eliza');
    expect(inv.token).toMatch(/^[0-9a-f]{64}$/);
    for (const who of ['player', 'revoked', 'outsider', 'anon'] as const) {
      expect((await as(who, `select public.create_player_invitation('Mallory')`)).error?.code).toBe('42501');
    }
    const oauth = await as('dm', `select public.create_player_invitation('Mallory')`, [], { extra: { client_id: 'assistant' } });
    expect(oauth.error?.code).toBe('42501');

    const kept = await inviteCommitted('Sybil');
    const stored = await admin<{ token_hash: string }>('select token_hash from public.player_invitations where id = $1', [kept.id]);
    expect(stored.rows[0]!.token_hash).toBe(sha(kept.token));
    expect(stored.rows[0]!.token_hash).not.toContain(kept.token);
    // Nobody, not even the DM, can read the hash back through the API.
    expect((await as('dm', 'select token_hash from public.player_invitations')).error?.code).toBe('42501');
    expect((await as('dm', 'select display_name from public.player_invitations')).rows).toEqual([{ display_name: 'Sybil' }]);
    expect((await as('player', 'select display_name from public.player_invitations')).rows).toEqual([]);
  });

  it('can never reach a DM, a removed player, or a nonsense lifetime', async () => {
    expect((await as('dm', 'select public.create_player_invitation(null, $1)', [ids.dmMfa])).error?.message).toMatch(/cannot receive/);
    expect((await as('dm', 'select public.create_player_invitation(null, $1)', [ids.revoked])).error?.message).toMatch(/cannot receive/);
    expect((await as('dm', `select public.create_player_invitation('Eliza', null, 90)`)).error?.code).toBe('22023');
    await expect(admin(`insert into public.player_invitations (display_name, token_hash, expires_at, role) values ('X', $1, now(), 'dm')`, [sha('x')]))
      .rejects.toThrow(/check constraint/);
  });
});

describe('joining', () => {
  it('a link works once: preview uses nothing, the claim is single-use, and the player is created as a player', async () => {
    const inv = await inviteCommitted('Eliza');
    expect(await begin(inv.token, false)).toMatchObject({ status: 'ok', display_name: 'Eliza', member_user_id: null });
    expect(await begin(inv.token, false)).toMatchObject({ status: 'ok' });
    const claimed = await begin(inv.token, true);
    expect(claimed.status).toBe('ok');
    expect(await begin(inv.token, true)).toEqual({ status: 'invalid' });
    expect(await finish(claimed.invitation_id!, NEW_USER, SESSION_A)).toBe('joined');
    const member = await admin('select role, display_name, revoked_at from public.campaign_members where user_id = $1', [NEW_USER]);
    expect(member.rows).toEqual([{ role: 'player', display_name: 'Eliza', revoked_at: null }]);
    // Finishing twice does nothing more.
    expect(await finish(claimed.invitation_id!, NEW_USER, SESSION_B)).toBe('invalid');
  });

  it('a second invitation for the same player signs the same account in and records a second device', async () => {
    const first = await inviteCommitted('Eliza');
    const c1 = await begin(first.token, true);
    await finish(c1.invitation_id!, NEW_USER, SESSION_A);
    const second = await inviteCommitted('', NEW_USER);
    const c2 = await begin(second.token, true);
    expect(c2.member_user_id).toBe(NEW_USER);
    // Someone else's account cannot use it.
    expect(await finish(c2.invitation_id!, ids.player, SESSION_B)).toBe('invalid');
    expect(await finish(c2.invitation_id!, NEW_USER, SESSION_B)).toBe('joined');
    const devices = await admin('select session_id from public.member_devices where user_id = $1 order by created_at', [NEW_USER]);
    expect(devices.rows.map((r) => r.session_id)).toEqual([SESSION_A, SESSION_B]);
    expect((await admin('select count(*)::int as n from public.campaign_members where user_id = $1', [NEW_USER])).rows[0]!.n).toBe(1);
  });

  it('expired, revoked, replaced and removed-player links fail', async () => {
    const expired = await inviteCommitted('Old');
    await admin(`update public.player_invitations set expires_at = now() - interval '1 minute' where id = $1`, [expired.id]);
    expect((await begin(expired.token, false)).status).toBe('invalid');

    const revoked = await inviteCommitted('Charity');
    await admin('update public.player_invitations set revoked_at = now() where id = $1', [revoked.id]);
    expect((await begin(revoked.token, false)).status).toBe('invalid');

    const replaced = await inviteCommitted('Weston');
    await inviteCommitted('weston');
    expect((await begin(replaced.token, false)).status).toBe('invalid');

    const bound = await inviteCommitted('', ids.player);
    await admin('update public.campaign_members set revoked_at = now() where user_id = $1', [ids.player]);
    expect((await begin(bound.token, false)).status).toBe('invalid');
  });

  it('a released claim can be tried again; guessing is rate-limited', async () => {
    const inv = await inviteCommitted('Eliza');
    const c = await begin(inv.token, true);
    await serviceCall('select public.release_player_invitation($1)', [c.invitation_id]);
    expect((await begin(inv.token, true)).status).toBe('ok');

    const guesser = 'b'.repeat(64);
    for (let i = 0; i < 5; i++) expect((await begin('f'.repeat(64), false, guesser)).status).toBe('invalid');
    expect((await begin('f'.repeat(64), false, guesser)).status).toBe('rate_limited');
  });

  it('only the server can run the join steps', async () => {
    for (const who of ['dm', 'player', 'anon'] as const) {
      expect((await as(who, 'select public.begin_player_invitation($1, $2, true)', [sha('x'), IP])).error?.code).toBe('42501');
      expect((await as(who, 'select public.finish_player_invitation($1, $2, $3, $4)', [NEW_USER, NEW_USER, SESSION_A, 'x'])).error?.code).toBe('42501');
      expect((await as(who, 'select public.release_player_invitation($1)', [NEW_USER])).error?.code).toBe('42501');
    }
  });
});

describe('devices', () => {
  beforeEach(async () => {
    await admin(`insert into public.member_devices (user_id, session_id, label) values ($1, $2, 'Phone'), ($1, $3, 'Laptop')`, [ids.player, SESSION_A, SESSION_B]);
  });
  const onDevice = (session: string) => ({ extra: { session_id: session } });

  it('a revoked device loses all access at once; the player\'s other devices keep it', async () => {
    const readVisible = (session: string) => as('player', 'select id from public.articles where id = $1', [VISIBLE], onDevice(session));
    expect((await readVisible(SESSION_A)).rows).toHaveLength(1);
    expect((await as('player', 'select public.touch_device() as s', [], onDevice(SESSION_A))).rows[0]).toEqual({ s: 'ok' });

    await admin('update public.member_devices set revoked_at = now() where session_id = $1', [SESSION_A]);
    expect((await readVisible(SESSION_A)).rows).toHaveLength(0);
    expect((await as('player', 'select private.is_member() as m', [], onDevice(SESSION_A))).rows[0]).toEqual({ m: false });
    expect((await as('player', 'select public.touch_device() as s', [], onDevice(SESSION_A))).rows[0]).toEqual({ s: 'revoked' });
    expect((await readVisible(SESSION_B)).rows).toHaveLength(1);
    // Sessions that never joined by invitation (access-code devices, the DM) are unaffected.
    expect((await as('player', 'select id from public.articles where id = $1', [VISIBLE])).rows).toHaveLength(1);
    expect((await as('player', 'select public.touch_device() as s')).rows[0]).toEqual({ s: 'untracked' });
  });

  it('the DM sees and revokes any device; a player only their own; others nothing', async () => {
    const dev = await admin<{ id: string }>('select id from public.member_devices where session_id = $1', [SESSION_A]);
    const id = dev.rows[0]!.id;
    expect((await as('dm', 'select label from public.member_devices order by label')).rows).toEqual([{ label: 'Laptop' }, { label: 'Phone' }]);
    expect((await as('player', 'select label from public.member_devices order by label', [], onDevice(SESSION_B))).rows).toHaveLength(2);
    expect((await as('outsider', 'select label from public.member_devices')).rows).toEqual([]);
    expect((await as('dm', 'select invitation_id from public.member_devices')).error?.code).toBe('42501');

    expect((await as('outsider', 'select public.revoke_member_device($1)', [id])).error?.code).toBe('42501');
    expect((await as('dm', 'select public.revoke_member_device($1)', [id], { extra: { client_id: 'assistant' } })).error?.code).toBe('42501');
    expect((await as('player', 'select public.revoke_member_device($1)', [id], onDevice(SESSION_B))).error).toBeUndefined();
    expect((await as('dm', 'select public.revoke_member_device($1)', [id])).error).toBeUndefined();
    // Players cannot write the table directly.
    expect((await as('player', 'update public.member_devices set revoked_at = null', [], onDevice(SESSION_B))).error?.code).toBe('42501');
  });
});
