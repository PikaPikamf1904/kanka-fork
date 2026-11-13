-- CH-102: an assistant's change set never changes what players can see, by any operation.
-- Requires 20261113000300_photo_integrity. Forward-only; not authorized for production until the
-- owner approves the migration bundle.
--
-- The change-set engine refused assistant edits to published pages and to visible sections and
-- fields, but not: removing a visible infobox field, removing a visible connection, adding or
-- removing categories on a published page, or restoring an old revision of a published page
-- (which also turns it back into a draft, hiding it from players). Instead of patching every
-- branch of the engine, this enforces the rule on the data: while an assistant's approved change
-- set is being applied, a row change that touches player-visible content is refused, and the
-- whole change set rolls back. The website DM is unaffected.
--
-- Also: private.request_client() treated an OAuth client literally named "web" as the website.
-- It now reports such a client as "oauth:web", so it gets no website privileges.
--
-- Forward recovery: drop the oauth_public_content_guard triggers and restore
-- private.request_client() from 20261111000900 in a new reviewed migration.

create or replace function private.request_client()
returns text language sql stable set search_path = ''
as $$
  select coalesce(
    (select case when c = 'web' then 'oauth:web' else c end
     from (select coalesce(nullif(auth.jwt() ->> 'client_id', ''), nullif(auth.jwt() ->> 'chronicle_client', '')) as c) x
     where c is not null),
    'web'
  );
$$;

create or replace function private.article_public(p_article uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.articles a where a.id = p_article and a.visibility = 'players' and a.status = 'published');
$$;

create or replace function private.guard_oauth_public_content()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_hit boolean := false;
begin
  if not private.is_oauth_request() then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'articles' then
    -- Version bumps caused by DM-only changes are fine; content changes of a visible page are not.
    v_hit := old.visibility = 'players' and old.status = 'published'
      and (new.title, new.subtitle, new.summary, new.hero_media_id, new.visibility, new.status, new.slug, new.type,
           new.is_party_member, new.importance, new.session_date, new.is_featured)
          is distinct from
          (old.title, old.subtitle, old.summary, old.hero_media_id, old.visibility, old.status, old.slug, old.type,
           old.is_party_member, old.importance, old.session_date, old.is_featured);
  elsif tg_table_name = 'article_sections' then
    v_hit := (tg_op <> 'INSERT' and old.visibility = 'players' and old.status = 'published' and private.article_public(old.article_id))
          or (tg_op <> 'DELETE' and new.visibility = 'players' and new.status = 'published' and private.article_public(new.article_id));
  elsif tg_table_name = 'infobox_fields' then
    v_hit := (tg_op <> 'INSERT' and old.visibility = 'players' and private.article_public(old.article_id))
          or (tg_op <> 'DELETE' and new.visibility = 'players' and private.article_public(new.article_id));
  elsif tg_table_name = 'relations' then
    v_hit := (tg_op <> 'INSERT' and old.visibility = 'players' and (private.article_public(old.source_article_id) or private.article_public(old.target_article_id)))
          or (tg_op <> 'DELETE' and new.visibility = 'players' and (private.article_public(new.source_article_id) or private.article_public(new.target_article_id)));
  elsif tg_table_name = 'article_categories' then
    v_hit := (tg_op <> 'INSERT' and private.article_public(old.article_id))
          or (tg_op <> 'DELETE' and private.article_public(new.article_id));
  end if;
  if v_hit then
    raise exception 'An assistant cannot change what players can see; make this change on the website'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['articles', 'article_sections', 'infobox_fields', 'relations', 'article_categories'] loop
    execute format('drop trigger if exists oauth_public_content_guard on public.%I', t);
    execute format('create trigger oauth_public_content_guard before insert or update or delete on public.%I
                    for each row execute function private.guard_oauth_public_content()', t);
  end loop;
end;
$$;

revoke all on function private.article_public(uuid), private.guard_oauth_public_content() from public, anon;
grant execute on function private.article_public(uuid), private.guard_oauth_public_content() to authenticated, service_role;
revoke all on function private.request_client() from public;
grant execute on function private.request_client() to authenticated, service_role;
