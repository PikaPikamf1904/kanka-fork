-- Chronicle cloud: core schema, roles and Row Level Security.
--
-- Privacy model (see docs/security/access-control.md):
--   * Nothing is readable by the `anon` role. The wiki is private.
--   * A signed-in user sees nothing until they are an active row in campaign_members.
--   * Players (role 'player') see only rows that are BOTH visibility = 'players' AND, where the
--     table has a status, status = 'published', and whose parent article/map is also visible.
--   * The DM (role 'dm') sees and edits everything.
--   * Player-visible and DM-only material live in separate rows (sections, infobox fields,
--     markers, relations ...), never in one JSON blob, so RLS filters secrets out at the row level.
--   * New content defaults to visibility 'dm' and status 'draft': private until published.
--   * Roles come only from campaign_members, which users cannot write. JWT user_metadata is never
--     used for authorization.

-- Supabase installs pgcrypto in the `extensions` schema; this is a no-op there.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Helpers live in a schema that the Data API does not expose.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-------------------------------------------------------------------------------
-- Types
-------------------------------------------------------------------------------
create type public.content_visibility as enum ('players', 'dm');
create type public.publish_status as enum ('draft', 'published');
create type public.member_role as enum ('player', 'dm');
create type public.article_type as enum (
  'lore', 'character', 'location', 'faction', 'item', 'quest', 'session', 'event', 'dossier'
);

-------------------------------------------------------------------------------
-- Membership and access codes
-------------------------------------------------------------------------------
create table public.access_codes (
  id uuid primary key default gen_random_uuid(),
  label text not null default 'Player access code',
  code_hash text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz,
  revoked_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  use_count integer not null default 0
);

create table public.campaign_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.member_role not null default 'player',
  display_name text not null default 'Adventurer' check (char_length(display_name) between 1 and 60),
  enrolled_via uuid references public.access_codes (id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

-- Failed and successful code attempts, for rate limiting. Never readable through the API.
create table public.enrollment_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);
create index enrollment_attempts_ip_time on public.enrollment_attempts (ip_hash, attempted_at);
create index enrollment_attempts_time on public.enrollment_attempts (attempted_at);

-------------------------------------------------------------------------------
-- Authorization helpers. SECURITY DEFINER so they can read campaign_members without recursion;
-- each one only answers a question about the *calling* user. search_path is pinned.
-------------------------------------------------------------------------------
create function private.is_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.campaign_members m
    where m.user_id = (select auth.uid()) and m.revoked_at is null
  );
$$;

-- The DM must be an active 'dm' member. If the DM has enrolled a verified MFA factor, the
-- session must also be aal2, so a stolen password alone does not unlock DM content.
create function private.is_dm()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.campaign_members m
    where m.user_id = (select auth.uid()) and m.revoked_at is null and m.role = 'dm'
  )
  and (
    coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified'
    )
  );
$$;

-- The single definition of "a player may see this". Policies and the DM's preview both use it.
create function private.player_visible(v public.content_visibility, s public.publish_status default 'published')
returns boolean
language sql immutable
as $$ select v = 'players' and s = 'published' $$;

-------------------------------------------------------------------------------
-- Campaign settings (the cover page)
-------------------------------------------------------------------------------
create table public.campaign_settings (
  id boolean primary key default true check (id),
  title text not null default 'Chronicle',
  tagline text not null default '',
  overview text not null default '',
  banner_media_id uuid,
  updated_at timestamptz not null default now()
);
insert into public.campaign_settings (id) values (true);

-------------------------------------------------------------------------------
-- Media (files live in the private storage bucket 'chronicle-media')
-------------------------------------------------------------------------------
create table public.media (
  id uuid primary key default gen_random_uuid(),
  path text not null unique check (path ~ '^[a-z0-9][a-z0-9/_.-]*$' and path !~ '\.\.'),
  alt text not null default '',
  width integer,
  height integer,
  bytes integer,
  content_type text,
  visibility public.content_visibility not null default 'dm',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
alter table public.campaign_settings
  add constraint campaign_settings_banner_fk foreign key (banner_media_id) references public.media (id) on delete set null;

-------------------------------------------------------------------------------
-- Articles and their parts
-------------------------------------------------------------------------------
create table public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  type public.article_type not null default 'lore',
  title text not null check (char_length(title) between 1 and 200),
  subtitle text not null default '',
  summary text not null default '',
  hero_media_id uuid references public.media (id) on delete set null,
  visibility public.content_visibility not null default 'dm',
  status public.publish_status not null default 'draft',
  is_featured boolean not null default false,
  is_party_member boolean not null default false,
  importance smallint not null default 0,
  session_date date,
  -- Kanka import bookkeeping: lets the importer be re-run without duplicates.
  source_ref text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(subtitle, '')), 'B')
    || setweight(to_tsvector('english', coalesce(summary, '')), 'B')
  ) stored
);
create index articles_search on public.articles using gin (search_tsv);
create index articles_type on public.articles (type, status, visibility);
create index articles_updated on public.articles (updated_at desc);

