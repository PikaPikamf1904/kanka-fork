-- Chronicle live RLS check. Safe to run on the live project in the SQL Editor.
--
-- Everything happens inside ONE transaction that is always rolled back: it creates synthetic
-- users and synthetic content, queries them as anon / outsider / revoked player / player / DM /
-- DM-with-MFA (aal1 and aal2) / server key, and finally raises an error whose message holds the
-- results. Because of that error, nothing is saved. Do not remove the final RAISE.
--
-- Expected results are listed in docs/security/rls-test-matrix.md ("Live check").

do $test$
declare
  r jsonb := '{}'::jsonb;
  t text;
  n int;
  dm uuid := '00000000-0000-4000-8000-0000000000d1';
  dmm uuid := '00000000-0000-4000-8000-0000000000d2';
  pl uuid := '00000000-0000-4000-8000-000000000001';
  rv uuid := '00000000-0000-4000-8000-000000000002';
  ou uuid := '00000000-0000-4000-8000-000000000003';
  A uuid := 'a0000000-0000-4000-8000-00000000000a';
  B uuid := 'a0000000-0000-4000-8000-00000000000b';
  D uuid := 'a0000000-0000-4000-8000-00000000000d';
  E uuid := 'a0000000-0000-4000-8000-00000000000e';
begin
  -- Synthetic fixture (rolled back at the end).
  insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', dm, 'authenticated', 'authenticated', 'dm@test.chronicle.invalid', now(), now()),
    ('00000000-0000-0000-0000-000000000000', dmm, 'authenticated', 'authenticated', 'dmm@test.chronicle.invalid', now(), now()),
    ('00000000-0000-0000-0000-000000000000', pl, 'authenticated', 'authenticated', 'pl@test.chronicle.invalid', now(), now()),
    ('00000000-0000-0000-0000-000000000000', rv, 'authenticated', 'authenticated', 'rv@test.chronicle.invalid', now(), now()),
    ('00000000-0000-0000-0000-000000000000', ou, 'authenticated', 'authenticated', 'ou@test.chronicle.invalid', now(), now());
  insert into public.campaign_members (user_id, role, display_name, revoked_at) values
    (dm, 'dm', 'DM', null), (dmm, 'dm', 'DM MFA', null), (pl, 'player', 'Player', null), (rv, 'player', 'Revoked', now());
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
    values (gen_random_uuid(), dmm, 'test', 'totp', 'verified', now(), now(), 'x');
  insert into public.articles (id, slug, type, title, summary, visibility, status) values
    (A, 'public-article', 'character', 'Visible Captain', 'A captain.', 'players', 'published'),
    (B, 'secret-article', 'character', 'Hidden Spymaster', 'SPYMASTERWORD', 'dm', 'published'),
    ('a0000000-0000-4000-8000-00000000000c', 'draft-article', 'location', 'Unfinished Keep', 'x', 'players', 'draft'),
    (D, 'public-two', 'location', 'Harbour Town', 'Town.', 'players', 'published'),
    (E, 'public-three', 'faction', 'Quiet Guild', 'Guild.', 'players', 'published');
  insert into public.article_sections (article_id, position, heading, body, visibility, status) values
    (A, 1, 'Known history', 'Sails from [[public-two]] and met [[Secret Article]]. Lighthousewords.', 'players', 'published'),
    (A, 2, 'True allegiance', 'SECRETWORD reports to [[public-three]]. Lighthousewords.', 'dm', 'published'),
    (A, 3, 'Next session', 'DRAFTWORD', 'players', 'draft'),
    (B, 1, 'Bio', 'HIDDENARTICLEWORD', 'players', 'published');
  insert into public.infobox_fields (article_id, position, label, value, visibility) values
    (A, 1, 'Race', 'Human', 'players'), (A, 2, 'True identity', 'INFOBOXSECRET', 'dm');
  insert into public.dm_notes (article_id, title, body) values (A, 'Plan', 'NOTEWORD');
  insert into public.categories (id, slug, name, visibility) values
    ('c0000000-0000-4000-8000-000000000001', 'sailors', 'Sailors', 'players'),
    ('c0000000-0000-4000-8000-000000000002', 'traitors', 'Traitors', 'dm');
  insert into public.article_categories values (A, 'c0000000-0000-4000-8000-000000000001'), (A, 'c0000000-0000-4000-8000-000000000002'), (B, 'c0000000-0000-4000-8000-000000000001');
  insert into public.redirects values ('old-captain-name', A, 'players'), ('traitor-captain', A, 'dm');
  insert into public.relations (source_article_id, target_article_id, kind, visibility) values
    (A, D, 'resides_in', 'players'), (A, B, 'knows', 'players'), (A, E, 'serves', 'dm');
  insert into public.timeline_events (title, sort_key, visibility, status, article_id) values
    ('Visible event', 1, 'players', 'published', null), ('TIMELINESECRET', 2, 'dm', 'published', null),
    ('Draft event', 3, 'players', 'draft', null), ('Hidden person event', 4, 'players', 'published', B);
  insert into public.maps (id, slug, title, visibility, status) values
    ('d0000000-0000-4000-8000-000000000001', 'world', 'World', 'players', 'published'),
    ('d0000000-0000-4000-8000-000000000002', 'dragon-nest', 'Dragon Nest', 'dm', 'published');
  insert into public.map_markers (map_id, x, y, label, visibility, article_id) values
    ('d0000000-0000-4000-8000-000000000001', 1, 1, 'Harbour', 'players', null),
    ('d0000000-0000-4000-8000-000000000001', 2, 2, 'MARKERSECRET', 'dm', null),
    ('d0000000-0000-4000-8000-000000000001', 3, 3, 'Spy house', 'players', B),
    ('d0000000-0000-4000-8000-000000000002', 4, 4, 'Nest door', 'players', null);
  insert into public.media (path, visibility) values ('public/harbour.webp', 'players'), ('dm/nest-plan.webp', 'dm');
  insert into public.access_codes (id, label, code_hash) values
    ('e0000000-0000-4000-8000-000000000001', 'Test', extensions.crypt('correct horse battery', extensions.gen_salt('bf', 4)));

  -- anon
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin perform 1 from public.articles; r := r || '{"anon_articles":"READABLE"}'; exception when insufficient_privilege then r := r || '{"anon_articles":"denied"}'; end;
  begin perform public.search_wiki('captain'); r := r || '{"anon_search":"READABLE"}'; exception when insufficient_privilege then r := r || '{"anon_search":"denied"}'; end;
  begin perform 1 from public.campaign_settings; r := r || '{"anon_settings":"READABLE"}'; exception when insufficient_privilege then r := r || '{"anon_settings":"denied"}'; end;
  execute 'reset role';

  -- outsider and revoked
  foreach t in array array['ou', 'rv'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', case t when 'ou' then ou else rv end, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    execute 'set local role authenticated';
    select (select count(*) from public.articles) + (select count(*) from public.article_sections) + (select count(*) from public.campaign_settings)
      + (select count(*) from public.categories) + (select count(*) from public.maps) + (select count(*) from public.search_wiki('captain')) into n;
    r := r || jsonb_build_object(t || '_rows_visible', n);
    execute 'reset role';
  end loop;

  -- player (with forged role claims in user_metadata and app_metadata)
  perform set_config('request.jwt.claims', json_build_object('sub', pl, 'role', 'authenticated', 'aal', 'aal1', 'user_metadata', json_build_object('role', 'dm'), 'app_metadata', json_build_object('role', 'dm'))::text, true);
  execute 'set local role authenticated';
  r := r || jsonb_build_object(
    'p_articles', (select jsonb_agg(slug order by slug) from public.articles),
    'p_sections_A', (select jsonb_agg(heading) from public.article_sections where article_id = A),
    'p_sections_B', (select count(*) from public.article_sections where article_id = B),
    'p_infobox', (select jsonb_agg(label) from public.infobox_fields),
    'p_dm_notes', (select count(*) from public.dm_notes),
    'p_revisions', (select count(*) from public.revisions),
    'p_codes', (select count(*) from public.access_codes),
    'p_categories', (select jsonb_agg(slug) from public.categories),
    'p_category_counts', (select jsonb_agg(jsonb_build_object(slug, article_count)) from public.category_counts()),
    'p_relations', (select jsonb_agg(kind) from public.relations),
    'p_backlinks_D', (select jsonb_agg(slug) from public.backlinks(D)),
    'p_backlinks_E', (select count(*) from public.backlinks(E)),
    'p_redirects', (select jsonb_agg(from_slug) from public.redirects),
    'p_resolve_dm_redirect', (select count(*) from public.resolve_slug('traitor-captain')),
    'p_timeline', (select jsonb_agg(title) from public.timeline_events),
    'p_maps', (select jsonb_agg(slug) from public.maps),
    'p_markers', (select jsonb_agg(label) from public.map_markers),
    'p_media', (select jsonb_agg(path) from public.media),
    'p_search_secret_hits', (select count(*) from public.search_wiki('SECRETWORD OR DRAFTWORD OR SPYMASTERWORD OR HIDDENARTICLEWORD')),
    'p_search_shared_snippet_leaks', (select count(*) from public.search_wiki('Lighthousewords') where snippet like '%SECRETWORD%'),
    'p_suggest_hidden', (select count(*) from public.suggest_articles('Hidden'))
  );
  begin perform code_hash from public.access_codes; r := r || '{"p_code_hash":"READABLE"}'; exception when insufficient_privilege then r := r || '{"p_code_hash":"denied"}'; end;
  begin insert into public.articles (slug, title) values ('x', 'X'); r := r || '{"p_insert":"ALLOWED"}'; exception when insufficient_privilege then r := r || '{"p_insert":"denied"}'; end;
  update public.articles set title = 'Hacked' where id = A; get diagnostics n = row_count; r := r || jsonb_build_object('p_update_rows', n);
  update public.article_sections set visibility = 'players' where article_id = A; get diagnostics n = row_count; r := r || jsonb_build_object('p_reveal_rows', n);
  begin update public.campaign_members set role = 'dm' where user_id = pl; r := r || '{"p_promote":"ALLOWED"}'; exception when insufficient_privilege then r := r || '{"p_promote":"denied"}'; end;
  begin perform public.begin_enrollment('correct horse battery', 'abcdefabcdefabcdef'); r := r || '{"p_enroll_fn":"ALLOWED"}'; exception when insufficient_privilege then r := r || '{"p_enroll_fn":"denied"}'; end;
  begin perform public.create_access_code('a-very-long-code'); r := r || '{"p_create_code":"ALLOWED"}'; exception when insufficient_privilege then r := r || '{"p_create_code":"denied"}'; end;
  begin perform public.preview_article_as_player('public-article'); r := r || '{"p_preview":"ALLOWED"}'; exception when insufficient_privilege then r := r || '{"p_preview":"denied"}'; end;
  execute 'reset role';

  -- DM, and a DM with MFA at aal1 and aal2
  perform set_config('request.jwt.claims', json_build_object('sub', dm, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  r := r || jsonb_build_object(
    'dm_articles', (select count(*) from public.articles),
    'dm_notes', (select count(*) from public.dm_notes),
    'dm_markers', (select count(*) from public.map_markers),
    'dm_preview_sections', (select public.preview_article_as_player('public-article') -> 'sections'),
    'dm_preview_hidden', (select public.preview_article_as_player('secret-article') -> 'visible'));
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', dmm, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  r := r || jsonb_build_object('mfa_aal1_notes', (select count(*) from public.dm_notes), 'mfa_aal1_articles', (select count(*) from public.articles));
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', dmm, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  r := r || jsonb_build_object('mfa_aal2_notes', (select count(*) from public.dm_notes));
  execute 'reset role';

  -- Audit fixes (migration 20261109000600): DM cannot revoke a DM row, uploads start DM-only,
  -- and an image is visible to players only while its article is published to them.
  perform set_config('request.jwt.claims', json_build_object('sub', dm, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  begin update public.campaign_members set revoked_at = now() where user_id = dm; r := r || '{"dm_self_revoke":"ALLOWED"}'; exception when insufficient_privilege then r := r || '{"dm_self_revoke":"denied"}'; end;
  begin insert into public.media (path, visibility) values ('media/live-check-public.webp', 'players'); r := r || '{"dm_media_insert_players":"ALLOWED"}'; exception when insufficient_privilege then r := r || '{"dm_media_insert_players":"denied"}'; end;
  insert into public.media (path) values ('media/live-check.webp');
  update public.articles set hero_media_id = (select id from public.media where path = 'media/live-check.webp') where id = A;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', pl, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  r := r || jsonb_build_object('p_media_published_hero', (select count(*) from public.media where path = 'media/live-check.webp'));
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', dm, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  update public.articles set status = 'draft' where id = A;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', pl, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  r := r || jsonb_build_object('p_media_unpublished_hero', (select count(*) from public.media where path = 'media/live-check.webp'));
  execute 'reset role';

  -- Server key (service_role): enrollment checks
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  r := r || jsonb_build_object(
    'svc_wrong_code', (select public.begin_enrollment('wrong code', 'ip-hash-live-test-0001') ->> 'status'),
    'svc_right_code', (select public.begin_enrollment('correct horse battery', 'ip-hash-live-test-0002') ->> 'status'));
  execute 'reset role';

  -- Always abort, so none of the above is saved.
  raise exception 'CHRONICLE_LIVE_TEST_RESULTS %', r;
end
$test$;
