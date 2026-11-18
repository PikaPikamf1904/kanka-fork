-- The party's Investigation Board: one campaign-wide board with mystery sections (groups),
-- pinned evidence, sticky notes, theory cards and labelled connections.
--
-- * Every active member reads and adds to the board; assistants (OAuth/MCP) get nothing.
-- * A pin stores only the kind and id of what it pins. It can be added only if the person
--   pinning can read that thing right now (checked under their own RLS). The DM may pin only what
--   players can read, so a DM pin never puts a hidden page's id on the party board.
-- * A pin whose target is hidden later shows as "no longer available": the website resolves each
--   pin under the reader's own RLS. Nothing about the target is copied onto the board.
-- * Anyone may move cards, change marks and set a theory's status (collaborative). Only the
--   author or the DM may change a card's text and colour or delete it.
-- * Moves and edits carry a version: a client updates "where version = loaded", so a stale edit
--   changes nothing and the client reloads instead of overwriting.
-- * Activity history records who did what to which card, using only text players wrote.
-- * Theories on the board are never wiki canon: nothing here feeds search, the graph or articles.
--
-- Rollback (local only): drop the triggers and functions below and
-- `drop table public.board_activity, public.board_links, public.board_items, public.board_groups`.

create table if not exists public.board_groups (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  colour text not null default 'amber' check (colour in ('parchment', 'crimson', 'azure', 'emerald', 'amber', 'violet', 'slate')),
  position integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists board_groups_created_by on public.board_groups (created_by);

create table if not exists public.board_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('pin', 'note', 'theory')),
  ref_type text check (ref_type in ('article', 'map', 'map_marker', 'timeline_event', 'media', 'clue')),
  ref_id uuid,
  group_id uuid references public.board_groups (id) on delete set null,
  title text not null default '' check (char_length(title) <= 120),
  body text not null default '' check (char_length(body) <= 2000),
  colour text not null default 'parchment' check (colour in ('parchment', 'crimson', 'azure', 'emerald', 'amber', 'violet', 'slate')),
  marks text[] not null default '{}' check (marks <@ array['suspicious', 'important', 'investigated', 'unconfirmed']::text[]),
  theory_status text check (theory_status in ('unresolved', 'solved', 'disproven')),
  x real not null default 0 check (x between -20000 and 20000),
  y real not null default 0 check (y between -20000 and 20000),
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  author_name text not null default '',
  is_dm boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'pin') = (ref_type is not null and ref_id is not null)),
  check ((kind = 'theory') = (theory_status is not null)),
  check (kind = 'pin' or char_length(btrim(title)) between 1 and 120)
);
create index if not exists board_items_group on public.board_items (group_id);
create index if not exists board_items_created_by on public.board_items (created_by);

create table if not exists public.board_links (
  id uuid primary key default gen_random_uuid(),
  from_item uuid not null references public.board_items (id) on delete cascade,
  to_item uuid not null references public.board_items (id) on delete cascade,
  label text not null default '' check (char_length(label) <= 80),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_item <> to_item)
);
create unique index if not exists board_links_pair on public.board_links (least(from_item, to_item), greatest(from_item, to_item));
create index if not exists board_links_from on public.board_links (from_item);
create index if not exists board_links_to on public.board_links (to_item);
create index if not exists board_links_created_by on public.board_links (created_by);

create table if not exists public.board_activity (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_name text not null default '',
  action text not null check (action in ('added', 'edited', 'removed', 'linked', 'unlinked', 'status')),
  item_id uuid references public.board_items (id) on delete set null,
  item_kind text not null,
  -- Only text a member wrote (a note or theory title, a connection label, a status); never the
  -- title of a pinned page.
  detail text not null default '' check (char_length(detail) <= 160)
);
create index if not exists board_activity_at on public.board_activity (at desc);
create index if not exists board_activity_item on public.board_activity (item_id);

alter table public.board_groups enable row level security;
alter table public.board_items enable row level security;
alter table public.board_links enable row level security;
alter table public.board_activity enable row level security;

revoke all on public.board_groups, public.board_items, public.board_links, public.board_activity from anon, authenticated;
grant select, insert, update, delete on public.board_groups, public.board_items to authenticated;
grant select, insert, delete on public.board_links to authenticated;
grant update (label) on public.board_links to authenticated;
grant select on public.board_activity to authenticated;

--------------------------------------------------------------------------------
-- Guards
--------------------------------------------------------------------------------
create or replace function private.board_member()
returns boolean language sql stable set search_path = ''
as $$
  select private.is_member() and not private.is_oauth_request();