create table public.article_sections (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles (id) on delete cascade,
  position integer not null default 0,
  heading text not null default '',
  body text not null default '',
  visibility public.content_visibility not null default 'dm',
  status public.publish_status not null default 'draft',
  updated_at timestamptz not null default now(),
  search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(heading, '')), 'B')
    || setweight(to_tsvector('english', coalesce(body, '')), 'C')
  ) stored
);
create index article_sections_article on public.article_sections (article_id, position);
create index article_sections_search on public.article_sections using gin (search_tsv);

create table public.infobox_fields (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles (id) on delete cascade,
  position integer not null default 0,
  label text not null check (char_length(label) between 1 and 80),
  value text not null default '',
  visibility public.content_visibility not null default 'dm'
);
create index infobox_fields_article on public.infobox_fields (article_id, position);

-- DM-only notes. There is no player policy on this table at all.
create table public.dm_notes (
  id uuid primary key default gen_random_uuid(),
  article_id uuid references public.articles (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dm_notes_article on public.dm_notes (article_id);

-- Categories and tags share one table; a category name can itself be a spoiler.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  kind text not null default 'category' check (kind in ('category', 'tag')),
  description text not null default '',
  visibility public.content_visibility not null default 'dm'
);

create table public.article_categories (
  article_id uuid not null references public.articles (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (article_id, category_id)
);
create index article_categories_category on public.article_categories (category_id);

-- Wiki links found in section bodies ([[slug]] or [[slug|label]]), maintained by a trigger.
-- A link is only as visible as the section it was written in.
create table public.article_links (
  source_section_id uuid not null references public.article_sections (id) on delete cascade,
  target_slug text not null,
  primary key (source_section_id, target_slug)
);
create index article_links_target on public.article_links (target_slug);

create table public.redirects (
  from_slug text primary key check (from_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  article_id uuid not null references public.articles (id) on delete cascade,
  visibility public.content_visibility not null default 'dm'
);

create table public.relations (
  id uuid primary key default gen_random_uuid(),
  source_article_id uuid not null references public.articles (id) on delete cascade,
  target_article_id uuid not null references public.articles (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),
  label text not null default '',
  visibility public.content_visibility not null default 'dm',
  check (source_article_id <> target_article_id)
);
create index relations_source on public.relations (source_article_id);
create index relations_target on public.relations (target_article_id);

create table public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  date_label text not null default '',
  sort_key numeric not null default 0,
  body text not null default '',
  article_id uuid references public.articles (id) on delete set null,
  visibility public.content_visibility not null default 'dm',
  status public.publish_status not null default 'draft'
);
create index timeline_events_sort on public.timeline_events (sort_key);

create table public.maps (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  description text not null default '',
  media_id uuid references public.media (id) on delete set null,
  width integer not null default 2000 check (width > 0),
  height integer not null default 1500 check (height > 0),
  parent_map_id uuid references public.maps (id) on delete set null,
  article_id uuid references public.articles (id) on delete set null,
  visibility public.content_visibility not null default 'dm',
  status public.publish_status not null default 'draft'
);

create table public.map_markers (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.maps (id) on delete cascade,
  x double precision not null,
  y double precision not null,
  label text not null,
  description text not null default '',
  icon text not null default 'pin' check (icon ~ '^[a-z-]{1,30}$'),
  article_id uuid references public.articles (id) on delete set null,
  visibility public.content_visibility not null default 'dm'
);
create index map_markers_map on public.map_markers (map_id);

-- Article snapshots for history and restore. DM only.
create table public.revisions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles (id) on delete cascade,
  snapshot jsonb not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index revisions_article on public.revisions (article_id, created_at desc);

-------------------------------------------------------------------------------
-- Visibility helpers that look at other rows (SECURITY DEFINER, read-only, caller-scoped)
-------------------------------------------------------------------------------
create function private.can_read_article(p_article uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_dm() or (
    private.is_member() and exists (
      select 1 from public.articles a
      where a.id = p_article and private.player_visible(a.visibility, a.status)
    )
  );
$$;

create function private.can_read_section(p_section uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_dm() or (
    private.is_member() and exists (
      select 1 from public.article_sections s
      join public.articles a on a.id = s.article_id
      where s.id = p_section
        and private.player_visible(s.visibility, s.status)
        and private.player_visible(a.visibility, a.status)
    )
  );
$$;

create function private.can_read_category(p_category uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_dm() or (
    private.is_member() and exists (
      select 1 from public.categories c where c.id = p_category and c.visibility = 'players'
    )
  );
$$;

create function private.can_read_map(p_map uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_dm() or (
    private.is_member() and exists (
      select 1 from public.maps m where m.id = p_map and private.player_visible(m.visibility, m.status)
    )
  );
$$;

create function private.can_read_media_path(p_path text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_dm() or (
    private.is_member() and exists (
      select 1 from public.media m where m.path = p_path and m.visibility = 'players'
    )
  );
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;

-------------------------------------------------------------------------------
-- Triggers: timestamps and wiki-link extraction
-------------------------------------------------------------------------------
create function private.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger articles_touch before update on public.articles
  for each row execute function private.touch_updated_at();
create trigger sections_touch before update on public.article_sections
  for each row execute function private.touch_updated_at();
create trigger dm_notes_touch before update on public.dm_notes
  for each row execute function private.touch_updated_at();
create trigger settings_touch before update on public.campaign_settings
  for each row execute function private.touch_updated_at();

create function private.set_published_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at := now();
  end if;
  return new;
end;
$$;
create trigger articles_published_at before insert or update on public.articles
  for each row execute function private.set_published_at();

-- Same rules as slugify() in src/lib/slug.ts (tested to agree).
create function private.slugify(p text)
returns text language sql immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'))
$$;

create function private.sync_article_links()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.article_links where source_section_id = new.id;
  insert into public.article_links (source_section_id, target_slug)
  select distinct new.id, private.slugify(m[1])
  from regexp_matches(new.body, '\[\[([^\]|]+)(?:\|[^\]]*)?\]\]', 'g') as m
  where private.slugify(m[1]) <> '';
  return new;
end;
$$;
create trigger sections_links after insert or update of body on public.article_sections
  for each row execute function private.sync_article_links();

-------------------------------------------------------------------------------
-- Row Level Security: enabled on every table in public.
-------------------------------------------------------------------------------
alter table public.access_codes enable row level security;
alter table public.campaign_members enable row level security;
alter table public.enrollment_attempts enable row level security;
alter table public.campaign_settings enable row level security;
alter table public.media enable row level security;
alter table public.articles enable row level security;
alter table public.article_sections enable row level security;
alter table public.infobox_fields enable row level security;
alter table public.dm_notes enable row level security;
alter table public.categories enable row level security;
alter table public.article_categories enable row level security;
alter table public.article_links enable row level security;
alter table public.redirects enable row level security;
alter table public.relations enable row level security;
alter table public.timeline_events enable row level security;
alter table public.maps enable row level security;
alter table public.map_markers enable row level security;
alter table public.revisions enable row level security;

-- Table privileges. Hosted Supabase grants everything in public to anon and authenticated by
-- default; take that back and grant only what each role needs.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, public;
-- The server's secret key (service_role) bypasses RLS; grant it table access explicitly rather
-- than relying on project defaults. It is used only by server code (enrollment, importer).
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant select, insert, update, delete on
  public.campaign_settings, public.media, public.articles, public.article_sections,
  public.infobox_fields, public.dm_notes, public.categories, public.article_categories,
  public.redirects, public.relations, public.timeline_events, public.maps, public.map_markers,
  public.revisions
  to authenticated;
grant select on public.article_links to authenticated;
-- Members: read; the DM may rename or revoke. Role and identity columns are not updatable.
grant select on public.campaign_members to authenticated;
grant update (display_name, revoked_at) on public.campaign_members to authenticated;
-- Access codes: the hash is never selectable.
grant select (id, label, created_at, expires_at, revoked_at, max_uses, use_count)
  on public.access_codes to authenticated;
-- enrollment_attempts: no grants to anon/authenticated.

-- Settings
create policy settings_read on public.campaign_settings for select to authenticated
  using (private.is_member());
create policy settings_dm on public.campaign_settings for update to authenticated
  using (private.is_dm()) with check (private.is_dm());

-- Members
create policy members_read on public.campaign_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_dm());
create policy members_dm_update on public.campaign_members for update to authenticated
  using (private.is_dm()) with check (private.is_dm());

-- Access codes
create policy codes_dm_read on public.access_codes for select to authenticated
  using (private.is_dm());

-- Media
create policy media_read on public.media for select to authenticated
  using (private.is_dm() or (private.is_member() and visibility = 'players'));
create policy media_dm on public.media for all to authenticated
  using (private.is_dm()) with check (private.is_dm());

-- Articles
create policy articles_read on public.articles for select to authenticated
  using (private.is_dm() or (private.is_member() and private.player_visible(visibility, status)));
create policy articles_dm on public.articles for all to authenticated
  using (private.is_dm()) with check (private.is_dm());

-- Sections
create policy sections_read on public.article_sections for select to authenticated
  using (
    private.is_dm()
    or (private.is_member() and private.player_visible(visibility, status) and private.can_read_article(article_id))
  );
create policy sections_dm on public.article_sections for all to authenticated
  using (private.is_dm()) with check (private.is_dm());

-- Infobox fields
create policy infobox_read on public.infobox_fields for select to authenticated
  using (
    private.is_dm()
    or (private.is_member() and visibility = 'players' and private.can_read_article(article_id))
  );
create policy infobox_dm on public.infobox_fields for all to authenticated
  using (private.is_dm()) with check (private.is_dm());

-- DM notes: DM only, no player policy.
create policy dm_notes_dm on public.dm_notes for all to authenticated
  using (private.is_dm()) with check (private.is_dm());

-- Categories
create policy categories_read on public.categories for select to authenticated
  using (private.is_dm() or (private.is_member() and visibility = 'players'));
create policy categories_dm on public.categories for all to authenticated
  using (private.is_dm()) with check (private.is_dm());

create policy article_categories_read on public.article_categories for select to authenticated
  using (
    private.is_dm()
    or (private.is_member() and private.can_read_article(article_id) and private.can_read_category(category_id))
  );
create policy article_categories_dm on public.article_categories for all to authenticated
  using (private.is_dm()) with check (private.is_dm());

-- Links (written only by the trigger)
create policy article_links_read on public.article_links for select to authenticated
  using (private.can_read_section(source_section_id));

-- Redirects
create policy redirects_read on public.redirects for select to authenticated
  using (
    private.is_dm()
    or (private.is_member() and visibility = 'players' and private.can_read_article(article_id))
  );
create policy redirects_dm on public.redirects for all to authenticated
  using (private.is_dm()) with check (private.is_dm());

-- Relations: hidden unless the relation AND both ends are visible, so neither existence nor
-- counts leak.
create policy relations_read on public.relations for select to authenticated
  using (
    private.is_dm()
    or (
      private.is_member() and visibility = 'players'
      and private.can_read_article(source_article_id) and private.can_read_article(target_article_id)
    )
  );
create policy relations_dm on public.relations for all to authenticated
  using (private.is_dm()) with check (private.is_dm());

-- Timeline
create policy timeline_read on public.timeline_events for select to authenticated
  using (
    private.is_dm()
    or (
      private.is_member() and private.player_visible(visibility, status)
      and (article_id is null or private.can_read_article(article_id))
    )
  );
create policy timeline_dm on public.timeline_events for all to authenticated
  using (private.is_dm()) with check (private.is_dm());

-- Maps and markers. A marker linked to an article the player cannot read is hidden entirely.
create policy maps_read on public.maps for select to authenticated
  using (private.is_dm() or (private.is_member() and private.player_visible(visibility, status)));
create policy maps_dm on public.maps for all to authenticated
  using (private.is_dm()) with check (private.is_dm());

create policy markers_read on public.map_markers for select to authenticated
  using (
    private.is_dm()
    or (
      private.is_member() and visibility = 'players' and private.can_read_map(map_id)
      and (article_id is null or private.can_read_article(article_id))
    )
  );
create policy markers_dm on public.map_markers for all to authenticated
  using (private.is_dm()) with check (private.is_dm());

-- Revisions: DM only.
create policy revisions_dm on public.revisions for all to authenticated
  using (private.is_dm()) with check (private.is_dm());
