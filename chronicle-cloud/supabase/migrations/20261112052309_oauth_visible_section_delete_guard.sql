-- CH-102 (partial): prevent OAuth clients from deleting a section currently visible to players.
-- Requires migrations through 20261112051529. This is an apply-time safeguard; preview still
-- permits proposing such a change. Other change-set operations need separate protection.
-- Forward recovery: drop the trigger and function in a new reviewed migration.
create function private.guard_oauth_visible_section_delete()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_visibility public.content_visibility;
  v_status public.publish_status;
begin
  if (nullif((select auth.jwt()) ->> 'client_id', '') is not null
      or nullif((select auth.jwt()) ->> 'chronicle_client', '') is not null)
     and old.visibility = 'players' and old.status = 'published' then
    -- Serialize with publication changes so the decision uses the locked parent state.
    select visibility, status into v_visibility, v_status
    from public.articles where id = old.article_id for share;
    if v_visibility = 'players' and v_status = 'published' then
      raise exception 'Player-visible sections can only be removed on the Chronicle website' using errcode = '42501';
    end if;
  end if;
  return old;
end;
$$;
revoke all on function private.guard_oauth_visible_section_delete() from public, anon, authenticated;
create trigger oauth_visible_section_delete_guard
  before delete on public.article_sections
  for each row execute function private.guard_oauth_visible_section_delete();
