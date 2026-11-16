-- Chronicle cloud: photo library (CH-200, CH-201; CH-104 private metadata).
--
-- Requires migrations through 20261112052528 (in particular 20261112001400_article_images).
-- Forward-only. Not authorized for production until the owner approves the migration bundle.
--
-- 1. Private photo details. Credit, original file name, crop and the link to the full-frame
--    source move from public.media (whose rows players may read once a picture is shown to
--    them) to public.media_private, which only the DM can read. media.credit and
--    media.original_name, added by 20261112001400 and never deployed, are dropped after copying.
-- 2. Full-frame sources. Every new photo keeps an optimized, uncropped copy (role 'source',
--    path sources/<uuid>.webp) so it can be cropped again later. A source is always DM-only:
--    a check constraint and private.sync_media_visibility both enforce it, so the file stays
--    private even when its cropped picture is shown to players.
-- 3. Atomic registration. public.register_photo records the uploaded files in one transaction,
--    and only if each file really exists in Storage, so a database row can never point at a
--    missing file and a failed request leaves nothing half-registered.
-- 4. Pictures in use cannot be deleted through the API (page picture, map, banner, picture in
--    text, waiting Gazette revision, or a source still used by a cropped picture). Storage
--    refuses deleting a file that still has a library entry, so files are removed only after
--    their entry, which is itself refused while in use.
-- 5. Assistant connections (OAuth clients) cannot change the library, the photo details or the
--    stored files. Uploading and managing photos is a website-only DM action. Database-internal
--    visibility updates made inside approved functions are unaffected.
--
-- Recovery: forward-fix in a new reviewed migration. To undo (data in media_private is lost
-- unless copied back first):
--   alter table public.media add column credit text not null default '', add column original_name text not null default '';
--   update public.media m set credit = p.credit, original_name = p.original_name from public.media_private p where p.media_id = m.id;
--   drop function public.register_photo(jsonb); drop function private.media_in_use(uuid);
--   drop trigger media_delete_guard on public.media; drop trigger media_oauth_guard on public.media;
--   drop table public.media_private;
--   alter table public.media drop constraint media_source_private, drop column role;
--   restore private.sync_media_visibility from 20261112001400 and the storage policies from 20261109000300.

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------
-- True when the request comes from an assistant connection (OAuth client) rather than the
-- website. The API gateway sets these claims; the application cannot.
create or replace function private.is_oauth_request()
returns boolean language sql stable set search_path = ''
as $$
  select nullif((select auth.jwt()) ->> 'client_id', '') is not null
      or nullif((select auth.jwt()) ->> 'chronicle_client', '') is not null;
$$;

-------------------------------------------------------------------------------
-- 1 & 2. Roles and private details
-------------------------------------------------------------------------------
alter table public.media
  add column if not exists role text not null default 'display' check (role in ('display', 'source'));
alter table public.media drop constraint if exists media_source_private;
alter table public.media add constraint media_source_private check (role = 'display' or visibility = 'dm');

create table if not exists public.media_private (
  media_id uuid primary key references public.media (id) on delete cascade,
  credit text not null default '' check (char_length(credit) <= 200),
  original_name text not null default '' check (char_length(original_name) <= 200),
  source_media_id uuid references public.media (id) on delete set null,
  -- Crop of the source the picture was made from: fractions 0..1 and the chosen shape.
  crop jsonb check (crop is null or (jsonb_typeof(crop) = 'object' and jsonb_typeof(crop -> 'x') = 'number'
    and jsonb_typeof(crop -> 'y') = 'number' and jsonb_typeof(crop -> 'w') = 'number' and jsonb_typeof(crop -> 'h') = 'number')),
  created_at timestamptz not null default now()
);
create index if not exists media_private_source on public.media_private (source_media_id);
alter table public.media_private enable row level security;
revoke all on public.media_private from anon, authenticated;
grant select, insert, update, delete on public.media_private to authenticated;
grant all on public.media_private to service_role;
drop policy if exists media_private_dm on public.media_private;
create policy media_private_dm on public.media_private for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

-- Move the details written by 20261112001400 (local or preview databases only), then drop them.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'media' and column_name = 'credit') then
    insert into public.media_private (media_id, credit, original_name)
    select id, coalesce(credit, ''), coalesce(original_name, '') from public.media
    where coalesce(credit, '') <> '' or coalesce(original_name, '') <> ''
    on conflict (media_id) do nothing;
    alter table public.media drop column credit, drop column original_name;
  end if;