$$;

-- SECURITY INVOKER on purpose: the existence checks run under the caller's own RLS.
create or replace function private.board_ref_readable(p_type text, p_id uuid)
returns boolean language plpgsql stable set search_path = ''
as $$
begin
  if private.is_dm() then
    -- The DM sees everything, so check what PLAYERS can read instead.
    return case p_type
      when 'article' then exists (select 1 from public.articles a where a.id = p_id and a.visibility = 'players' and a.status = 'published')
      when 'map' then exists (select 1 from public.maps m where m.id = p_id and m.visibility = 'players' and m.status = 'published')
      when 'clue' then exists (select 1 from public.clues c where c.id = p_id and private.mystery_open(c.mystery_id)
                               and (c.released_at is not null or c.release_at <= now()))
      else false
    end;
  end if;
  return case p_type
    when 'article' then exists (select 1 from public.articles a where a.id = p_id)
    when 'map' then exists (select 1 from public.maps m where m.id = p_id)
    when 'map_marker' then exists (select 1 from public.map_markers mk where mk.id = p_id)
    when 'timeline_event' then exists (select 1 from public.timeline_events t where t.id = p_id)
    when 'media' then exists (select 1 from public.media md where md.id = p_id)
    when 'clue' then exists (select 1 from public.clues c where c.id = p_id)
    else false
  end;
end;
$$;

create or replace function private.board_items_before()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_author boolean;
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.author_name := coalesce((select m.display_name from public.campaign_members m where m.user_id = (select auth.uid())), '');
    new.is_dm := private.is_dm();
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
    if new.kind = 'pin' and not private.board_ref_readable(new.ref_type, new.ref_id) then
      raise exception 'Only things the whole party can see can be pinned' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('chronicle.board', 0));
    if (select count(*) from public.board_items) >= 500 then
      raise exception 'The board is full (500 cards). Remove some first.' using errcode = '54000';
    end if;
    if not private.is_dm() and (select count(*) from public.board_items
        where created_by = (select auth.uid()) and created_at > now() - interval '1 hour') >= 30 then
      raise exception 'You have added a lot of cards this hour. Try again later.' using errcode = '54000';
    end if;
    return new;
  end if;

  -- UPDATE: identity and target never change.
  if new.kind is distinct from old.kind or new.ref_type is distinct from old.ref_type or new.ref_id is distinct from old.ref_id
     or new.created_by is distinct from old.created_by or new.author_name is distinct from old.author_name
     or new.is_dm is distinct from old.is_dm or new.created_at is distinct from old.created_at then
    raise exception 'That part of a card cannot change' using errcode = '42501';
  end if;
  -- coalesce: a card whose author left (created_by null) is editable only by the DM.
  v_author := coalesce(old.created_by = (select auth.uid()), false) or private.is_dm();
  if not v_author and (new.title is distinct from old.title or new.body is distinct from old.body or new.colour is distinct from old.colour) then
    raise exception 'Only the person who wrote this card (or the DM) can change its text or colour' using errcode = '42501';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists board_items_guard on public.board_items;
create trigger board_items_guard before insert or update on public.board_items
  for each row execute function private.board_items_before();

create or replace function private.board_groups_before()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
    if (select count(*) from public.board_groups) >= 50 then
      raise exception 'There are already 50 mystery sections' using errcode = '54000';
    end if;
  elsif new.created_by is distinct from old.created_by then
    raise exception 'That part of a section cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists board_groups_guard on public.board_groups;
create trigger board_groups_guard before insert or update on public.board_groups
  for each row execute function private.board_groups_before();

create or replace function private.board_links_before()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
    perform pg_advisory_xact_lock(hashtextextended('chronicle.board', 1));
    if (select count(*) from public.board_links) >= 1000 then
      raise exception 'The board has 1000 connections already' using errcode = '54000';
    end if;
  elsif new.created_by is distinct from old.created_by or new.from_item <> old.from_item or new.to_item <> old.to_item then
    raise exception 'Only the label of a connection can change' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists board_links_guard on public.board_links;
create trigger board_links_guard before insert or update on public.board_links
  for each row execute function private.board_links_before();

-- Activity: written by the database, never by clients.
create or replace function private.board_log()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_actor text := coalesce((select m.display_name from public.campaign_members m where m.user_id = (select auth.uid())), '');
  v_title text;
