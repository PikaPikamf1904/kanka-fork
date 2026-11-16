-- CH-101: assistant connections (OAuth clients) cannot write campaign content directly.
--
-- Requires migrations through 20261113000100_photo_library. Forward-only; not authorized for
-- production until the owner approves the migration bundle.
--
-- An assistant's token carries the DM's identity, so table privileges and RLS alone let it edit
-- anything the DM can. The assistant's permitted write path is a change set the DM approved on
-- the website and that public.apply_change_set then applies. This migration:
--   1. has apply_change_set mark its own transaction while it applies an approved preview
--      (a transaction-local setting that only server code can set; the Data API exposes no
--      function that sets arbitrary settings, and the marker is cleared before it returns);
--   2. refuses, with a statement trigger on every content table, any write made directly by an
--      assistant request (request role "authenticated" with an OAuth client claim) outside that
--      marker. Statement triggers also catch writes that match no rows and writes made through
--      SECURITY INVOKER functions such as snapshot_article and restore_revision;
--   3. lets the media guards from 20261113000100 accept the visibility updates an approved
--      change set causes.
-- Website sessions, players (who have no write privileges anyway) and SECURITY DEFINER functions
-- with their own checks are unaffected.
--
-- Forward recovery: drop the oauth_content_guard triggers in a new reviewed migration and restore
-- apply_change_set from 20261111000900 and private.guard_oauth_media from 20261113000100.

create or replace function private.oauth_apply_active()
returns boolean language sql stable set search_path = ''
as $$
  select coalesce(current_setting('chronicle.change_set_apply', true), '') = 'on';
$$;

create or replace function private.guard_oauth_content()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user = 'authenticated' and private.is_oauth_request() and not private.oauth_apply_active() then
    raise exception 'Assistants propose changes for the DM to approve in Chronicle; they cannot edit directly'
      using errcode = '42501';
  end if;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'campaign_settings', 'articles', 'article_sections', 'infobox_fields', 'dm_notes', 'categories',
    'article_categories', 'redirects', 'relations', 'timeline_events', 'maps', 'map_markers',
    'map_fog_areas', 'revisions', 'news_stories', 'news_pending', 'article_links'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists oauth_content_guard on public.%I', t);
      execute format('create trigger oauth_content_guard before insert or update or delete on public.%I
                      for each statement execute function private.guard_oauth_content()', t);
    end if;
  end loop;
end;
$$;

-- Media: approved change sets may change which pictures pages show; the visibility sync that
-- follows runs as the caller and must be allowed. Everything else stays refused.
create or replace function private.guard_oauth_media()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user = 'authenticated' and private.is_oauth_request() and not private.oauth_apply_active() then
    raise exception 'Photos can only be changed on the Chronicle website' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- apply_change_set from 20261111000900, unchanged except for marking the approved apply.
create or replace function public.apply_change_set(p_preview_id uuid, p_digest text, p_idempotency_key text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_begin jsonb;
  v_preview public.change_previews;
  v_result jsonb;
  v_out jsonb;
  v_slug text;
  v_ver jsonb;
begin
  perform private.require_dm();
  v_begin := private.cs_begin(p_idempotency_key, coalesce(p_digest, ''), p_preview_id, null);
  if not (v_begin ->> 'new')::boolean then
    return (v_begin -> 'result') || jsonb_build_object('replayed', true);
  end if;
  v_preview := private.cs_claim_preview(p_preview_id, p_digest);
  -- Every article the preview read must still be at the version it read.
  for v_slug, v_ver in select key, value from jsonb_each(v_preview.base_versions) loop
    if not exists (select 1 from public.articles where slug = v_slug and version = (v_ver #>> '{}')::bigint) then
      perform private.fail('CONFLICT', format('"%s" changed since the preview.', v_slug), jsonb_build_object('slug', v_slug));
    end if;
  end loop;
  -- Only the approved preview's own change set runs under the marker.
  perform set_config('chronicle.change_set_apply', 'on', true);
  v_result := private.run_change_set(v_preview.change_set, true, (v_begin ->> 'change_set_id')::uuid,
    coalesce(nullif(v_preview.label, ''), 'Change set'));
  perform set_config('chronicle.change_set_apply', 'off', true);
  v_out := jsonb_build_object(
    'schema_version', '1', 'change_set_id', v_begin ->> 'change_set_id', 'preview_id', v_preview.id,
    'created', v_result -> 'created', 'updated', v_result -> 'updated', 'skipped', v_result -> 'skipped',
    'new_versions', v_result -> 'new_versions', 'revision_ids', v_result -> 'revision_ids',
    'warnings', v_result -> 'warnings', 'replayed', false);
  perform private.cs_finish((v_begin ->> 'change_set_id')::uuid, v_out);
  return v_out;
end;
$$;

revoke all on function private.oauth_apply_active(), private.guard_oauth_content(), private.guard_oauth_media() from public, anon;
grant execute on function private.oauth_apply_active(), private.guard_oauth_content(), private.guard_oauth_media() to authenticated, service_role;
revoke all on function public.apply_change_set(uuid, text, text) from public, anon;
grant execute on function public.apply_change_set(uuid, text, text) to authenticated;
