-- Reader notes: saved pages and reading lists, a private scratchpad, and character journals.
-- Forward-only and idempotent; not authorized for production until the owner approves the bundle.
--
--   reading_lists, bookmarks, scratchpad_notes   strictly owner-only (the DM gets no policy)
--   journal_entries, journal_entry_links         owner read/write; the DM can READ every entry
--
-- Every policy requires an active member and refuses assistant (OAuth) connections. user_id is
-- forced to the caller by a trigger and never changes. No title or address of a page is stored:
-- a row holds only the page id, and every insert/update must name a page the caller can read
-- right now (the check runs under the caller's own Row Level Security, never in a security
-- definer function). The website resolves ids back to pages under RLS and leaves out any page
-- that is no longer readable.
--
-- Forward recovery: drop public.reorder_bookmarks, public.save_scratchpad, public.save_journal_entry,
-- the four private.guard_* functions and the five tables in a new reviewed migration (nothing
-- else depends on them).

-------------------------------------------------------------------------------
-- Shared trigger helpers
-------------------------------------------------------------------------------
-- Forces user_id to the caller on insert (a server-side insert with no signed-in user keeps the
-- value it names, e.g. test fixtures) and refuses to change it afterwards.
create or replace function private.guard_owner_row()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce((select auth.uid()), new.user_id);
    if new.user_id is null then
      raise exception 'A signed-in user is required' using errcode = '42501';
    end if;
  elsif new.user_id is distinct from old.user_id then
    raise exception 'The owner of this row cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Per-user caps, with a clear message. Counted for the row's owner only (the DM can read other
-- people's journal entries, so the count must not rely on RLS).
create or replace function private.guard_owner_cap()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_cap int := tg_argv[1]::int;
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || new.user_id::text, 0));
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into v_count using new.user_id;
  if v_count >= v_cap then
    perform private.fail('VALIDATION_FAILED', format('You can keep at most %s %s. Remove some first.', v_cap, tg_argv[0]));
  end if;
  return new;
end;
$$;

revoke all on function private.guard_owner_row(), private.guard_owner_cap() from public, anon;
grant execute on function private.guard_owner_row(), private.guard_owner_cap() to authenticated, service_role;

-------------------------------------------------------------------------------
-- 1. Reading lists
-------------------------------------------------------------------------------
create table if not exists public.reading_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reading_lists_user on public.reading_lists (user_id, position);
create unique index if not exists reading_lists_user_name on public.reading_lists (user_id, lower(name));

create or replace function private.guard_reading_list()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.name := trim(new.name);
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; end if;
  return new;
end;
$$;
revoke all on function private.guard_reading_list() from public, anon;
grant execute on function private.guard_reading_list() to authenticated, service_role;

drop trigger if exists reading_lists_1_owner on public.reading_lists;
create trigger reading_lists_1_owner before insert or update on public.reading_lists
  for each row execute function private.guard_owner_row();
drop trigger if exists reading_lists_2_cap on public.reading_lists;
create trigger reading_lists_2_cap before insert on public.reading_lists
  for each row execute function private.guard_owner_cap('reading lists', '50');
drop trigger if exists reading_lists_3_shape on public.reading_lists;
create trigger reading_lists_3_shape before insert or update on public.reading_lists
  for each row execute function private.guard_reading_list();

alter table public.reading_lists enable row level security;
revoke all on public.reading_lists from anon, authenticated;
grant select, insert, delete on public.reading_lists to authenticated;
grant update (name, position) on public.reading_lists to authenticated;
grant all on public.reading_lists to service_role;
drop policy if exists reading_lists_1_owner on public.reading_lists;
create policy reading_lists_1_owner on public.reading_lists for all to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request()))
  with check (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request()));

