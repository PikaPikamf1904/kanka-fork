-- Chronicle cloud: fixes for the four defects found in the audit (tests/db/audit.test.ts).
--
--   1. Media visibility follows usage. An image is readable by players only while it is the main
--      image of a published player article, the image of a published player map, or the cover
--      banner. Kept in step by triggers in the same transaction as the page change, so the browser
--      can no longer mark a file public by itself. New uploads through the API must be DM-only.
--   2. A DM's member row can no longer be revoked through the API (no self-lockout).
--   3. restore_revision() always brings the article back as a draft, and skips a main image that
--      has since been deleted.
--   4. begin_enrollment() is serialised with a transaction-level advisory lock, so concurrent
--      guesses cannot slip past the failure limits, and successful enrollments are capped
--      (20 per address per hour, 200 per day for the whole wiki).
--
-- No table or column changes; no data is deleted. Safe to run more than once.
--
-- Rollback (run in the SQL Editor if this migration must be undone):
--   drop trigger if exists articles_media_sync on public.articles;
--   drop trigger if exists maps_media_sync on public.maps;
--   drop trigger if exists settings_media_sync on public.campaign_settings;
--   drop function if exists private.media_usage_changed();
--   drop function if exists private.sync_media_visibility(uuid);
--   drop policy if exists media_dm_insert on public.media;
--   drop policy if exists media_dm_update on public.media;
--   drop policy if exists media_dm_delete on public.media;
--   create policy media_dm on public.media for all to authenticated
--     using (private.is_dm()) with check (private.is_dm());
--   drop policy if exists members_dm_update on public.campaign_members;
--   create policy members_dm_update on public.campaign_members for update to authenticated
--     using (private.is_dm()) with check (private.is_dm());
--   then re-run the "create function public.restore_revision" and
--   "create function public.begin_enrollment" blocks from 20261109000200_functions.sql as
--   "create or replace function". media.visibility values are left as this migration set them
--   (the safe direction).

-------------------------------------------------------------------------------
-- 1. Media visibility follows usage
-------------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: only the DM (who can see every row), service_role and the owner
-- can change the tables that fire it. Any other caller could only compute 'dm' (fail closed).
create or replace function private.sync_media_visibility(p_media uuid)
returns void
language sql security invoker set search_path = ''
as $$
  update public.media m
  set visibility = v.computed
  from (
    select case when
      exists (select 1 from public.articles a
              where a.hero_media_id = p_media and a.visibility = 'players' and a.status = 'published')
      or exists (select 1 from public.maps mp
              where mp.media_id = p_media and mp.visibility = 'players' and mp.status = 'published')
      or exists (select 1 from public.campaign_settings s where s.banner_media_id = p_media)
    then 'players'::public.content_visibility else 'dm'::public.content_visibility end as computed
  ) v
  where m.id = p_media and m.visibility is distinct from v.computed;
$$;

-- Trigger: tg_argv[0] names the column that references public.media.
create or replace function private.media_usage_changed()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  if tg_op <> 'INSERT' then
    v_old := (to_jsonb(old) ->> tg_argv[0])::uuid;
  end if;
  if tg_op <> 'DELETE' then
    v_new := (to_jsonb(new) ->> tg_argv[0])::uuid;
  end if;
  if v_old is not null then
    perform private.sync_media_visibility(v_old);
  end if;
  if v_new is not null and v_new is distinct from v_old then
    perform private.sync_media_visibility(v_new);
  end if;
  return null;
end;
$$;

revoke all on function private.sync_media_visibility(uuid), private.media_usage_changed() from public;
grant execute on function private.sync_media_visibility(uuid), private.media_usage_changed()
  to authenticated, service_role;

drop trigger if exists articles_media_sync on public.articles;
create trigger articles_media_sync
  after insert or delete or update of hero_media_id, visibility, status on public.articles
  for each row execute function private.media_usage_changed('hero_media_id');

drop trigger if exists maps_media_sync on public.maps;
create trigger maps_media_sync
  after insert or delete or update of media_id, visibility, status on public.maps
  for each row execute function private.media_usage_changed('media_id');

drop trigger if exists settings_media_sync on public.campaign_settings;
create trigger settings_media_sync
  after update of banner_media_id on public.campaign_settings
  for each row execute function private.media_usage_changed('banner_media_id');

-- Uploads through the API start DM-only; only the page they are attached to can reveal them.
drop policy if exists media_dm on public.media;
drop policy if exists media_dm_insert on public.media;
drop policy if exists media_dm_update on public.media;
drop policy if exists media_dm_delete on public.media;
create policy media_dm_insert on public.media for insert to authenticated
  with check ((select private.is_dm()) and visibility = 'dm');
create policy media_dm_update on public.media for update to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));
create policy media_dm_delete on public.media for delete to authenticated
  using ((select private.is_dm()));

-------------------------------------------------------------------------------
-- 2. No DM row can be revoked through the API
-------------------------------------------------------------------------------
drop policy if exists members_dm_update on public.campaign_members;
create policy members_dm_update on public.campaign_members for update to authenticated
  using ((select private.is_dm()))
  with check ((select private.is_dm()) and (role = 'player' or revoked_at is null));

