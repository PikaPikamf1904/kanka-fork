-- Where the party is stays private unless the page is visible to players. Requires 20261115000100.
-- Forward-only; not authorized for production until the owner approves the migration bundle.
--
-- Reproduced before this migration: any member could read campaign_settings.current_location_id
-- through the Data API, so a player learned the id of a DM-only location page (and could tell when
-- the party moved, even to a secret place). Row Level Security cannot hide one column of a row
-- players may otherwise read, so:
--   * the column is no longer readable directly (column-level SELECT privileges);
--   * public.campaign_location() returns the location to the DM, and to a member only when that
--     page is published to players. Everyone else gets no row: "not set" and "hidden" look the same.
-- Writing the column is unchanged (DM only, through the settings policy).
--
-- Deployment order: deploy the website from this branch first (it uses the function when it exists
-- and falls back to the old read otherwise), then apply this migration.
--
-- Forward recovery: grant select on public.campaign_settings to authenticated, and drop
-- public.campaign_location(), in a new reviewed migration.

revoke select on public.campaign_settings from authenticated;
grant select (id, title, tagline, overview, banner_media_id, updated_at, current_status) on public.campaign_settings to authenticated;

create or replace function public.campaign_location()
returns table (id uuid, slug text, title text, type public.article_type)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.slug, a.title, a.type
  from public.campaign_settings s
  join public.articles a on a.id = s.current_location_id
  where private.is_member()
    and (private.is_dm() or (a.visibility = 'players' and a.status = 'published'));
$$;
revoke all on function public.campaign_location() from public, anon;
grant execute on function public.campaign_location() to authenticated;

notify pgrst, 'reload schema';
