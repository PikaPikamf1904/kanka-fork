-- Knowledge Studio: research collections of wiki pages with topics, annotations, excerpts and
-- cited research summaries.
--
-- * A collection is private to its owner by default. A PLAYER may share one with the party
--   (read-only for the other members, including the DM). The DM's collections cannot be shared:
--   the DM can read hidden material, and the party board and wiki are the DM's ways to share.
-- * A source can be added only if the owner can read the page right now (checked under their own
--   RLS). Only the page id is stored; a page hidden later shows as unavailable to everyone,
--   because readers resolve it under their own RLS.
-- * Excerpts and annotations are the owner's own copy of text they could read, or their own words.
-- * Research summaries cite sources by their position; nothing here changes the wiki.
-- * No AI is used. A later, separately approved feature could answer questions from a reader's
--   own readable sources; that would run under the reader's RLS and need its own review.
-- * Assistants (OAuth/MCP) get nothing.
--
-- Rollback (local only): `drop table public.research_notes, public.research_sources, public.research_collections`.

create table if not exists public.research_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists research_collections_user on public.research_collections (user_id);

create table if not exists public.research_sources (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.research_collections (id) on delete cascade,
  article_id uuid not null references public.articles (id) on delete cascade,
  topic text not null default '' check (char_length(topic) <= 60),
  annotation text not null default '' check (char_length(annotation) <= 4000),
  excerpt text not null default '' check (char_length(excerpt) <= 4000),
  position integer not null default 0,
  added_at timestamptz not null default now(),
  unique (collection_id, article_id)
);
create index if not exists research_sources_article on public.research_sources (article_id);

create table if not exists public.research_notes (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.research_collections (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null default '' check (char_length(body) <= 10000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists research_notes_collection on public.research_notes (collection_id);

alter table public.research_collections enable row level security;
alter table public.research_sources enable row level security;
alter table public.research_notes enable row level security;
revoke all on public.research_collections, public.research_sources, public.research_notes from anon, authenticated;
grant select, insert, update, delete on public.research_collections, public.research_sources, public.research_notes to authenticated;

--------------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER only to read the collection row without policy recursion; each
-- answers only about the caller).
--------------------------------------------------------------------------------
create or replace function private.owns_collection(p_collection uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.research_collections c where c.id = p_collection and c.user_id = (select auth.uid()));
$$;

create or replace function private.can_read_collection(p_collection uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.research_collections c
                 where c.id = p_collection and (c.user_id = (select auth.uid()) or c.shared));
$$;

create or replace function private.research_before()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_table_name = 'research_collections' then
    if tg_op = 'INSERT' then
      -- Signed-in callers always own what they create; the fallback is for server-side fixtures.
      new.user_id := coalesce((select auth.uid()), new.user_id);
      new.created_at := now();
      if (select count(*) from public.research_collections where user_id = new.user_id) >= 100 then
        raise exception 'You already have 100 collections' using errcode = '54000';
      end if;
    elsif new.user_id is distinct from old.user_id then
      raise exception 'The owner of a collection cannot change' using errcode = '42501';
    end if;
    if new.shared and exists (select 1 from public.campaign_members m where m.user_id = new.user_id and m.role = 'dm') then
      raise exception 'The DM''s research stays private; share with players through the wiki or the board' using errcode = '42501';
    end if;
    new.updated_at := now();
  elsif tg_table_name = 'research_sources' then
    if tg_op = 'INSERT' and (select count(*) from public.research_sources where collection_id = new.collection_id) >= 500 then
      raise exception 'A collection holds at most 500 sources' using errcode = '54000';
    end if;
    if tg_op = 'UPDATE' and (new.collection_id <> old.collection_id or new.article_id <> old.article_id) then
      raise exception 'Add the page again instead' using errcode = '42501';
    end if;
  else
    if tg_op = 'INSERT' then
      new.version := 1;
      if (select count(*) from public.research_notes where collection_id = new.collection_id) >= 200 then
        raise exception 'A collection holds at most 200 summaries' using errcode = '54000';
      end if;
    else
      if new.collection_id <> old.collection_id then
        raise exception 'A summary cannot move between collections' using errcode = '42501';
      end if;
      new.version := old.version + 1;
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists research_collections_guard on public.research_collections;
create trigger research_collections_guard before insert or update on public.research_collections
  for each row execute function private.research_before();
drop trigger if exists research_sources_guard on public.research_sources;
create trigger research_sources_guard before insert or update on public.research_sources
  for each row execute function private.research_before();
drop trigger if exists research_notes_guard on public.research_notes;
create trigger research_notes_guard before insert or update on public.research_notes
  for each row execute function private.research_before();

--------------------------------------------------------------------------------
-- Policies
--------------------------------------------------------------------------------
drop policy if exists collections_read on public.research_collections;
create policy collections_read on public.research_collections for select to authenticated
  using ((select private.is_member()) and not (select private.is_oauth_request()) and (user_id = (select auth.uid()) or shared));
drop policy if exists collections_write on public.research_collections;
create policy collections_write on public.research_collections for all to authenticated
  using ((select private.is_member()) and not (select private.is_oauth_request()) and user_id = (select auth.uid()))
  with check ((select private.is_member()) and not (select private.is_oauth_request()) and user_id = (select auth.uid()));

drop policy if exists sources_read on public.research_sources;
create policy sources_read on public.research_sources for select to authenticated
  using ((select private.is_member()) and not (select private.is_oauth_request()) and private.can_read_collection(collection_id));
-- The page check runs under the caller's own RLS on articles.
drop policy if exists sources_insert on public.research_sources;
create policy sources_insert on public.research_sources for insert to authenticated
  with check ((select private.is_member()) and not (select private.is_oauth_request()) and private.owns_collection(collection_id)
              and exists (select 1 from public.articles a where a.id = research_sources.article_id));
drop policy if exists sources_update on public.research_sources;
create policy sources_update on public.research_sources for update to authenticated
  using ((select private.is_member()) and not (select private.is_oauth_request()) and private.owns_collection(collection_id))
  with check ((select private.is_member()) and not (select private.is_oauth_request()) and private.owns_collection(collection_id)
              and exists (select 1 from public.articles a where a.id = research_sources.article_id));
drop policy if exists sources_delete on public.research_sources;
create policy sources_delete on public.research_sources for delete to authenticated
  using ((select private.is_member()) and not (select private.is_oauth_request()) and private.owns_collection(collection_id));

drop policy if exists notes_read on public.research_notes;
create policy notes_read on public.research_notes for select to authenticated
  using ((select private.is_member()) and not (select private.is_oauth_request()) and private.can_read_collection(collection_id));
drop policy if exists notes_write on public.research_notes;
create policy notes_write on public.research_notes for all to authenticated
  using ((select private.is_member()) and not (select private.is_oauth_request()) and private.owns_collection(collection_id))
  with check ((select private.is_member()) and not (select private.is_oauth_request()) and private.owns_collection(collection_id));

revoke all on function private.owns_collection(uuid), private.can_read_collection(uuid), private.research_before() from public, anon;
grant execute on function private.owns_collection(uuid), private.can_read_collection(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
