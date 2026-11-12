-- Chronicle cloud: pictures inside articles (inline images and galleries) and media library details.
--
-- Article text places a picture with Markdown such as  ![alt](media:media/<id>.webp "caption").
-- Until now only a page's main picture, a map image and the site banner made a file visible to
-- players; pictures in the text stayed DM-only, so players saw nothing. This extends the same rule
-- (private.sync_media_visibility, which decides media.visibility and through it storage access):
--
--   a file is visible to players exactly when it is used by something players can read:
--     - the main picture of a published, player-visible page;
--     - the image of a published, player-visible map;
--     - the site banner;
--     - NEW: written into a section that is published and player-visible, of a page that is
--       published and player-visible.
--   Everything else (DM-only sections, drafts, unprinted Gazette stories, waiting revisions, files
--   that are only in the library) stays DM-only, for the database row and the stored file alike.
--
-- Triggers keep it current when a section's text, visibility or status changes, when a section is
-- removed, and when a page is published, hidden or deleted.
--
-- Also adds media.credit (who made the picture) and media.original_name (the uploaded file's name,
-- for the library). Additive; no existing file or reference is changed apart from the visibility
-- backfill, which follows the rule above.
--
-- Rollback:
--   drop trigger if exists sections_inline_media_sync on public.article_sections;
--   drop trigger if exists articles_inline_media_sync on public.articles;
--   drop function if exists private.inline_media_changed();
--   drop function if exists private.media_paths(text);
--   then re-run private.sync_media_visibility from 20261109000700_media_sync_lock.sql and the backfill
--   at the end of 20261109000600_audit_fixes.sql;
--   alter table public.media drop column if exists credit, drop column if exists original_name;

alter table public.media
  add column if not exists credit text not null default '' check (char_length(credit) <= 200),
  add column if not exists original_name text not null default '' check (char_length(original_name) <= 200);

-- Media paths written into a text, as media:<path>.
create or replace function private.media_paths(p_text text)
returns setof text language sql immutable set search_path = ''
as $$
  select distinct m[1] from regexp_matches(coalesce(p_text, ''), 'media:([a-z0-9][a-z0-9/_.-]*[a-z0-9])', 'g') as m;
$$;

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
      or exists (select 1 from public.media me
                 join public.article_sections s on strpos(s.body, 'media:' || me.path) > 0
                 join public.articles a on a.id = s.article_id
                 where me.id = p_media
                   and s.visibility = 'players' and s.status = 'published'
                   and a.visibility = 'players' and a.status = 'published'
                   and me.path in (select private.media_paths(s.body)))
    then 'players'::public.content_visibility else 'dm'::public.content_visibility end as computed
  ) v
  where m.id = p_media and m.visibility is distinct from v.computed;
$$;

-- Re-syncs every file a changed section (or every section of a changed page) refers to.
create or replace function private.inline_media_changed()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid;
begin
  if tg_table_name = 'article_sections' then
    for v_id in
      select me.id from public.media me
      where me.path in (
        select private.media_paths(case when tg_op = 'INSERT' then null else old.body end)
        union select private.media_paths(case when tg_op = 'DELETE' then null else new.body end))
    loop
      perform private.sync_media_visibility(v_id);
    end loop;
  else
    for v_id in
      select distinct me.id from public.article_sections s
      cross join lateral private.media_paths(s.body) as p(path)
      join public.media me on me.path = p.path
      where s.article_id = coalesce(new.id, old.id)
    loop
      perform private.sync_media_visibility(v_id);
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists sections_inline_media_sync on public.article_sections;
create trigger sections_inline_media_sync after insert or delete or update of body, visibility, status on public.article_sections
  for each row execute function private.inline_media_changed();
drop trigger if exists articles_inline_media_sync on public.articles;
create trigger articles_inline_media_sync after update of visibility, status on public.articles
  for each row execute function private.inline_media_changed();

revoke all on function private.media_paths(text), private.inline_media_changed() from public;
grant execute on function private.media_paths(text), private.inline_media_changed() to authenticated, service_role;
revoke all on function private.sync_media_visibility(uuid) from public;
grant execute on function private.sync_media_visibility(uuid) to authenticated, service_role;

-- Bring every file in line with the rule.
select private.sync_media_visibility(id) from public.media;