begin
  if tg_table_name = 'board_items' then
    v_title := case when coalesce(new.kind, old.kind) = 'pin' then '' else left(coalesce(new.title, old.title), 160) end;
    if tg_op = 'INSERT' then
      insert into public.board_activity (actor_name, action, item_id, item_kind, detail) values (v_actor, 'added', new.id, new.kind, v_title);
    elsif tg_op = 'DELETE' then
      insert into public.board_activity (actor_name, action, item_id, item_kind, detail) values (v_actor, 'removed', null, old.kind, v_title);
    elsif new.theory_status is distinct from old.theory_status then
      insert into public.board_activity (actor_name, action, item_id, item_kind, detail) values (v_actor, 'status', new.id, new.kind, left(v_title || ': ' || new.theory_status, 160));
    elsif new.title is distinct from old.title or new.body is distinct from old.body or new.marks is distinct from old.marks then
      insert into public.board_activity (actor_name, action, item_id, item_kind, detail) values (v_actor, 'edited', new.id, new.kind, v_title);
    end if;
  else
    if tg_op = 'INSERT' then
      insert into public.board_activity (actor_name, action, item_id, item_kind, detail) values (v_actor, 'linked', new.from_item, 'link', left(new.label, 160));
    elsif tg_op = 'DELETE' then
      insert into public.board_activity (actor_name, action, item_id, item_kind, detail) values (v_actor, 'unlinked', null, 'link', left(old.label, 160));
    end if;
  end if;
  -- Keep the history bounded.
  delete from public.board_activity where id in (select id from public.board_activity order by id desc offset 2000);
  return null;
end;
$$;

drop trigger if exists board_items_log on public.board_items;
create trigger board_items_log after insert or update or delete on public.board_items
  for each row execute function private.board_log();
drop trigger if exists board_links_log on public.board_links;
create trigger board_links_log after insert or delete on public.board_links
  for each row execute function private.board_log();

--------------------------------------------------------------------------------
-- Policies
--------------------------------------------------------------------------------
drop policy if exists board_groups_read on public.board_groups;
create policy board_groups_read on public.board_groups for select to authenticated using ((select private.board_member()));
drop policy if exists board_groups_insert on public.board_groups;
create policy board_groups_insert on public.board_groups for insert to authenticated with check ((select private.board_member()));
drop policy if exists board_groups_change on public.board_groups;
create policy board_groups_change on public.board_groups for update to authenticated
  using ((select private.board_member()) and (created_by = (select auth.uid()) or (select private.is_dm())))
  with check ((select private.board_member()));
drop policy if exists board_groups_delete on public.board_groups;
create policy board_groups_delete on public.board_groups for delete to authenticated
  using ((select private.board_member()) and (created_by = (select auth.uid()) or (select private.is_dm())));

drop policy if exists board_items_read on public.board_items;
create policy board_items_read on public.board_items for select to authenticated using ((select private.board_member()));
drop policy if exists board_items_insert on public.board_items;
create policy board_items_insert on public.board_items for insert to authenticated with check ((select private.board_member()));
drop policy if exists board_items_update on public.board_items;
create policy board_items_update on public.board_items for update to authenticated
  using ((select private.board_member())) with check ((select private.board_member()));
drop policy if exists board_items_delete on public.board_items;
create policy board_items_delete on public.board_items for delete to authenticated
  using ((select private.board_member()) and (created_by = (select auth.uid()) or (select private.is_dm())));

drop policy if exists board_links_read on public.board_links;
create policy board_links_read on public.board_links for select to authenticated using ((select private.board_member()));
drop policy if exists board_links_insert on public.board_links;
create policy board_links_insert on public.board_links for insert to authenticated with check ((select private.board_member()));
drop policy if exists board_links_update on public.board_links;
create policy board_links_update on public.board_links for update to authenticated
  using ((select private.board_member()) and (created_by = (select auth.uid()) or (select private.is_dm())))
  with check ((select private.board_member()));
drop policy if exists board_links_delete on public.board_links;
create policy board_links_delete on public.board_links for delete to authenticated
  using ((select private.board_member()) and (created_by = (select auth.uid()) or (select private.is_dm())));

drop policy if exists board_activity_read on public.board_activity;
create policy board_activity_read on public.board_activity for select to authenticated using ((select private.board_member()));

revoke all on function private.board_member(), private.board_ref_readable(text, uuid), private.board_items_before(),
  private.board_groups_before(), private.board_links_before(), private.board_log() from public, anon;
grant execute on function private.board_member(), private.board_ref_readable(text, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
