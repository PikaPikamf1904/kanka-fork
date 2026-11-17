-- Mystery Studio: DM-prepared clues released between sessions (an ARG layer on the wiki).
--
-- Nothing unreleased can leak. A player can select a clue only when ALL hold:
--   * its mystery is 'active' or 'concluded' (a draft or archived mystery shows nothing);
--   * it has been released by hand (released_at) or its scheduled time has passed (release_at);
--   * the page or map it is attached to is readable by that player;
--   * its prerequisite clue, if any, has been discovered by that player.
-- These are checked in the database on every read, so unreleased clues never reach a response,
-- a search, the graph, a count or the board. Mysteries themselves (titles, summaries, DM notes)
-- are DM-only; players see only a spoiler-safe name through public.mystery_index(), and only once
-- at least one clue of that mystery is visible to them.
--
-- The DM writes the story. The website never invents or publishes canon on its own.
-- Assistants (OAuth/MCP) can neither read nor write any of it.
--
-- Rollback (local only): drop the functions below and
-- `drop table public.clue_discoveries, public.clue_hints, public.clues, public.mysteries`.

create table if not exists public.mysteries (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  player_title text not null default '' check (char_length(player_title) <= 120),
  summary text not null default '' check (char_length(summary) <= 5000),
  dm_notes text not null default '' check (char_length(dm_notes) <= 20000),
  status text not null default 'draft' check (status in ('draft', 'active', 'concluded', 'archived')),
  colour text not null default 'amber' check (colour in ('parchment', 'crimson', 'azure', 'emerald', 'amber', 'violet', 'slate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clues (
  id uuid primary key default gen_random_uuid(),
  mystery_id uuid not null references public.mysteries (id) on delete cascade,
  kind text not null default 'note'
    check (kind in ('letter', 'document', 'notice', 'correspondence', 'symbol', 'note')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null default '' check (char_length(body) <= 20000),
  -- In-world signature or source line, e.g. "Sealed with the mark of the Blue Wing".
  source_line text not null default '' check (char_length(source_line) <= 160),
  attach_article_id uuid references public.articles (id) on delete set null,
  attach_map_id uuid references public.maps (id) on delete set null,
  requires_clue_id uuid references public.clues (id) on delete set null,
  release_at timestamptz,
  released_at timestamptz,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attach_article_id is null or attach_map_id is null),
  check (requires_clue_id is null or requires_clue_id <> id)
);
create index if not exists clues_mystery on public.clues (mystery_id);
create index if not exists clues_article on public.clues (attach_article_id);
create index if not exists clues_map on public.clues (attach_map_id);
create index if not exists clues_requires on public.clues (requires_clue_id);

create table if not exists public.clue_hints (
  id uuid primary key default gen_random_uuid(),
  clue_id uuid not null references public.clues (id) on delete cascade,
  position integer not null default 0,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  release_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists clue_hints_clue on public.clue_hints (clue_id);

create table if not exists public.clue_discoveries (
  clue_id uuid not null references public.clues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  discovered_at timestamptz not null default now(),
  primary key (clue_id, user_id)
);
create index if not exists clue_discoveries_user on public.clue_discoveries (user_id);

alter table public.mysteries enable row level security;
alter table public.clues enable row level security;
alter table public.clue_hints enable row level security;
alter table public.clue_discoveries enable row level security;

revoke all on public.mysteries, public.clues, public.clue_hints, public.clue_discoveries from anon, authenticated;
grant select, insert, update, delete on public.mysteries, public.clues, public.clue_hints to authenticated;
grant select, insert, delete on public.clue_discoveries to authenticated;

--------------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------------
create or replace function private.mystery_open(p_mystery uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.mysteries m where m.id = p_mystery and m.status in ('active', 'concluded'));
$$;

-- Has the CALLER discovered this clue? (SECURITY DEFINER to avoid policy recursion between
-- clues and clue_discoveries; it only ever answers about auth.uid().)
create or replace function private.discovered_by_me(p_clue uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.clue_discoveries d where d.clue_id = p_clue and d.user_id = (select auth.uid()));
$$;

-- Spoiler-safe label for an open mystery; null otherwise. Callers must already be allowed to see
-- a clue of that mystery (mystery_index only passes ids of clues the reader can select).
create or replace function private.mystery_label(p_mystery uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('title', coalesce(nullif(btrim(m.player_title), ''), 'An unnamed mystery'),
                            'colour', m.colour, 'status', m.status)
  from public.mysteries m where m.id = p_mystery and m.status in ('active', 'concluded');
$$;

-- private.touch_updated_at() comes from 20261109000100_core_schema.sql.
drop trigger if exists mysteries_touch on public.mysteries;
create trigger mysteries_touch before update on public.mysteries for each row execute function private.touch_updated_at();
drop trigger if exists clues_touch on public.clues;
create trigger clues_touch before update on public.clues for each row execute function private.touch_updated_at();

--------------------------------------------------------------------------------
-- Policies
--------------------------------------------------------------------------------
drop policy if exists mysteries_dm on public.mysteries;
create policy mysteries_dm on public.mysteries for all to authenticated
  using ((select private.is_dm()) and not (select private.is_oauth_request()))
  with check ((select private.is_dm()) and not (select private.is_oauth_request()));

drop policy if exists clues_dm on public.clues;
create policy clues_dm on public.clues for all to authenticated
  using ((select private.is_dm()) and not (select private.is_oauth_request()))
  with check ((select private.is_dm()) and not (select private.is_oauth_request()));

-- The subqueries on articles, maps and clue_discoveries run under the reader's own RLS.
drop policy if exists clues_player_read on public.clues;
create policy clues_player_read on public.clues for select to authenticated
  using (
    (select private.is_member()) and not (select private.is_oauth_request())
    and private.mystery_open(mystery_id)
    and (released_at is not null or release_at <= now())
    and (attach_article_id is null or exists (select 1 from public.articles a where a.id = clues.attach_article_id))
    and (attach_map_id is null or exists (select 1 from public.maps m where m.id = clues.attach_map_id))
    and (requires_clue_id is null or private.discovered_by_me(requires_clue_id))
  );

drop policy if exists hints_dm on public.clue_hints;
create policy hints_dm on public.clue_hints for all to authenticated
  using ((select private.is_dm()) and not (select private.is_oauth_request()))
  with check ((select private.is_dm()) and not (select private.is_oauth_request()));

drop policy if exists hints_player_read on public.clue_hints;
create policy hints_player_read on public.clue_hints for select to authenticated
  using (
    (select private.is_member()) and not (select private.is_oauth_request())
    and (released_at is not null or release_at <= now())
    and exists (select 1 from public.clues c where c.id = clue_hints.clue_id)
  );

drop policy if exists discoveries_read on public.clue_discoveries;
create policy discoveries_read on public.clue_discoveries for select to authenticated
  using (not (select private.is_oauth_request())
         and ((select private.is_dm()) or (user_id = (select auth.uid()) and (select private.is_member()))));

-- A player records their own discovery, and only of a clue they can see right now.
drop policy if exists discoveries_insert on public.clue_discoveries;
create policy discoveries_insert on public.clue_discoveries for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request())
              and exists (select 1 from public.clues c where c.id = clue_discoveries.clue_id));

drop policy if exists discoveries_delete on public.clue_discoveries;
create policy discoveries_delete on public.clue_discoveries for delete to authenticated
  using (not (select private.is_oauth_request())
         and ((select private.is_dm()) or (user_id = (select auth.uid()) and (select private.is_member()))));

--------------------------------------------------------------------------------
-- Player mystery index: one row per mystery with at least one clue the caller can see.
-- SECURITY INVOKER, so the clue rows counted are exactly those RLS returns to the caller.
--------------------------------------------------------------------------------
create or replace function public.mystery_index()
returns table (id uuid, title text, colour text, status text, clues bigint, discovered bigint)
language sql stable security invoker set search_path = ''
as $$
  select c.mystery_id,
         private.mystery_label(c.mystery_id) ->> 'title',
         private.mystery_label(c.mystery_id) ->> 'colour',
         private.mystery_label(c.mystery_id) ->> 'status',
         count(*),
         count(d.clue_id)
  from public.clues c
  left join public.clue_discoveries d on d.clue_id = c.id and d.user_id = (select auth.uid())
  where not private.is_oauth_request()
  group by c.mystery_id
  having private.mystery_label(c.mystery_id) is not null
  order by 2;
$$;

--------------------------------------------------------------------------------
-- DM: preview which clues a given player can see right now (same rules as the player policy,
-- evaluated for that player: pages and maps players can read, that player's discoveries).
--------------------------------------------------------------------------------
create or replace function public.dm_preview_clues(p_user uuid)
returns table (id uuid, mystery_id uuid, title text, discovered boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_dm() or private.is_oauth_request() then
    raise exception 'Only the DM can preview clues' using errcode = '42501';
  end if;
  if not exists (select 1 from public.campaign_members m where m.user_id = p_user and m.role = 'player' and m.revoked_at is null) then
    return;
  end if;
  return query
    select c.id, c.mystery_id, c.title,
           exists (select 1 from public.clue_discoveries d where d.clue_id = c.id and d.user_id = p_user)
    from public.clues c
    join public.mysteries m on m.id = c.mystery_id and m.status in ('active', 'concluded')
    where (c.released_at is not null or c.release_at <= now())
      and (c.attach_article_id is null or exists (select 1 from public.articles a where a.id = c.attach_article_id and a.visibility = 'players' and a.status = 'published'))
      and (c.attach_map_id is null or exists (select 1 from public.maps mp where mp.id = c.attach_map_id and mp.visibility = 'players' and mp.status = 'published'))
      and (c.requires_clue_id is null or exists (select 1 from public.clue_discoveries d where d.clue_id = c.requires_clue_id and d.user_id = p_user))
    order by c.position, c.title;
end;
$$;

revoke all on function private.mystery_open(uuid), private.mystery_label(uuid), private.discovered_by_me(uuid) from public, anon;
grant execute on function private.mystery_open(uuid), private.mystery_label(uuid), private.discovered_by_me(uuid) to authenticated, service_role;
revoke all on function public.mystery_index(), public.dm_preview_clues(uuid) from public, anon;
grant execute on function public.mystery_index(), public.dm_preview_clues(uuid) to authenticated;

notify pgrst, 'reload schema';