end;
$$;

-- A source is never visible to players, whatever refers to it.
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
      exists (select 1 from public.media me where me.id = p_media and me.role = 'display')
      and (
        exists (select 1 from public.articles a
                where a.hero_media_id = p_media and a.visibility = 'players' and a.status = 'published')
        or exists (select 1 from public.maps mp
                where mp.media_id = p_media and mp.visibility = 'players' and mp.status = 'published')
        or exists (select 1 from public.campaign_settings s where s.banner_media_id = p_media)
        or exists (select 1 from public.media me
                   join public.article_sections s on strpos(s.body, 'media:' || me.path) > 0
                   join public.articles a on a.id = s.article_id
                   where me.id = p_media
                     and s.visibility = 'players' and s.status = 'published'
                     and a.visibility = 'players' and a.status = 'published'
                     and me.path in (select private.media_paths(s.body)))
      )
    then 'players'::public.content_visibility else 'dm'::public.content_visibility end as computed
  ) v
  where m.id = p_media and m.visibility is distinct from v.computed;
$$;

-------------------------------------------------------------------------------
-- 3. Atomic registration
-------------------------------------------------------------------------------
-- p = { display: {path, alt, width, height, bytes},
--       source?: {path, width, height, bytes} | source_id?: uuid,
--       crop?: {x, y, w, h, aspect}, credit?, original_name? }
create or replace function public.register_photo(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_display jsonb := p -> 'display';
  v_source jsonb := p -> 'source';
  v_source_id uuid := nullif(p ->> 'source_id', '')::uuid;
  v_id uuid;
  v_row public.media;
begin
  perform private.require_dm();
  if private.is_oauth_request() then
    perform private.fail('FORBIDDEN', 'Photos can only be added on the Chronicle website.');
  end if;
  if jsonb_typeof(v_display) is distinct from 'object'
     or coalesce(v_display ->> 'path', '') !~ '^media/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$' then
    perform private.fail('VALIDATION_FAILED', 'The picture was not uploaded correctly. Try again.');
  end if;
  if v_source is not null and v_source_id is not null then
    perform private.fail('VALIDATION_FAILED', 'Give either a new source or an existing one, not both.');
  end if;
  if v_source is not null and coalesce(v_source ->> 'path', '') !~ '^sources/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$' then
    perform private.fail('VALIDATION_FAILED', 'The full-size copy was not uploaded correctly. Try again.');
  end if;
  -- Only files that really arrived in Storage can be registered.
  if not exists (select 1 from storage.objects o where o.bucket_id = 'chronicle-media' and o.name = v_display ->> 'path')
     or (v_source is not null and not exists (select 1 from storage.objects o where o.bucket_id = 'chronicle-media' and o.name = v_source ->> 'path')) then
    perform private.fail('VALIDATION_FAILED', 'The upload did not finish. Try again.');
  end if;
  if v_source_id is not null and not exists (select 1 from public.media where id = v_source_id and role = 'source') then
    perform private.fail('NOT_FOUND', 'The full-size copy of this picture no longer exists.');
  end if;

  if v_source is not null then
    insert into public.media (path, alt, width, height, bytes, content_type, visibility, role, created_by)
    values (v_source ->> 'path', '', (v_source ->> 'width')::int, (v_source ->> 'height')::int, (v_source ->> 'bytes')::int,
            'image/webp', 'dm', 'source', (select auth.uid()))
    returning id into v_source_id;
    insert into public.media_private (media_id, original_name)
    values (v_source_id, left(coalesce(p ->> 'original_name', ''), 200));
  end if;

  insert into public.media (path, alt, width, height, bytes, content_type, visibility, role, created_by)
  values (v_display ->> 'path', left(coalesce(v_display ->> 'alt', ''), 500), (v_display ->> 'width')::int, (v_display ->> 'height')::int,
          (v_display ->> 'bytes')::int, 'image/webp', 'dm', 'display', (select auth.uid()))
  returning * into v_row;
  insert into public.media_private (media_id, credit, original_name, source_media_id, crop)
  values (v_row.id, left(coalesce(p ->> 'credit', ''), 200), left(coalesce(p ->> 'original_name', ''), 200), v_source_id,
          case when jsonb_typeof(p -> 'crop') = 'object' then p -> 'crop' end);

  return jsonb_build_object('id', v_row.id, 'path', v_row.path, 'alt', v_row.alt, 'width', v_row.width,
                            'height', v_row.height, 'visibility', v_row.visibility, 'source_id', v_source_id);
exception when unique_violation then
  perform private.fail('CONFLICT', 'This file is already in the library.');
end;
$$;
revoke all on function public.register_photo(jsonb) from public, anon;
grant execute on function public.register_photo(jsonb) to authenticated;

-------------------------------------------------------------------------------
-- 4. Pictures in use cannot be deleted
-------------------------------------------------------------------------------
create or replace function private.media_in_use(p_media uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.articles where hero_media_id = p_media)
      or exists (select 1 from public.maps where media_id = p_media)
      or exists (select 1 from public.campaign_settings where banner_media_id = p_media)
      or exists (select 1 from public.media_private where source_media_id = p_media)
      or exists (select 1 from public.media me join public.article_sections s on strpos(s.body, 'media:' || me.path) > 0
                 where me.id = p_media and me.path in (select private.media_paths(s.body)))
      or exists (select 1 from public.media me join public.news_pending np
                   on strpos(np.story::text, 'media:' || me.path) > 0 or np.story -> 'article' ->> 'hero_media_id' = me.id::text
                 where me.id = p_media);
$$;
revoke all on function private.media_in_use(uuid) from public, anon;
grant execute on function private.media_in_use(uuid) to authenticated, service_role;

create or replace function private.guard_media_delete()
returns trigger language plpgsql set search_path = ''
as $$
begin
  -- API requests run as "authenticated"; maintenance by the project owner is not restricted.
  if current_user = 'authenticated' and private.media_in_use(old.id) then
    perform private.fail('CONFLICT', 'This picture is still in use. Remove it from those pages first.');
  end if;
  return old;
end;
$$;
drop trigger if exists media_delete_guard on public.media;
create trigger media_delete_guard before delete on public.media
  for each row execute function private.guard_media_delete();

-------------------------------------------------------------------------------
-- 5. Assistant connections cannot change photos
-------------------------------------------------------------------------------
create or replace function private.guard_oauth_media()
returns trigger language plpgsql set search_path = ''
as $$
begin
  -- Direct API writes run as "authenticated". Inside approved SECURITY DEFINER functions
  -- (for example applying a DM-approved change set) the owner runs the visibility sync.
  if current_user = 'authenticated' and private.is_oauth_request() then
    raise exception 'Photos can only be changed on the Chronicle website' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists media_oauth_guard on public.media;
create trigger media_oauth_guard before insert or update or delete on public.media
  for each row execute function private.guard_oauth_media();
drop trigger if exists media_private_oauth_guard on public.media_private;
create trigger media_private_oauth_guard before insert or update or delete on public.media_private
  for each row execute function private.guard_oauth_media();

revoke all on function private.is_oauth_request(), private.guard_media_delete(), private.guard_oauth_media() from public, anon;
grant execute on function private.is_oauth_request(), private.guard_media_delete(), private.guard_oauth_media() to authenticated, service_role;
revoke all on function private.sync_media_visibility(uuid) from public;
grant execute on function private.sync_media_visibility(uuid) to authenticated, service_role;

-------------------------------------------------------------------------------
-- Storage: website DM only, only into media/ and sources/, never deleting a registered file
-------------------------------------------------------------------------------
drop policy if exists "chronicle media dm insert" on storage.objects;
create policy "chronicle media dm insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'chronicle-media' and (select private.is_dm()) and not (select private.is_oauth_request())
              and (storage.foldername(name))[1] in ('media', 'sources'));

drop policy if exists "chronicle media dm update" on storage.objects;
create policy "chronicle media dm update" on storage.objects for update to authenticated
  using (bucket_id = 'chronicle-media' and (select private.is_dm()) and not (select private.is_oauth_request()))
  with check (bucket_id = 'chronicle-media' and (select private.is_dm()) and not (select private.is_oauth_request())
              and not exists (select 1 from public.media m where m.path = name));

drop policy if exists "chronicle media dm delete" on storage.objects;
create policy "chronicle media dm delete" on storage.objects for delete to authenticated
  using (bucket_id = 'chronicle-media' and (select private.is_dm()) and not (select private.is_oauth_request())
         and not exists (select 1 from public.media m where m.path = name));

-- Bring every file in line with the rule (sources become DM-only).
select private.sync_media_visibility(id) from public.media;
