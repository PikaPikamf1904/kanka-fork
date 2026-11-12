import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, ids, pool, resetFixtures } from './helpers.ts';

const oauth = { extra: { client_id: 'synthetic-oauth-client' } };
beforeEach(resetFixtures);
afterAll(() => pool.end());

describe('OAuth access-management boundary', () => {
  it('rejects direct membership edits', async () => {
    const edit = await as('dm', 'update public.campaign_members set revoked_at = now() where user_id = $1 returning user_id', [ids.player], oauth);
    expect(edit.rowCount).toBe(0);
  });

  it('rejects OAuth calls to security-definer administrative RPCs', async () => {
    const calls: [string, unknown[]][] = [
      ["select public.create_access_code('synthetic-test-code')", []],
      ["select public.rotate_access_code('synthetic-test-code')", []],
      ["select public.revoke_access_code($1)", ['e0000000-0000-4000-8000-000000000001']],
      ["select public.revoke_member($1)", [ids.player]],
      ["select public.revoke_all_players()", []],
    ];
    for (const [sql, args] of calls) expect((await as('dm', sql, args, oauth)).error, sql).toBeDefined();
  });

  it('does not treat an OAuth client literally named web as a website session', async () => {
    const r = await as('dm', "select public.create_access_code('synthetic-test-code')", [], { extra: { client_id: 'web' } });
    expect(r.error).toBeDefined();
  });

  it('also rejects the alternate client claim and rejects access RPCs at both MFA levels', async () => {
    const alt = await as('dm', "select public.revoke_all_players()", [], { extra: { chronicle_client: 'synthetic-client' } });
    expect(alt.error).toBeDefined();
    for (const aal of ['aal1', 'aal2'] as const) {
      const r = await as('dmMfa', "select public.revoke_member($1)", [ids.player], { aal, extra: { client_id: 'synthetic-client' } });
      expect(r.error).toBeDefined();
    }
  });

  it('keeps website access management available and still checks MFA and membership', async () => {
    expect((await as('dm', "select public.create_access_code('synthetic-test-code')")).error).toBeUndefined();
    expect((await as('dmMfa', "select public.create_access_code('synthetic-test-code')")).error).toBeDefined();
    expect((await as('dmMfa', "select public.create_access_code('synthetic-test-code')", [], { aal: 'aal2' })).error).toBeUndefined();
    expect((await as('revoked', "select public.create_access_code('synthetic-test-code')")).error).toBeDefined();
  });
});
