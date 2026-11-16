// Database test harness. Connects to the LOCAL stack only (scripts/local-stack.sh up).
// Fixtures are written as the superuser; every assertion runs inside a transaction that switches
// to the `anon` or `authenticated` role with JWT claims, exactly like PostgREST does, and is
// rolled back afterwards.
import pg from 'pg';
import { assertDatabaseUrl, localAdminUrl } from '../../scripts/local-targets.mjs';

const url = process.env.CHRONICLE_TEST_DB_URL ?? localAdminUrl;
assertDatabaseUrl(url);

export const pool = new pg.Pool({ connectionString: url, max: 4 });

export const ids = {
  dm: '00000000-0000-4000-8000-0000000000d1',
  dmMfa: '00000000-0000-4000-8000-0000000000d2',
  player: '00000000-0000-4000-8000-000000000001',
  revoked: '00000000-0000-4000-8000-000000000002',
  outsider: '00000000-0000-4000-8000-000000000003',
  newDevice: '00000000-0000-4000-8000-000000000004',
} as const;

export type Who = keyof typeof ids | 'anon';

export interface ClaimsOverride {
  aal?: 'aal1' | 'aal2';
  extra?: Record<string, unknown>;
}

export async function admin<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  return pool.query<T>(sql, params);
}

/**
 * Run queries as a given user. Errors are returned, not thrown, so tests can assert on them.
 */
export async function as<T extends pg.QueryResultRow = pg.QueryResultRow>(
  who: Who,
  sql: string,
  params: unknown[] = [],
  claims: ClaimsOverride = {},
): Promise<{ rows: T[]; rowCount: number; error?: { code?: string; message: string } }> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (who === 'anon') {
      await client.query('set local role anon');
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'anon' })]);
    } else {
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({
          sub: ids[who],
          role: 'authenticated',
          aud: 'authenticated',
          aal: claims.aal ?? 'aal1',
          is_anonymous: false,
          ...claims.extra,
        }),
      ]);
    }
    try {
      const result = await client.query<T>(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    } catch (error) {
      const e = error as { code?: string; message: string };
      return { rows: [], rowCount: 0, error: { code: e.code, message: e.message } };
    }
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

/** Run as the server's secret key (service_role), which bypasses RLS. */
export async function asService<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role service_role');
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'service_role' })]);
    const result = await client.query<T>(sql, params);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const contentTables = [
  'revisions', 'map_fog_areas', 'map_markers', 'maps', 'timeline_events', 'relations', 'redirects', 'article_links',
  'article_categories', 'categories', 'dm_notes', 'infobox_fields', 'article_sections', 'articles',
  'enrollment_attempts', 'campaign_members', 'access_codes',
];