-------------------------------------------------------------------------------
-- 2. Bookmarks
-------------------------------------------------------------------------------
create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  article_id uuid not null references public.articles (id) on delete cascade,
  list_id uuid references public.reading_lists (id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists bookmarks_user on public.bookmarks (user_id, list_id, position);
create index if not exists bookmarks_article on public.bookmarks (article_id);
create index if not exists bookmarks_list on public.bookmarks (list_id);
create unique index if not exists bookmarks_unique on public.bookmarks (user_id, article_id, list_id) nulls not distinct;

drop trigger if exists bookmarks_1_owner on public.bookmarks;
create trigger bookmarks_1_owner before insert or update on public.bookmarks
  for each row execute function private.guard_owner_row();
drop trigger if exists bookmarks_2_cap on public.bookmarks;
create trigger bookmarks_2_cap before insert on public.bookmarks
  for each row execute function private.guard_owner_cap('saved pages', '1000');

alter table public.bookmarks enable row level security;
revoke all on public.bookmarks from anon, authenticated;
grant select, insert, delete on public.bookmarks to authenticated;
grant update (list_id, position) on public.bookmarks to authenticated;
grant all on public.bookmarks to service_role;
drop policy if exists bookmarks_select on public.bookmarks;
create policy bookmarks_select on public.bookmarks for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request()));
drop policy if exists bookmarks_delete on public.bookmarks;
create policy bookmarks_delete on public.bookmarks for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request()));
-- The page subquery runs under the caller's own RLS on public.articles (no security definer), so
-- a page the caller cannot read is refused; the list subquery likewise only sees the caller's lists.
drop policy if exists bookmarks_insert on public.bookmarks;
create policy bookmarks_insert on public.bookmarks for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request())
    and exists (select 1 from public.articles a where a.id = article_id)
    and (list_id is null or exists (select 1 from public.reading_lists l where l.id = list_id and l.user_id = (select auth.uid()))));
drop policy if exists bookmarks_update on public.bookmarks;
create policy bookmarks_update on public.bookmarks for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request()))
  with check (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request())
    and exists (select 1 from public.articles a where a.id = article_id)
    and (list_id is null or exists (select 1 from public.reading_lists l where l.id = list_id and l.user_id = (select auth.uid()))));

-- One statement rewrites the order of the caller's own bookmarks in a list (null = unsorted).
-- Rows not named keep their place; an id that is not the caller's, or not in that list, is ignored.
-- Invoker rights: RLS still applies to every row it touches.
create or replace function public.reorder_bookmarks(p_list uuid, p_ids uuid[])
returns integer language plpgsql set search_path = ''
as $$
declare
  v_n integer;
begin
  if coalesce(cardinality(p_ids), 0) > 1000 then
    perform private.fail('VALIDATION_FAILED', 'Too many pages to reorder at once.');
  end if;
  update public.bookmarks b set position = o.ord::integer
    from unnest(p_ids) with ordinality as o(id, ord)
   where b.id = o.id and b.user_id = (select auth.uid()) and b.list_id is not distinct from p_list;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.reorder_bookmarks(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_bookmarks(uuid, uuid[]) to authenticated;

-------------------------------------------------------------------------------
-- 3. Private scratchpad (strictly owner-only: no DM policy)
-------------------------------------------------------------------------------
create table if not exists public.scratchpad_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  article_id uuid references public.articles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scratchpad_user on public.scratchpad_notes (user_id);
create index if not exists scratchpad_article on public.scratchpad_notes (article_id);
create unique index if not exists scratchpad_unique on public.scratchpad_notes (user_id, article_id) nulls not distinct;

-- Text only changes through save_scratchpad (it sets the flag after checking the version), so a
-- plain PATCH cannot overwrite a newer note from another device.
create or replace function private.guard_versioned_text()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if to_jsonb(new) - 'version' - 'updated_at' is distinct from to_jsonb(old) - 'version' - 'updated_at'
       and coalesce(current_setting('chronicle.versioned_save', true), '') <> 'on' then
      perform private.fail('CONFLICT', 'Save this through the page so the newest version is kept.');
    end if;
    new.version := old.version + 1;
    new.created_at := old.created_at;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.guard_versioned_text() from public, anon;
grant execute on function private.guard_versioned_text() to authenticated, service_role;

drop trigger if exists scratchpad_1_owner on public.scratchpad_notes;
create trigger scratchpad_1_owner before insert or update on public.scratchpad_notes
  for each row execute function private.guard_owner_row();
drop trigger if exists scratchpad_2_cap on public.scratchpad_notes;
create trigger scratchpad_2_cap before insert on public.scratchpad_notes
  for each row execute function private.guard_owner_cap('scratchpad notes', '2000');
drop trigger if exists scratchpad_3_versioned on public.scratchpad_notes;
create trigger scratchpad_3_versioned before insert or update on public.scratchpad_notes
  for each row execute function private.guard_versioned_text();

alter table public.scratchpad_notes enable row level security;
revoke all on public.scratchpad_notes from anon, authenticated;
grant select, insert, delete on public.scratchpad_notes to authenticated;
grant update (body) on public.scratchpad_notes to authenticated;
grant all on public.scratchpad_notes to service_role;
drop policy if exists scratchpad_select on public.scratchpad_notes;
create policy scratchpad_select on public.scratchpad_notes for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request()));
drop policy if exists scratchpad_delete on public.scratchpad_notes;
create policy scratchpad_delete on public.scratchpad_notes for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request()));
drop policy if exists scratchpad_insert on public.scratchpad_notes;
create policy scratchpad_insert on public.scratchpad_notes for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request())
    and (article_id is null or exists (select 1 from public.articles a where a.id = article_id)));
