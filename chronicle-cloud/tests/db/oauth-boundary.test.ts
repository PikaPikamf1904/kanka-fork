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

// CH-101: A DM's OAuth token has the same user identity as their website token,
// but must not inherit the website's direct write privileges. The assistant's
// permitted write path is a separately approved apply_change_set call.
const directContentMutations: [string, string][] = [
  ['campaign settings', "update public.campaign_settings set tagline = 'OAuth edit' where id = true returning id"],
  ['article', "update public.articles set summary = 'OAuth edit' where slug = 'secret-article' returning id"],
  ['section', "update public.article_sections set body = 'OAuth edit' where id = '50000000-0000-4000-8000-000000000002' returning id"],
  ['infobox', "update public.infobox_fields set value = 'OAuth edit' where label = 'True identity' returning id"],
  ['DM note', "delete from public.dm_notes where title = 'Plan' returning id"],
  ['category', "update public.categories set description = 'OAuth edit' where slug = 'traitors' returning id"],
  ['article category', "delete from public.article_categories where article_id = 'a0000000-0000-4000-8000-00000000000a' and category_id = 'c0000000-0000-4000-8000-000000000002' returning article_id"],
  ['redirect', "update public.redirects set from_slug = 'oauth-redirect' where from_slug = 'traitor-captain' returning article_id"],
  ['relation', "update public.relations set label = 'OAuth edit' where kind = 'serves' returning id"],
  ['timeline', "update public.timeline_events set title = 'OAuth edit' where sort_key = 2 returning id"],
  ['map', "update public.maps set title = 'OAuth edit' where slug = 'dragon-nest' returning id"],
  ['map marker', "update public.map_markers set label = 'OAuth edit' where label = 'MARKERSECRET cave' returning id"],
  ['map fog', "update public.map_fog_areas set label = 'OAuth edit' where label = 'FOGSECRET cove' returning id"],
  ['media metadata', "update public.media set alt = 'OAuth edit' where path = 'dm/nest-plan.webp' returning id"],
  ['new category', "insert into public.categories (slug, name) values ('oauth-category', 'OAuth category') returning id"],
];

describe('OAuth direct content writes (CH-101 regression)', () => {
  it.each(directContentMutations)('rejects direct %s mutation', async (_name, sql) => {
    const result = await as('dm', sql, [], oauth);
    // Restrictive RLS can filter an UPDATE/DELETE to zero rows; other boundaries
    // may produce an explicit permission error. Neither may change a row.
    expect(Boolean(result.error) || result.rowCount === 0).toBe(true);
  });

  it.each(directContentMutations)('preserves the website %s mutation', async (_name, sql) => {
    const result = await as('dm', sql);
    expect(result.error).toBeUndefined();
    expect(result.rowCount).toBe(1);
  });

  it('rejects OAuth snapshot creation while keeping the website snapshot available', async () => {
    const query = "select public.snapshot_article('a0000000-0000-4000-8000-00000000000b')";
    expect((await as('dm', query, [], oauth)).error).toBeDefined();
    expect((await as('dm', query)).error).toBeUndefined();
  });
});