/** Wipe local test data and load the fixture world. */
export async function resetFixtures() {
  await admin(`truncate ${contentTables.map((t) => `public.${t}`).join(', ')} cascade`);
  // The settings row references articles (current location), so the cascade above can remove it.
  await admin(`insert into public.campaign_settings (id) values (true) on conflict (id) do nothing`);
  await admin(`update public.campaign_settings set banner_media_id = null, current_location_id = null, current_status = ''`);
  await admin(`delete from storage.objects where bucket_id = 'chronicle-media'`);
  await admin(`delete from public.media`);
  await admin(`delete from auth.mfa_factors where user_id = any($1::uuid[])`, [Object.values(ids)]);
  await admin(`delete from auth.users where id = any($1::uuid[])`, [Object.values(ids)]);
  // Devices created by enrollment tests.
  await admin(`delete from auth.users where email like 'player-%@players.chronicle.invalid'`);

  for (const [name, id] of Object.entries(ids)) {
    await admin(
      `insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), now())`,
      [id, `${name.toLowerCase()}@test.chronicle.invalid`],
    );
  }
  await admin(
    `insert into public.campaign_members (user_id, role, display_name, revoked_at) values
       ($1, 'dm', 'Test DM', null),
       ($2, 'dm', 'Test DM with MFA', null),
       ($3, 'player', 'Test Player', null),
       ($4, 'player', 'Revoked Player', now())`,
    [ids.dm, ids.dmMfa, ids.player, ids.revoked],
  );
  await admin(
    `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
     values (gen_random_uuid(), $1, 'test', 'totp', 'verified', now(), now(), 'test-secret')`,
    [ids.dmMfa],
  );

  await admin(`
    insert into public.articles (id, slug, type, title, summary, visibility, status) values
      ('a0000000-0000-4000-8000-00000000000a', 'public-article', 'character', 'Visible Captain', 'A captain the party has met.', 'players', 'published'),
      ('a0000000-0000-4000-8000-00000000000b', 'secret-article', 'character', 'Hidden Spymaster', 'SPYMASTERWORD summary', 'dm', 'published'),
      ('a0000000-0000-4000-8000-00000000000c', 'draft-article', 'location', 'Unfinished Keep', 'Not ready', 'players', 'draft'),
      ('a0000000-0000-4000-8000-00000000000d', 'public-two', 'location', 'Harbour Town', 'A town by the sea.', 'players', 'published'),
      ('a0000000-0000-4000-8000-00000000000e', 'public-three', 'faction', 'Quiet Guild', 'A guild.', 'players', 'published');

    insert into public.article_sections (id, article_id, position, heading, body, visibility, status) values
      ('50000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 1, 'Known history',
        'The captain sails from [[public-two|Harbour Town]] and once met [[Secret Article]]. Lighthousewords.', 'players', 'published'),
      ('50000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 2, 'True allegiance',
        'SECRETWORD: the captain reports to [[public-three]]. Lighthousewords.', 'dm', 'published'),
      ('50000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-00000000000a', 3, 'Next session',
        'DRAFTWORD reveal planned.', 'players', 'draft'),
      ('50000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-00000000000b', 1, 'Biography',
        'HIDDENARTICLEWORD body.', 'players', 'published');

    insert into public.infobox_fields (article_id, position, label, value, visibility) values
      ('a0000000-0000-4000-8000-00000000000a', 1, 'Race', 'Human', 'players'),
      ('a0000000-0000-4000-8000-00000000000a', 2, 'True identity', 'INFOBOXSECRET', 'dm');

    insert into public.dm_notes (article_id, title, body) values
      ('a0000000-0000-4000-8000-00000000000a', 'Plan', 'NOTEWORD: betrayal in session 12');

    insert into public.categories (id, slug, name, visibility) values
      ('c0000000-0000-4000-8000-000000000001', 'sailors', 'Sailors', 'players'),
      ('c0000000-0000-4000-8000-000000000002', 'traitors', 'Traitors', 'dm');
    insert into public.article_categories (article_id, category_id) values
      ('a0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000001'),
      ('a0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000002'),
      ('a0000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-000000000001');

    insert into public.redirects (from_slug, article_id, visibility) values
      ('old-captain-name', 'a0000000-0000-4000-8000-00000000000a', 'players'),
      ('traitor-captain', 'a0000000-0000-4000-8000-00000000000a', 'dm');

    insert into public.relations (source_article_id, target_article_id, kind, label, visibility) values
      ('a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000d', 'resides_in', 'Lives in', 'players'),
      ('a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000b', 'knows', 'Knows', 'players'),
      ('a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000e', 'serves', 'Secretly serves', 'dm');

    insert into public.timeline_events (title, sort_key, visibility, status, article_id) values
      ('Visible event', 1, 'players', 'published', null),
      ('TIMELINESECRET event', 2, 'dm', 'published', null),
      ('Draft event', 3, 'players', 'draft', null),
      ('Event about hidden person', 4, 'players', 'published', 'a0000000-0000-4000-8000-00000000000b');

    insert into public.maps (id, slug, title, visibility, status) values
      ('d0000000-0000-4000-8000-000000000001', 'world', 'World', 'players', 'published'),
      ('d0000000-0000-4000-8000-000000000002', 'dragon-nest', 'Dragon Nest', 'dm', 'published');
    update public.maps set fog_enabled = true where id in ('d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002');
    insert into public.map_fog_areas (map_id, label, points, visibility) values
      ('d0000000-0000-4000-8000-000000000001', 'Harbour district', '[[0,0],[40,0],[40,40]]', 'players'),
      ('d0000000-0000-4000-8000-000000000001', 'FOGSECRET cove', '[[50,50],[90,50],[90,90]]', 'dm'),
      ('d0000000-0000-4000-8000-000000000002', 'FOGNEST entrance', '[[1,1],[9,1],[9,9]]', 'players');
    insert into public.map_markers (map_id, x, y, label, visibility, article_id) values
      ('d0000000-0000-4000-8000-000000000001', 10, 10, 'Harbour', 'players', null),
      ('d0000000-0000-4000-8000-000000000001', 20, 20, 'MARKERSECRET cave', 'dm', null),
      ('d0000000-0000-4000-8000-000000000001', 30, 30, 'Spymaster house', 'players', 'a0000000-0000-4000-8000-00000000000b'),
      ('d0000000-0000-4000-8000-000000000002', 40, 40, 'Nest entrance', 'players', null);

    insert into public.media (path, visibility) values ('public/harbour.webp', 'players'), ('dm/nest-plan.webp', 'dm');
    insert into storage.objects (bucket_id, name) values
      ('chronicle-media', 'public/harbour.webp'), ('chronicle-media', 'dm/nest-plan.webp'),
      ('chronicle-media', 'orphan/no-media-row.webp');
  `);
  await admin(
    `insert into public.access_codes (id, label, code_hash) values
       ('e0000000-0000-4000-8000-000000000001', 'Table code', extensions.crypt('correct horse battery', extensions.gen_salt('bf', 4)))`,
  );
}

export const columns = <T extends pg.QueryResultRow, K extends keyof T>(rows: T[], key: K) =>
  rows.map((row) => row[key]).sort();