drop policy if exists scratchpad_update on public.scratchpad_notes;
create policy scratchpad_update on public.scratchpad_notes for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request()))
  with check (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request())
    and (article_id is null or exists (select 1 from public.articles a where a.id = article_id)));

-- Save with optimistic locking. p_expected_version is the version the caller loaded, or null when
-- it loaded no note. A stored version that differs (or a note that appeared or vanished) is a
-- CONFLICT; nothing is overwritten. Returns the saved row, with its new version.
create or replace function public.save_scratchpad(p_article uuid, p_body text, p_expected_version integer)
returns public.scratchpad_notes language plpgsql set search_path = ''
as $$
declare
  v_row public.scratchpad_notes;
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'A signed-in user is required' using errcode = '42501';
  end if;
  if char_length(coalesce(p_body, '')) not between 1 and 5000 then
    perform private.fail('VALIDATION_FAILED', 'A note must be between 1 and 5,000 characters.');
  end if;
  if p_expected_version is null then
    insert into public.scratchpad_notes (user_id, article_id, body) values (v_user, p_article, p_body)
      on conflict (user_id, article_id) do nothing
      returning * into v_row;
  else
    perform set_config('chronicle.versioned_save', 'on', true);
    update public.scratchpad_notes n set body = p_body
     where n.user_id = v_user and n.article_id is not distinct from p_article and n.version = p_expected_version
     returning * into v_row;
    perform set_config('chronicle.versioned_save', '', true);
  end if;
  if v_row.id is null then
    perform private.fail('CONFLICT', 'This note was changed on another device. Copy your text, reload, and try again.');
  end if;
  return v_row;
end;
$$;
revoke all on function public.save_scratchpad(uuid, text, integer) from public, anon;
grant execute on function public.save_scratchpad(uuid, text, integer) to authenticated;

-------------------------------------------------------------------------------
-- 4. Character journals
-------------------------------------------------------------------------------
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  body text not null default '' check (char_length(body) <= 20000),
  entry_date date not null default current_date,
  tags text[] not null default '{}' check (cardinality(tags) <= 5 and tags <@ array['theory', 'goal', 'suspicion', 'question', 'note']::text[]),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists journal_entries_user on public.journal_entries (user_id, entry_date desc);

drop trigger if exists journal_entries_1_owner on public.journal_entries;
create trigger journal_entries_1_owner before insert or update on public.journal_entries
  for each row execute function private.guard_owner_row();
drop trigger if exists journal_entries_2_cap on public.journal_entries;
create trigger journal_entries_2_cap before insert on public.journal_entries
  for each row execute function private.guard_owner_cap('journal entries', '2000');
drop trigger if exists journal_entries_3_versioned on public.journal_entries;
create trigger journal_entries_3_versioned before insert or update on public.journal_entries
  for each row execute function private.guard_versioned_text();

alter table public.journal_entries enable row level security;
revoke all on public.journal_entries from anon, authenticated;
grant select, insert, delete on public.journal_entries to authenticated;
grant update (title, body, entry_date, tags) on public.journal_entries to authenticated;
grant all on public.journal_entries to service_role;
drop policy if exists journal_entries_select on public.journal_entries;
create policy journal_entries_select on public.journal_entries for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request()));
-- The DM reads every entry. Read only: there is no DM policy to insert, change or delete.
drop policy if exists journal_entries_dm_read on public.journal_entries;
create policy journal_entries_dm_read on public.journal_entries for select to authenticated
  using ((select private.is_dm()) and not (select private.is_oauth_request()));
drop policy if exists journal_entries_insert on public.journal_entries;
create policy journal_entries_insert on public.journal_entries for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request()));
drop policy if exists journal_entries_update on public.journal_entries;
create policy journal_entries_update on public.journal_entries for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request()))
  with check (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request()));
drop policy if exists journal_entries_delete on public.journal_entries;
create policy journal_entries_delete on public.journal_entries for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request()));

create table if not exists public.journal_entry_links (
  entry_id uuid not null references public.journal_entries (id) on delete cascade,
  article_id uuid not null references public.articles (id) on delete cascade,
  primary key (entry_id, article_id)
);
create index if not exists journal_entry_links_article on public.journal_entry_links (article_id);

