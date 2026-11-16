-- Chronicle cloud: fog of war on maps.
--
-- maps.fog_enabled      when true, the map is drawn covered by fog except for revealed areas.
-- map_fog_areas         areas the DM has drawn on a map, as polygons in image pixels (x from the
--                       left, y from the top, the same as map markers). visibility 'players' means
--                       revealed; 'dm' means drawn but still fogged for players.
--
-- Players only ever receive revealed areas of maps they can read; the DM receives all of them.
-- The fog is drawn by the browser over the full map image, so it is a visual cover, not access
-- control for the image itself (see docs/chronicle/MAP-FOG.md). Hidden markers stay hidden by their
-- own visibility, as before.
--
-- Rollback:
--   drop table if exists public.map_fog_areas;
--   alter table public.maps drop column if exists fog_enabled;

alter table public.maps add column if not exists fog_enabled boolean not null default false;

create table if not exists public.map_fog_areas (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.maps (id) on delete cascade,
  label text not null default '' check (char_length(label) <= 120),
  -- [[x, y], ...] with 3 to 200 points.
  points jsonb not null check (
    jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 3 and 200
  ),
  visibility public.content_visibility not null default 'dm',
  created_at timestamptz not null default now()
);
create index if not exists map_fog_areas_map on public.map_fog_areas (map_id);

alter table public.map_fog_areas enable row level security;

revoke all on public.map_fog_areas from anon, authenticated;
grant select, insert, update, delete on public.map_fog_areas to authenticated;
grant all on public.map_fog_areas to service_role;

drop policy if exists fog_read on public.map_fog_areas;
create policy fog_read on public.map_fog_areas for select to authenticated
  using ((select private.is_dm()) or ((select private.is_member()) and visibility = 'players'
    and exists (select 1 from public.maps m where m.id = map_fog_areas.map_id and m.visibility = 'players' and m.status = 'published')));

drop policy if exists fog_dm on public.map_fog_areas;
create policy fog_dm on public.map_fog_areas for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));