-------------------------------------------------------------------------------
-- 3. Restore as a draft
-------------------------------------------------------------------------------
create or replace function public.restore_revision(p_revision uuid)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_rev public.revisions;
  v_a jsonb;
begin
  if not private.is_dm() then
    raise exception 'Only the DM can restore revisions' using errcode = '42501';
  end if;
  select * into v_rev from public.revisions where id = p_revision;
  if not found then
    raise exception 'Revision not found' using errcode = 'P0002';
  end if;
  perform public.snapshot_article(v_rev.article_id, 'Before restoring revision ' || p_revision);

  v_a := v_rev.snapshot -> 'article';
  -- Always a draft: restoring must never publish anything. The DM publishes again by hand.
  update public.articles set
    title = v_a ->> 'title', subtitle = v_a ->> 'subtitle', summary = v_a ->> 'summary',
    type = (v_a ->> 'type')::public.article_type,
    visibility = (v_a ->> 'visibility')::public.content_visibility,
    status = 'draft',
    hero_media_id = (select m.id from public.media m where m.id = nullif(v_a ->> 'hero_media_id', '')::uuid),
    is_featured = coalesce((v_a ->> 'is_featured')::boolean, false),
    is_party_member = coalesce((v_a ->> 'is_party_member')::boolean, false),
    importance = coalesce((v_a ->> 'importance')::smallint, 0),
    session_date = nullif(v_a ->> 'session_date', '')::date
  where id = v_rev.article_id;

  delete from public.article_sections where article_id = v_rev.article_id;
  insert into public.article_sections (id, article_id, position, heading, body, visibility, status)
  select (s ->> 'id')::uuid, v_rev.article_id, (s ->> 'position')::integer, s ->> 'heading', s ->> 'body',
    (s ->> 'visibility')::public.content_visibility, (s ->> 'status')::public.publish_status
  from jsonb_array_elements(v_rev.snapshot -> 'sections') s;

  delete from public.infobox_fields where article_id = v_rev.article_id;
  insert into public.infobox_fields (id, article_id, position, label, value, visibility)
  select (f ->> 'id')::uuid, v_rev.article_id, (f ->> 'position')::integer, f ->> 'label', f ->> 'value',
    (f ->> 'visibility')::public.content_visibility
  from jsonb_array_elements(v_rev.snapshot -> 'infobox') f;

  return v_rev.article_id;
end;
$$;

-------------------------------------------------------------------------------
-- 4. Serialised enrollment with success caps
-------------------------------------------------------------------------------
create or replace function public.begin_enrollment(p_code text, p_ip_hash text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_code_id uuid;
begin
  if p_ip_hash is null or char_length(p_ip_hash) < 16 then
    raise exception 'Bad enrollment request' using errcode = '22023';
  end if;

  -- One attempt at a time, so every count below includes all earlier attempts. Held until the
  -- calling transaction ends (one PostgREST request).
  perform pg_advisory_xact_lock(hashtextextended('chronicle.begin_enrollment', 0));

  -- Keep the attempts table small.
  delete from public.enrollment_attempts where attempted_at < now() - interval '7 days';

  -- Failure limits (guessing) and success limits (mass device creation with a valid code).
  -- Checked before the code, so a limited caller learns nothing about it, and not recorded.
  if (select count(*) from public.enrollment_attempts
      where ip_hash = p_ip_hash and not succeeded and attempted_at > now() - interval '15 minutes') >= 5
     or (select count(*) from public.enrollment_attempts
      where not succeeded and attempted_at > now() - interval '1 hour') >= 100
     or (select count(*) from public.enrollment_attempts
      where ip_hash = p_ip_hash and succeeded and attempted_at > now() - interval '1 hour') >= 20
     or (select count(*) from public.enrollment_attempts
      where succeeded and attempted_at > now() - interval '24 hours') >= 200 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  select c.id into v_code_id
  from public.access_codes c
  where c.revoked_at is null
    and (c.expires_at is null or c.expires_at > now())
    and (c.max_uses is null or c.use_count < c.max_uses)
    and p_code is not null and char_length(p_code) between 1 and 200
    and c.code_hash = extensions.crypt(p_code, c.code_hash)
  limit 1;

  insert into public.enrollment_attempts (ip_hash, succeeded) values (p_ip_hash, v_code_id is not null);
  if v_code_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  return jsonb_build_object('status', 'ok', 'code_id', v_code_id);
end;
$$;

revoke all on function public.restore_revision(uuid), public.begin_enrollment(text, text)
  from public, anon, authenticated;
grant execute on function public.restore_revision(uuid) to authenticated;
grant execute on function public.begin_enrollment(text, text) to service_role;

-------------------------------------------------------------------------------
-- Existing data: derive every media row's visibility from its current usage.
-------------------------------------------------------------------------------
select private.sync_media_visibility(m.id) from public.media m;
