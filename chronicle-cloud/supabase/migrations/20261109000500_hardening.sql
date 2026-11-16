-- Chronicle cloud: hardening after the first run of Supabase's security and performance advisors
-- on the live project. No data changes.

-- 1. Pin search_path on the two remaining helper functions (advisor 0011).
alter function private.player_visible(public.content_visibility, public.publish_status) set search_path = '';
alter function private.slugify(text) set search_path = '';

-- 2. Functions created after the first revoke in 20261109000100 kept PostgreSQL's default EXECUTE
--    for PUBLIC. anon cannot reach them (no USAGE on schema private), but grant explicitly.
revoke all on function
  private.touch_updated_at(), private.set_published_at(), private.slugify(text), private.sync_article_links()
  from public;
grant execute on function
  private.touch_updated_at(), private.set_published_at(), private.slugify(text), private.sync_article_links()
  to authenticated, service_role;

-- 3. Cover every foreign key with an index (advisor 0001), so deletes and joins stay cheap.
create index if not exists access_codes_created_by on public.access_codes (created_by);
create index if not exists articles_created_by on public.articles (created_by);
create index if not exists articles_hero_media on public.articles (hero_media_id);
create index if not exists campaign_members_enrolled_via on public.campaign_members (enrolled_via);
create index if not exists campaign_settings_banner on public.campaign_settings (banner_media_id);
create index if not exists map_markers_article on public.map_markers (article_id);
create index if not exists maps_article on public.maps (article_id);
create index if not exists maps_media on public.maps (media_id);
create index if not exists maps_parent on public.maps (parent_map_id);
create index if not exists media_created_by on public.media (created_by);
create index if not exists redirects_article on public.redirects (article_id);
create index if not exists revisions_created_by on public.revisions (created_by);
create index if not exists timeline_events_article on public.timeline_events (article_id);
