-- Staged lore imports. Requires 20261114000200. Forward-only; not authorized for production until
-- the owner approves the migration bundle.
--
-- A batch holds the entries read from the DM's files (or prepared by an assistant), the DM's
-- choices, and a record of which parts have been saved. Staging writes nothing to the wiki: pages
-- are only ever created through the editing engine, as DM-only drafts, when the DM saves approved
-- entries on the website. The record of saved parts makes an interrupted import resumable without
-- repeating anything.
--
-- Who can do what:
--   * the website DM: everything;
--   * an assistant (OAuth) connected as the DM: read batches and stage new ones, nothing else
--     (it cannot approve, record progress or delete: those are the DM's, on the website);
--   * players and everyone else: nothing.
--
-- Forward recovery: drop table public.import_batches and function private.guard_import_batches
-- in a new reviewed migration (no wiki content depends on this table).

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 1 and 200),
  source_name text not null default '' check (char_length(source_name) <= 300),
  status text not null default 'staged' check (status in ('staged', 'saving', 'done', 'abandoned')),
  -- The parsed entries ({ items, relations, errors, warnings }), at most 5 MB.
  staged jsonb not null check (jsonb_typeof(staged) = 'object' and octet_length(staged::text) <= 5000000),
  decisions jsonb not null default '{"items": {}, "relations": {}, "types": {}}' check (jsonb_typeof(decisions) = 'object' and octet_length(decisions::text) <= 500000),
  progress jsonb not null default '[]' check (jsonb_typeof(progress) = 'array' and octet_length(progress::text) <= 500000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_via text not null default 'web' check (char_length(created_via) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists import_batches_created on public.import_batches (created_at desc);
create index if not exists import_batches_created_by on public.import_batches (created_by);

alter table public.import_batches enable row level security;
revoke all on public.import_batches from anon, authenticated;
grant select, insert, update, delete on public.import_batches to authenticated;
grant all on public.import_batches to service_role;

drop policy if exists import_batches_dm on public.import_batches;
create policy import_batches_dm on public.import_batches for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

create or replace function private.guard_import_batches()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Whoever stages, a new batch starts with no choices and nothing saved.
    new.decisions := '{"items": {}, "relations": {}, "types": {}}';
    new.progress := '[]';
    new.status := 'staged';
    new.created_by := (select auth.uid());
    new.created_via := private.request_client();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if private.is_oauth_request() then
    raise exception 'Only the DM, on the Chronicle website, can review, save or delete an import'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    -- The entries themselves are fixed once staged; stage a new batch to change them.
    if new.staged is distinct from old.staged or new.id <> old.id or new.created_by is distinct from old.created_by
       or new.created_via <> old.created_via or new.created_at <> old.created_at then
      raise exception 'A staged import cannot be rewritten; stage a new one' using errcode = '42501';
    end if;
    new.updated_at := now();
    return new;
  end if;
  return old;
end;
$$;
revoke all on function private.guard_import_batches() from public, anon;
grant execute on function private.guard_import_batches() to authenticated, service_role;

drop trigger if exists import_batches_guard on public.import_batches;
create trigger import_batches_guard before insert or update or delete on public.import_batches
  for each row execute function private.guard_import_batches();

notify pgrst, 'reload schema';