create or replace function private.guard_journal_link()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select e.user_id into v_owner from public.journal_entries e where e.id = new.entry_id;
  if v_owner is null then return new; end if; -- the foreign key reports a missing entry
  perform pg_advisory_xact_lock(hashtextextended('journal_links' || new.entry_id::text, 0));
  if (select count(*) from public.journal_entry_links l where l.entry_id = new.entry_id) >= 50 then
    perform private.fail('VALIDATION_FAILED', 'An entry can link to at most 50 pages.');
  end if;
  return new;
end;
$$;
revoke all on function private.guard_journal_link() from public, anon;
grant execute on function private.guard_journal_link() to authenticated, service_role;
drop trigger if exists journal_entry_links_cap on public.journal_entry_links;
create trigger journal_entry_links_cap before insert on public.journal_entry_links
  for each row execute function private.guard_journal_link();

alter table public.journal_entry_links enable row level security;
revoke all on public.journal_entry_links from anon, authenticated;
grant select, insert, delete on public.journal_entry_links to authenticated;
grant all on public.journal_entry_links to service_role;
drop policy if exists journal_links_select on public.journal_entry_links;
create policy journal_links_select on public.journal_entry_links for select to authenticated
  using ((select private.is_member()) and not (select private.is_oauth_request())
    and exists (select 1 from public.journal_entries e where e.id = entry_id and e.user_id = (select auth.uid())));
drop policy if exists journal_links_dm_read on public.journal_entry_links;
create policy journal_links_dm_read on public.journal_entry_links for select to authenticated
  using ((select private.is_dm()) and not (select private.is_oauth_request()));
drop policy if exists journal_links_insert on public.journal_entry_links;
create policy journal_links_insert on public.journal_entry_links for insert to authenticated
  with check ((select private.is_member()) and not (select private.is_oauth_request())
    and exists (select 1 from public.journal_entries e where e.id = entry_id and e.user_id = (select auth.uid()))
    and exists (select 1 from public.articles a where a.id = article_id));
drop policy if exists journal_links_delete on public.journal_entry_links;
create policy journal_links_delete on public.journal_entry_links for delete to authenticated
  using ((select private.is_member()) and not (select private.is_oauth_request())
    and exists (select 1 from public.journal_entries e where e.id = entry_id and e.user_id = (select auth.uid())));

-- Create (p_id null) or change an entry and replace its links, in one transaction, with
-- optimistic locking: p_expected_version must equal the stored version or the save is refused with
-- CONFLICT. Links to pages the caller cannot read are refused by the link policy; invoker rights.
create or replace function public.save_journal_entry(
  p_id uuid, p_title text, p_body text, p_date date, p_tags text[], p_articles uuid[], p_expected_version integer)
returns public.journal_entries language plpgsql set search_path = ''
as $$
declare
  v_row public.journal_entries;
  v_user uuid := (select auth.uid());
  v_articles uuid[] := coalesce(p_articles, '{}');
begin
  if v_user is null then
    raise exception 'A signed-in user is required' using errcode = '42501';
  end if;
  if cardinality(v_articles) > 50 then
    perform private.fail('VALIDATION_FAILED', 'An entry can link to at most 50 pages.');
  end if;
  if p_id is null then
    insert into public.journal_entries (user_id, title, body, entry_date, tags)
      values (v_user, p_title, coalesce(p_body, ''), coalesce(p_date, current_date), coalesce(p_tags, '{}'))
      returning * into v_row;
  else
    perform set_config('chronicle.versioned_save', 'on', true);
    update public.journal_entries e
       set title = p_title, body = coalesce(p_body, ''), entry_date = coalesce(p_date, e.entry_date), tags = coalesce(p_tags, '{}')
     where e.id = p_id and e.user_id = v_user and e.version = p_expected_version
     returning * into v_row;
    perform set_config('chronicle.versioned_save', '', true);
    if v_row.id is null then
      perform private.fail('CONFLICT', 'This entry was changed on another device. Copy your text, reload, and try again.');
    end if;
  end if;
  delete from public.journal_entry_links l where l.entry_id = v_row.id and not (l.article_id = any (v_articles));
  insert into public.journal_entry_links (entry_id, article_id)
    select v_row.id, x from unnest(v_articles) as t(x)
    on conflict (entry_id, article_id) do nothing;
  return v_row;
end;
$$;
revoke all on function public.save_journal_entry(uuid, text, text, date, text[], uuid[], integer) from public, anon;
grant execute on function public.save_journal_entry(uuid, text, text, date, text[], uuid[], integer) to authenticated;

notify pgrst, 'reload schema';
