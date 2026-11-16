-- Photo integrity (CH-200, CH-201, CH-104). Requires 20261113000200_oauth_write_boundary.
-- Forward-only; not authorized for production until the owner approves the migration bundle.
--
-- Defects reproduced through the real local Storage API before this migration:
--   * a registered file could be moved or renamed away (the update rule checked only the new
--     name), breaking every page that showed it;
--   * a new file could then be uploaded at the registered path, replacing the picture.
-- This migration:
--   1. Storage: a registered file can never be moved, renamed or overwritten, and nothing can be
--      uploaded at a registered path. Uploads stay in media/ and sources/.
--   2. "In use" also covers page history (revisions) and pending assistant proposals, so deleting
--      a picture can never break a restore or an approved-but-unapplied change.
--   3. Attaching versus deleting: a section text or Gazette revision that newly refers to a picture
--      locks its library entry (FOR KEY SHARE), like a foreign key does for page pictures, maps and
--      the banner. A concurrent delete then either waits and is refused (picture now in use) or
--      wins, and the save fails instead of silently pointing at a deleted file.
--   4. Least privilege for assistant connections: they cannot read stored files or the private
--      photo details at all (the assistant tools never use them).
--
-- Forward recovery: restore the storage policies and private.media_in_use from 20261113000100,
-- restore private.can_read_media_path from 20261109000100 and the media_private policy from
-- 20261113000100, and drop the *_media_ref_lock triggers, in a new reviewed migration.

-------------------------------------------------------------------------------
-- 1. Storage
-------------------------------------------------------------------------------
drop policy if exists "chronicle media dm insert" on storage.objects;
create policy "chronicle media dm insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'chronicle-media' and (select private.is_dm()) and not (select private.is_oauth_request())
              and (storage.foldername(name))[1] in ('media', 'sources')
              and not exists (select 1 from public.media m where m.path = name));

drop policy if exists "chronicle media dm update" on storage.objects;
create policy "chronicle media dm update" on storage.objects for update to authenticated
  using (bucket_id = 'chronicle-media' and (select private.is_dm()) and not (select private.is_oauth_request())
         and not exists (select 1 from public.media m where m.path = name))
  with check (bucket_id = 'chronicle-media' and (select private.is_dm()) and not (select private.is_oauth_request())
              and (storage.foldername(name))[1] in ('media', 'sources')
              and not exists (select 1 from public.media m where m.path = name));

-- Reads: unchanged for the website, closed to assistant connections.
create or replace function private.can_read_media_path(p_path text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not private.is_oauth_request() and (
    private.is_dm() or (
      private.is_member() and exists (
        select 1 from public.media m where m.path = p_path and m.visibility = 'players'
      )
    )
  );
$$;
revoke all on function private.can_read_media_path(text) from public;
grant execute on function private.can_read_media_path(text) to authenticated, service_role;

drop policy if exists media_private_dm on public.media_private;
create policy media_private_dm on public.media_private for all to authenticated
  using ((select private.is_dm()) and not (select private.is_oauth_request()))
  with check ((select private.is_dm()) and not (select private.is_oauth_request()));

-------------------------------------------------------------------------------
-- 2. In use
-------------------------------------------------------------------------------
create or replace function private.media_in_use(p_media uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  with me as (select id, path from public.media where id = p_media)
  select exists (select 1 from public.articles where hero_media_id = p_media)
      or exists (select 1 from public.maps where media_id = p_media)
      or exists (select 1 from public.campaign_settings where banner_media_id = p_media)
      or exists (select 1 from public.media_private where source_media_id = p_media)
      or exists (select 1 from me join public.article_sections s on strpos(s.body, 'media:' || me.path) > 0
                 where me.path in (select private.media_paths(s.body)))
      or exists (select 1 from me join public.news_pending np
                   on strpos(np.story::text, 'media:' || me.path) > 0 or np.story -> 'article' ->> 'hero_media_id' = me.id::text)
      -- Page history: a restore must find its pictures.
      or exists (select 1 from me join public.revisions r
                   on strpos(r.snapshot::text, me.id::text) > 0 or strpos(r.snapshot::text, 'media:' || me.path) > 0)
      -- Proposals not yet applied.
      or exists (select 1 from me join public.change_previews cp
                   on cp.consumed_at is null
                  and (strpos(cp.change_set::text, me.id::text) > 0 or strpos(cp.change_set::text, 'media:' || me.path) > 0));
$$;
revoke all on function private.media_in_use(uuid) from public, anon;
grant execute on function private.media_in_use(uuid) to authenticated, service_role;

-------------------------------------------------------------------------------
-- 3. Attaching versus deleting
-------------------------------------------------------------------------------
create or replace function private.lock_new_media_refs()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_old text;
  v_new text;
  v_path text;
  v_hero text;
begin
  -- Every Data API request connects as "authenticator", also inside SECURITY DEFINER functions
  -- such as save_news_story; owner maintenance (migrations, seeds, imports) does not.
  if current_user <> 'authenticated' and session_user <> 'authenticator' then return new; end if;
  if tg_table_name = 'article_sections' then
    v_new := new.body;
    v_old := case when tg_op = 'UPDATE' then old.body else null end;
  else
    v_new := new.story::text;
    v_old := case when tg_op = 'UPDATE' then old.story::text else null end;
    v_hero := new.story -> 'article' ->> 'hero_media_id';
    if v_hero is not null and v_hero <> coalesce(case when tg_op = 'UPDATE' then old.story -> 'article' ->> 'hero_media_id' end, '') then
      perform 1 from public.media where id = v_hero::uuid for key share;
      if not found then
        perform private.fail('CONFLICT', 'The story picture was deleted from the library. Choose another picture.');
      end if;
    end if;
  end if;
  for v_path in
    select p from private.media_paths(v_new) as p
    except select p from private.media_paths(v_old) as p
  loop
    perform 1 from public.media where path = v_path for key share;
    if not found then
      perform private.fail('CONFLICT', 'A picture in this text is no longer in the library. Remove it or choose it again.',
                           jsonb_build_object('path', v_path));
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.lock_new_media_refs() from public, anon;
grant execute on function private.lock_new_media_refs() to authenticated, service_role;

drop trigger if exists sections_media_ref_lock on public.article_sections;
create trigger sections_media_ref_lock before insert or update of body on public.article_sections
  for each row execute function private.lock_new_media_refs();
drop trigger if exists news_pending_media_ref_lock on public.news_pending;
create trigger news_pending_media_ref_lock before insert or update of story on public.news_pending
  for each row execute function private.lock_new_media_refs();
