-- Chronicle cloud: close a race in private.sync_media_visibility (migration 20261109000600).
--
-- Two transactions that each unpublish a different page sharing one image both computed
-- "another published page still uses it" from their own snapshot and left the image visible to
-- players with no published page using it. Locking the media row first makes the second
-- transaction wait and then compute from committed data. The app never shares one image between
-- pages, so this needed a direct API call, but the rule must hold regardless.
--
-- No data changes. Safe to run more than once.
-- Rollback: re-run the "create or replace function private.sync_media_visibility" block from
-- 20261109000600_audit_fixes.sql (this restores the race; prefer fixing forward).
create or replace function private.sync_media_visibility(p_media uuid)
returns void
language sql security invoker set search_path = ''
as $$
  -- Serialise concurrent changes to pages that use this image.
  select 1 from public.media m where m.id = p_media for update;
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

revoke all on function private.sync_media_visibility(uuid) from public;
grant execute on function private.sync_media_visibility(uuid) to authenticated, service_role;
