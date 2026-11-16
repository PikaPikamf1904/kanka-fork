-- Chronicle cloud: atomic, versioned, idempotent change sets (the editing engine).
--
-- One path for every structured edit, used by the website and (later) the MCP server:
--
--   preview_change_set(change_set)      validates against the database, computes a per-field diff,
--                                       stores a private preview for 20 minutes, returns its id and
--                                       a server-computed digest. Writes no content.
--   approve_change_preview(preview_id)  a human approval. Refused for calls made with an OAuth
--                                       client token (claim client_id / chronicle_client), so an
--                                       MCP client can never approve its own preview.
--   apply_change_set(preview_id, digest, idempotency_key)
--                                       re-checks the preview (owner, client, expiry, digest,
--                                       approval), locks every touched article and compares its
--                                       version, snapshots it, applies every operation and records
--                                       the result, in ONE transaction. Any failure rolls back all
--                                       of it. The same key with the same digest returns the stored
--                                       result; with a different digest it is refused.
--
-- Guarantees: new rows are DM-only drafts whatever the client sends; nothing is published;
-- an existing row's visibility can only be narrowed; an OAuth-client caller cannot change text
-- that players can already read. All content writes run as the calling user (SECURITY INVOKER),
-- so the existing Row Level Security still decides what is allowed. Bookkeeping tables (previews,
-- change sets) are written only through narrow SECURITY DEFINER helpers in the private schema,
-- which check auth.uid() themselves; callers have no write grants on them.
--
-- Rollback (run in the SQL Editor; drops only what this file adds, content is untouched):
--   drop function if exists public.apply_change_set(uuid, text, text);
--   drop function if exists public.approve_change_preview(uuid);
--   drop function if exists public.preview_change_set(jsonb);
--   drop function if exists private.run_change_set(jsonb, boolean, uuid, text);
--   drop function if exists private.cs_restore(uuid, jsonb, boolean, uuid);
--   drop function if exists private.cs_claim_preview(uuid, text);
--   drop function if exists private.cs_store_preview(jsonb, text, jsonb, jsonb, text);
--   drop function if exists private.cs_begin(text, text, uuid, text);
--   drop function if exists private.cs_finish(uuid, jsonb);
--   drop function if exists private.require_dm();
--   drop function if exists private.fail(text, text, jsonb);
--   drop function if exists private.request_client();
--   drop trigger if exists sections_bump_article on public.article_sections;
--   drop trigger if exists infobox_bump_article on public.infobox_fields;
--   drop trigger if exists categories_bump_article on public.article_categories;
--   drop trigger if exists relations_bump_article on public.relations;
--   drop trigger if exists articles_version on public.articles;
--   drop function if exists private.bump_parent_article();
--   drop function if exists private.bump_article_version();
--   drop table if exists public.change_sets, public.change_previews, public.provenance;
--   drop type if exists public.provenance_kind;
--   alter table public.revisions drop column if exists change_set_id;
--   alter table public.articles drop column if exists version;

-------------------------------------------------------------------------------
-- 1. Versions: every change to an article or its parts bumps articles.version
-------------------------------------------------------------------------------
alter table public.articles add column if not exists version bigint not null default 1;

create or replace function private.bump_article_version()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;
drop trigger if exists articles_version on public.articles;
create trigger articles_version before update on public.articles
  for each row execute function private.bump_article_version();

-- tg_argv[0] names the column that points at the article.
create or replace function private.bump_parent_article()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  if tg_op <> 'INSERT' then v_old := (to_jsonb(old) ->> tg_argv[0])::uuid; end if;
  if tg_op <> 'DELETE' then v_new := (to_jsonb(new) ->> tg_argv[0])::uuid; end if;
  update public.articles set version = version where id = v_old or id = v_new;
  return null;
end;
$$;
drop trigger if exists sections_bump_article on public.article_sections;
create trigger sections_bump_article after insert or update or delete on public.article_sections
  for each row execute function private.bump_parent_article('article_id');
drop trigger if exists infobox_bump_article on public.infobox_fields;
create trigger infobox_bump_article after insert or update or delete on public.infobox_fields
  for each row execute function private.bump_parent_article('article_id');
drop trigger if exists categories_bump_article on public.article_categories;
create trigger categories_bump_article after insert or delete on public.article_categories
  for each row execute function private.bump_parent_article('article_id');
drop trigger if exists relations_bump_article on public.relations;
create trigger relations_bump_article after insert or update or delete on public.relations
  for each row execute function private.bump_parent_article('source_article_id');

-------------------------------------------------------------------------------
-- 2. Tables
-------------------------------------------------------------------------------
do $$ begin
  create type public.provenance_kind as enum
    ('table_confirmed', 'dm_confirmed', 'official_reference', 'planned_unplayed', 'transcript_uncertain');
exception when duplicate_object then null; end $$;

-- Where a fact came from. DM only, never shown to players. section_id / field_id are plain ids
-- (no foreign key) so a restore that re-creates a section with its old id keeps its provenance.
create table if not exists public.provenance (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles (id) on delete cascade,
  section_id uuid,
  field_id uuid,
  kind public.provenance_kind not null,
  reference text not null default '' check (char_length(reference) <= 500),
  change_set_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index if not exists provenance_article on public.provenance (article_id);
create index if not exists provenance_created_by on public.provenance (created_by);

create table if not exists public.change_previews (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  label text not null default '',
  change_set jsonb not null,
  base_versions jsonb not null,
  digest text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  consumed_at timestamptz
);
create index if not exists change_previews_principal on public.change_previews (principal_id, created_at desc);

create table if not exists public.change_sets (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  digest text not null,
  preview_id uuid,
  label text not null default '',
  result jsonb,
  created_at timestamptz not null default now(),
  unique (principal_id, client_id, idempotency_key)
);

alter table public.revisions add column if not exists change_set_id uuid;

alter table public.provenance enable row level security;
alter table public.change_previews enable row level security;
alter table public.change_sets enable row level security;

revoke all on public.provenance, public.change_previews, public.change_sets from anon, authenticated;
grant select, insert, update, delete on public.provenance to authenticated;
grant select on public.change_previews, public.change_sets to authenticated;
grant all on public.provenance, public.change_previews, public.change_sets to service_role;

drop policy if exists provenance_dm on public.provenance;
create policy provenance_dm on public.provenance for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));
drop policy if exists change_previews_own on public.change_previews;
create policy change_previews_own on public.change_previews for select to authenticated
  using (principal_id = (select auth.uid()) and (select private.is_dm()));
drop policy if exists change_sets_own on public.change_sets;
create policy change_sets_own on public.change_sets for select to authenticated
  using (principal_id = (select auth.uid()) and (select private.is_dm()));

-------------------------------------------------------------------------------
-- 3. Helpers
-------------------------------------------------------------------------------
-- Which client made this request: an OAuth client id from the token, or 'web' for the website.
create or replace function private.request_client()
returns text language sql stable set search_path = ''
as $$
  select coalesce(
    nullif(auth.jwt() ->> 'client_id', ''),
    nullif(auth.jwt() ->> 'chronicle_client', ''),
    'web'
  );
$$;

-- Raise a stable error code. PostgREST turns SQLSTATE PTxxx into HTTP status xxx; the message is
-- the code and the detail is JSON with a human-readable message.
create or replace function private.fail(p_code text, p_message text, p_detail jsonb default '{}')
returns void language plpgsql set search_path = ''
as $$
begin
  raise exception using
    message = p_code,
    detail = (coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('message', p_message))::text,
    errcode = case p_code
      when 'VALIDATION_FAILED' then 'PT422'
      when 'CONFLICT' then 'PT409'
      when 'ALREADY_EXISTS' then 'PT409'
      when 'IDEMPOTENCY_MISMATCH' then 'PT409'
      when 'NOT_FOUND' then 'PT404'
      when 'FORBIDDEN' then 'PT403'
      when 'MFA_REQUIRED' then 'PT403'
      when 'PREVIEW_EXPIRED' then 'PT410'
      else 'PT500' end;
end;
$$;

create or replace function private.require_dm()
returns void language plpgsql set search_path = ''
as $$
begin
  if private.is_dm() then return; end if;
  if exists (select 1 from public.campaign_members m
             where m.user_id = (select auth.uid()) and m.role = 'dm' and m.revoked_at is null) then
    perform private.fail('MFA_REQUIRED', 'Complete two-step sign-in first.');
  end if;
  perform private.fail('FORBIDDEN', 'Only the DM can do this.');
end;
$$;

-------------------------------------------------------------------------------
-- 4. Bookkeeping (SECURITY DEFINER, narrow, check the caller themselves)
-------------------------------------------------------------------------------
create or replace function private.cs_store_preview(p_change_set jsonb, p_digest text, p_base jsonb, p_result jsonb, p_label text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.change_previews;
begin
  perform private.require_dm();
  delete from public.change_previews where expires_at < now() - interval '1 day';
  insert into public.change_previews (principal_id, client_id, label, change_set, base_versions, digest, result, expires_at)
  values ((select auth.uid()), private.request_client(), left(coalesce(p_label, ''), 200), p_change_set, p_base, p_digest, p_result,
          now() + interval '20 minutes')
  returning * into v_row;
  return jsonb_build_object('preview_id', v_row.id, 'expires_at', v_row.expires_at);
end;
$$;

create or replace function private.cs_claim_preview(p_preview_id uuid, p_digest text)
returns public.change_previews language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.change_previews;
begin
  perform private.require_dm();
  select * into v_row from public.change_previews where id = p_preview_id for update;
  if not found or v_row.principal_id <> (select auth.uid()) then
    perform private.fail('NOT_FOUND', 'No such preview.');
  end if;
  if v_row.client_id <> private.request_client() then
    perform private.fail('FORBIDDEN', 'This preview belongs to a different client.');
  end if;
  if v_row.expires_at <= now() then
    perform private.fail('PREVIEW_EXPIRED', 'The preview has expired. Preview the changes again.');
  end if;
  if v_row.digest <> coalesce(p_digest, '') then
    perform private.fail('VALIDATION_FAILED', 'The digest does not match the preview.');
  end if;
  if v_row.consumed_at is not null then
    perform private.fail('CONFLICT', 'This preview has already been applied.');
  end if;
  -- The website is the human: a confirm click there is the approval. Any other client needs an
  -- approval recorded from the website first.
  if v_row.client_id <> 'web' and v_row.approved_at is null then
    perform private.fail('FORBIDDEN', 'These changes have not been approved in Chronicle yet.',
      jsonb_build_object('review_required', true, 'preview_id', v_row.id));
  end if;
  update public.change_previews set consumed_at = now() where id = v_row.id;
  return v_row;
end;
$$;

-- Returns the stored result when the key was already used with the same digest; null when the
-- key is new (and is now reserved for this transaction). Two concurrent calls with one key: the
-- second waits on the unique index until the first commits, then sees its result.
create or replace function private.cs_begin(p_key text, p_digest text, p_preview_id uuid, p_label text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_row public.change_sets;
begin
  perform private.require_dm();
  if p_key is null or char_length(p_key) not between 8 and 100 then
    perform private.fail('VALIDATION_FAILED', 'idempotency_key must be 8 to 100 characters.');
  end if;
  insert into public.change_sets (principal_id, client_id, idempotency_key, digest, preview_id, label)
  values ((select auth.uid()), private.request_client(), p_key, p_digest, p_preview_id, left(coalesce(p_label, ''), 200))
  on conflict (principal_id, client_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('change_set_id', v_id, 'new', true);
  end if;
  select * into v_row from public.change_sets
  where principal_id = (select auth.uid()) and client_id = private.request_client() and idempotency_key = p_key;
  if v_row.digest <> p_digest then
    perform private.fail('IDEMPOTENCY_MISMATCH', 'This idempotency key was already used for different changes.');
  end if;
  return jsonb_build_object('change_set_id', v_row.id, 'new', false, 'result', v_row.result);
end;
$$;

create or replace function private.cs_finish(p_id uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.change_sets set result = p_result where id = p_id and principal_id = (select auth.uid());
end;
$$;

-------------------------------------------------------------------------------
-- 5. Guarded restore (never widens visibility, always a draft)
-------------------------------------------------------------------------------
create or replace function private.cs_restore(p_article uuid, p_snapshot jsonb, p_apply boolean, p_change_set_id uuid)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_cur public.articles;
  v_a jsonb := p_snapshot -> 'article';
  v_s jsonb;
  v_f jsonb;
  v_existing public.article_sections;
  v_existing_f public.infobox_fields;
  v_keep uuid[] := '{}';
  v_keep_f uuid[] := '{}';
  v_diff jsonb := '[]';
begin
  select * into v_cur from public.articles where id = p_article;
  for v_s in select * from jsonb_array_elements(coalesce(p_snapshot -> 'sections', '[]')) loop
    v_keep := v_keep || (v_s ->> 'id')::uuid;
  end loop;
  for v_f in select * from jsonb_array_elements(coalesce(p_snapshot -> 'infobox', '[]')) loop
    v_keep_f := v_keep_f || (v_f ->> 'id')::uuid;
  end loop;
  v_diff := v_diff || jsonb_build_object('target', v_cur.slug, 'field', 'title', 'before', v_cur.title, 'after', v_a ->> 'title', 'operation', 'restore')
                   || jsonb_build_object('target', v_cur.slug, 'field', 'summary', 'before', v_cur.summary, 'after', v_a ->> 'summary', 'operation', 'restore')
                   || jsonb_build_object('target', v_cur.slug, 'field', 'sections', 'before',
                        (select count(*) from public.article_sections where article_id = p_article),
                        'after', jsonb_array_length(coalesce(p_snapshot -> 'sections', '[]')), 'operation', 'restore');
  if not p_apply then
    return v_diff;
  end if;

  update public.articles set
    title = v_a ->> 'title', subtitle = coalesce(v_a ->> 'subtitle', ''), summary = coalesce(v_a ->> 'summary', ''),
    is_party_member = coalesce((v_a ->> 'is_party_member')::boolean, false),
    importance = coalesce((v_a ->> 'importance')::smallint, 0),
    session_date = nullif(v_a ->> 'session_date', '')::date,
    hero_media_id = (select m.id from public.media m where m.id = nullif(v_a ->> 'hero_media_id', '')::uuid),
    status = 'draft',
    visibility = case when v_cur.visibility = 'dm' or v_a ->> 'visibility' = 'dm' then 'dm'::public.content_visibility else 'players'::public.content_visibility end
  where id = p_article;

  delete from public.article_sections where article_id = p_article and not (id = any (v_keep));
  for v_s in select * from jsonb_array_elements(coalesce(p_snapshot -> 'sections', '[]')) loop
    select * into v_existing from public.article_sections where id = (v_s ->> 'id')::uuid and article_id = p_article;
    if found then
      update public.article_sections set
        position = (v_s ->> 'position')::integer, heading = v_s ->> 'heading', body = v_s ->> 'body',
        visibility = case when v_existing.visibility = 'dm' or v_s ->> 'visibility' = 'dm' then 'dm'::public.content_visibility else 'players'::public.content_visibility end,
        status = case when v_existing.status = 'draft' or v_s ->> 'status' = 'draft' then 'draft'::public.publish_status else 'published'::public.publish_status end
      where id = v_existing.id;
    else
      insert into public.article_sections (id, article_id, position, heading, body, visibility, status)
      values ((v_s ->> 'id')::uuid, p_article, (v_s ->> 'position')::integer, v_s ->> 'heading', v_s ->> 'body', 'dm', 'draft');
    end if;
  end loop;

  delete from public.infobox_fields where article_id = p_article and not (id = any (v_keep_f));
  for v_f in select * from jsonb_array_elements(coalesce(p_snapshot -> 'infobox', '[]')) loop
    select * into v_existing_f from public.infobox_fields where id = (v_f ->> 'id')::uuid and article_id = p_article;
    if found then
      update public.infobox_fields set
        position = (v_f ->> 'position')::integer, label = v_f ->> 'label', value = v_f ->> 'value',
        visibility = case when v_existing_f.visibility = 'dm' or v_f ->> 'visibility' = 'dm' then 'dm'::public.content_visibility else 'players'::public.content_visibility end
      where id = v_existing_f.id;
    else
      insert into public.infobox_fields (id, article_id, position, label, value, visibility)
      values ((v_f ->> 'id')::uuid, p_article, (v_f ->> 'position')::integer, v_f ->> 'label', v_f ->> 'value', 'dm');
    end if;
  end loop;
  return v_diff;
end;
$$;

-------------------------------------------------------------------------------
-- 6. The engine: validate (and, when p_apply, write) one change set
-------------------------------------------------------------------------------
create or replace function private.run_change_set(p_cs jsonb, p_apply boolean, p_change_set_id uuid, p_note text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  c_ops constant text[] := array['create_article', 'patch_article', 'upsert_section', 'remove_section',
    'upsert_infobox_field', 'remove_infobox_field', 'add_relation', 'remove_relation',
    'add_category_link', 'remove_category_link', 'add_dm_note', 'restore_revision'];
  c_patchable constant text[] := array['title', 'subtitle', 'summary', 'is_party_member', 'importance', 'session_date', 'hero_media_id'];
  v_changes jsonb := p_cs -> 'changes';
  v_expected jsonb := coalesce(p_cs -> 'expected_versions', '{}');
  v_default_prov text := p_cs ->> 'source_kind';
  v_mcp boolean := private.request_client() <> 'web';
  v_op jsonb;
  v_kind text;
  v_i integer := 0;
  v_slug text;
  v_tgt jsonb;
  v_tgt2 jsonb;
  v_ids jsonb := '{}';          -- slug -> article id, for articles created or touched in this set
  v_versions jsonb := '{}';     -- slug -> version at first touch (existing articles only)
  v_new_slugs text[] := '{}';   -- created in this set
  v_skip_slugs text[] := '{}';  -- create skipped because it already exists
  v_exp text;
  v_art public.articles;
  v_sec public.article_sections;
  v_fld public.infobox_fields;
  v_rel public.relations;
  v_cat public.categories;
  v_rev public.revisions;
  v_key text;
  v_val jsonb;
  v_id uuid;
  v_prov text;
  v_vis text;
  v_status text;
  v_link text;
  v_snapshotted uuid[] := '{}';
  v_diffs jsonb := '[]';
  v_warn jsonb := '[]';
  v_conf jsonb := '[]';
  v_created text[] := '{}';
  v_updated text[] := '{}';
  v_skipped text[] := '{}';
  v_bodies text := '';
  v_new_versions jsonb := '{}';
  v_revisions jsonb := '[]';
begin
  if jsonb_typeof(p_cs) <> 'object' or jsonb_typeof(v_changes) <> 'array' then
    perform private.fail('VALIDATION_FAILED', 'change_set.changes must be a list.');
  end if;
  if jsonb_array_length(v_changes) not between 1 and 5000 then
    perform private.fail('VALIDATION_FAILED', 'A change set needs 1 to 5000 changes.');
  end if;
  if octet_length(p_cs::text) > 1048576 then
    perform private.fail('VALIDATION_FAILED', 'A change set may be at most 1 MB.');
  end if;
  if v_default_prov is not null and v_default_prov not in ('table_confirmed', 'dm_confirmed', 'official_reference', 'planned_unplayed', 'transcript_uncertain') then
    perform private.fail('VALIDATION_FAILED', 'Unknown source_kind.', jsonb_build_object('source_kind', v_default_prov));
  end if;
  if jsonb_typeof(v_expected) <> 'object' then
    perform private.fail('VALIDATION_FAILED', 'expected_versions must be an object of slug to version.');
  end if;

  for v_op in select value from jsonb_array_elements(v_changes) loop
    v_i := v_i + 1;
    if jsonb_typeof(v_op) <> 'object' then
      perform private.fail('VALIDATION_FAILED', format('Change %s is not an object.', v_i));
    end if;
    v_kind := v_op ->> 'operation';
    if v_kind is null or not (v_kind = any (c_ops)) then
      perform private.fail('VALIDATION_FAILED', format('Change %s: unknown operation.', v_i), jsonb_build_object('index', v_i));
    end if;
    if v_op ? 'visibility' and v_op ->> 'visibility' <> 'dm' or v_op ? 'status' and v_op ->> 'status' <> 'draft' then
      v_warn := v_warn || jsonb_build_object('code', 'VISIBILITY_IGNORED', 'index', v_i,
        'message', 'Requested player visibility or published status is ignored; changes are saved as DM-only drafts.');
    end if;
    v_prov := coalesce(v_op #>> '{provenance,kind}', v_default_prov);
    if v_prov is not null and v_prov not in ('table_confirmed', 'dm_confirmed', 'official_reference', 'planned_unplayed', 'transcript_uncertain') then
      perform private.fail('VALIDATION_FAILED', format('Change %s: unknown provenance kind.', v_i));
    end if;

    -------------------------------------------------------------- resolve the target article
    v_slug := coalesce(v_op ->> 'slug', v_op ->> 'article_slug', v_op ->> 'source_slug');
    v_tgt := null;
    if v_kind <> 'create_article' and v_kind <> 'remove_relation' then
      if v_slug is null then
        perform private.fail('VALIDATION_FAILED', format('Change %s: which article? (slug)', v_i));
      end if;
      if v_slug = any (v_skip_slugs) then
        v_skipped := v_skipped || v_slug;
        v_warn := v_warn || jsonb_build_object('code', 'SKIPPED_WITH_ARTICLE', 'index', v_i, 'message', format('Skipped because "%s" already exists.', v_slug));
        continue;
      end if;
      if not (v_slug = any (v_new_slugs)) then
        select * into v_art from public.articles where slug = v_slug;
        if not found then
          perform private.fail('VALIDATION_FAILED', format('Change %s: no article "%s".', v_i, v_slug), jsonb_build_object('index', v_i, 'slug', v_slug));
        end if;
        if not (v_versions ? v_slug) then
          v_exp := coalesce(v_op ->> 'expected_version', v_expected ->> v_slug);
          if v_exp is null then
            perform private.fail('VALIDATION_FAILED', format('Change %s: expected_version is required to change "%s".', v_i, v_slug), jsonb_build_object('slug', v_slug));
          end if;
          if p_apply then
            select * into v_art from public.articles where id = v_art.id for update;
          end if;
          if v_exp <> 'v' || v_art.version then
            if p_apply then
              perform private.fail('CONFLICT', format('"%s" changed since it was read.', v_slug),
                jsonb_build_object('slug', v_slug, 'expected', v_exp, 'current', 'v' || v_art.version));
            end if;
            v_conf := v_conf || jsonb_build_object('slug', v_slug, 'expected', v_exp, 'current', 'v' || v_art.version);
          end if;
          v_versions := v_versions || jsonb_build_object(v_slug, v_art.version);
          v_ids := v_ids || jsonb_build_object(v_slug, v_art.id);
          if not (v_slug = any (v_updated)) then v_updated := v_updated || v_slug; end if;
          if p_apply and not (v_art.id = any (v_snapshotted)) then
            v_id := public.snapshot_article(v_art.id, left(coalesce(p_note, 'Change set'), 200));
            update public.revisions set change_set_id = p_change_set_id where id = v_id;
            v_revisions := v_revisions || jsonb_build_object('slug', v_slug, 'revision_id', v_id);
            v_snapshotted := v_snapshotted || v_art.id;
          end if;
        end if;
      end if;
      v_id := nullif(v_ids ->> v_slug, '')::uuid;
    end if;

    -------------------------------------------------------------- operations
    if v_kind = 'create_article' then
      v_slug := v_op ->> 'slug';
      if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 160 then
        perform private.fail('VALIDATION_FAILED', format('Change %s: invalid slug.', v_i), jsonb_build_object('slug', v_slug));
      end if;
      if char_length(coalesce(trim(v_op ->> 'title'), '')) not between 1 and 200 then
        perform private.fail('VALIDATION_FAILED', format('Change %s: title must be 1 to 200 characters.', v_i));
      end if;
      if coalesce(v_op ->> 'type', '') not in ('lore', 'character', 'location', 'faction', 'item', 'quest', 'session', 'event', 'dossier') then
        perform private.fail('VALIDATION_FAILED', format('Change %s: unknown article type.', v_i));
      end if;
      if char_length(coalesce(v_op ->> 'summary', '')) > 2000 or char_length(coalesce(v_op ->> 'subtitle', '')) > 200 then
        perform private.fail('VALIDATION_FAILED', format('Change %s: summary or subtitle too long.', v_i));
      end if;
      if v_slug = any (v_new_slugs) then
        perform private.fail('VALIDATION_FAILED', format('Change %s: "%s" is created twice.', v_i, v_slug));
      end if;
      if exists (select 1 from public.articles where slug = v_slug)
         or (v_op ->> 'source_ref' is not null and exists (select 1 from public.articles where source_ref = v_op ->> 'source_ref')) then
        if coalesce(v_op ->> 'on_exists', 'conflict') = 'skip' then
          v_skip_slugs := v_skip_slugs || v_slug;
          v_skipped := v_skipped || v_slug;
          continue;
        end if;
        if p_apply then
          perform private.fail('ALREADY_EXISTS', format('"%s" already exists.', v_slug), jsonb_build_object('slug', v_slug));
        end if;
        v_conf := v_conf || jsonb_build_object('slug', v_slug, 'code', 'ALREADY_EXISTS');
        continue;
      end if;
      v_new_slugs := v_new_slugs || v_slug;
      v_created := v_created || v_slug;
      v_diffs := v_diffs || jsonb_build_object('target', v_slug, 'field', 'article', 'before', null, 'after', v_op ->> 'title', 'operation', 'create');
      if p_apply then
        insert into public.articles (slug, title, type, subtitle, summary, is_party_member, visibility, status, source_ref)
        values (v_slug, trim(v_op ->> 'title'), (v_op ->> 'type')::public.article_type, coalesce(v_op ->> 'subtitle', ''),
                coalesce(v_op ->> 'summary', ''), coalesce((v_op ->> 'is_party_member')::boolean, false), 'dm', 'draft', v_op ->> 'source_ref')
        returning id into v_id;
        v_ids := v_ids || jsonb_build_object(v_slug, v_id);
      else
        v_ids := v_ids || jsonb_build_object(v_slug, '');
      end if;

    elsif v_kind = 'patch_article' then
      if jsonb_typeof(v_op -> 'fields') <> 'object' or (select count(*) from jsonb_object_keys(v_op -> 'fields')) = 0 then
        perform private.fail('VALIDATION_FAILED', format('Change %s: fields must name at least one field.', v_i));
      end if;
      for v_key, v_val in select key, value from jsonb_each(v_op -> 'fields') loop
        if not (v_key = any (c_patchable)) then
          perform private.fail('VALIDATION_FAILED', format('Change %s: "%s" cannot be changed here.', v_i, v_key),
            jsonb_build_object('field', v_key));
        end if;
      end loop;
      if v_op #>> '{fields,title}' is not null and char_length(trim(v_op #>> '{fields,title}')) not between 1 and 200
         or char_length(coalesce(v_op #>> '{fields,summary}', '')) > 2000 or char_length(coalesce(v_op #>> '{fields,subtitle}', '')) > 200 then
        perform private.fail('VALIDATION_FAILED', format('Change %s: a field is empty or too long.', v_i));
      end if;
      if v_slug = any (v_new_slugs) then
        if p_apply then select * into v_art from public.articles where id = v_id; end if;
      else
        select * into v_art from public.articles where id = v_id;
        if v_mcp and v_art.visibility = 'players' and v_art.status = 'published' then
          perform private.fail('VALIDATION_FAILED', format('Change %s: "%s" is published to players; edit it on the website.', v_i, v_slug));
        end if;
      end if;
      for v_key, v_val in select key, value from jsonb_each(v_op -> 'fields') loop
        v_diffs := v_diffs || jsonb_build_object('target', v_slug, 'field', v_key,
          'before', case when v_slug = any (v_new_slugs) then null else to_jsonb(v_art) -> v_key end, 'after', v_val, 'operation', 'patch');
      end loop;
      if p_apply then
        update public.articles set
          title = case when v_op -> 'fields' ? 'title' then trim(v_op #>> '{fields,title}') else title end,
          subtitle = case when v_op -> 'fields' ? 'subtitle' then coalesce(v_op #>> '{fields,subtitle}', '') else subtitle end,
          summary = case when v_op -> 'fields' ? 'summary' then coalesce(v_op #>> '{fields,summary}', '') else summary end,
          is_party_member = case when v_op -> 'fields' ? 'is_party_member' then coalesce((v_op #>> '{fields,is_party_member}')::boolean, false) else is_party_member end,
          importance = case when v_op -> 'fields' ? 'importance' then coalesce((v_op #>> '{fields,importance}')::smallint, 0) else importance end,
          session_date = case when v_op -> 'fields' ? 'session_date' then nullif(v_op #>> '{fields,session_date}', '')::date else session_date end,
          hero_media_id = case when v_op -> 'fields' ? 'hero_media_id' then nullif(v_op #>> '{fields,hero_media_id}', '')::uuid else hero_media_id end
        where id = v_id;
      end if;

    elsif v_kind = 'upsert_section' then
      if char_length(coalesce(v_op ->> 'heading', '')) > 200 or char_length(coalesce(v_op ->> 'body', '')) not between 1 and 100000 then
        perform private.fail('VALIDATION_FAILED', format('Change %s: heading too long, or body empty or too long.', v_i));
      end if;
      v_bodies := v_bodies || ' ' || (v_op ->> 'body');
      if v_prov is null then
        v_warn := v_warn || jsonb_build_object('code', 'UNVERIFIED_FACT', 'index', v_i, 'message', format('Section "%s" has no source.', coalesce(v_op ->> 'heading', '')));
      end if;
      if v_op ->> 'section_id' is not null then
        select * into v_sec from public.article_sections where id = (v_op ->> 'section_id')::uuid and article_id = v_id;
        if not found then
          perform private.fail('VALIDATION_FAILED', format('Change %s: that section is not part of "%s".', v_i, v_slug));
        end if;
        if v_mcp and v_sec.visibility = 'players' and v_sec.status = 'published' and exists (select 1 from public.articles x where x.id = v_id and x.visibility = 'players' and x.status = 'published') then
          perform private.fail('VALIDATION_FAILED', format('Change %s: that section is visible to players; edit it on the website.', v_i));
        end if;
        if v_sec.heading is distinct from coalesce(v_op ->> 'heading', v_sec.heading) then
          v_diffs := v_diffs || jsonb_build_object('target', v_slug, 'section_id', v_sec.id, 'field', 'heading', 'before', v_sec.heading, 'after', v_op ->> 'heading', 'operation', 'patch');
        end if;
        if v_sec.body is distinct from (v_op ->> 'body') then
          v_diffs := v_diffs || jsonb_build_object('target', v_slug, 'section_id', v_sec.id, 'field', 'body', 'before', v_sec.body, 'after', v_op ->> 'body', 'operation', 'patch');
        end if;
        if p_apply then
          update public.article_sections set
            heading = coalesce(v_op ->> 'heading', heading), body = v_op ->> 'body',
            position = coalesce((v_op ->> 'position')::integer, position),
            visibility = case when v_op ->> 'visibility' = 'dm' then 'dm'::public.content_visibility else visibility end,
            status = case when v_op ->> 'status' = 'draft' then 'draft'::public.publish_status else status end
          where id = v_sec.id;
          v_sec.id := v_sec.id;
        end if;
      else
        v_diffs := v_diffs || jsonb_build_object('target', v_slug, 'field', 'section', 'before', null,
          'after', jsonb_build_object('heading', coalesce(v_op ->> 'heading', ''), 'body', v_op ->> 'body'), 'operation', 'create');
        if p_apply then
          insert into public.article_sections (article_id, position, heading, body, visibility, status)
          values (v_id, coalesce((v_op ->> 'position')::integer,
                    (select coalesce(max(position), 0) + 1 from public.article_sections where article_id = v_id)),
                  coalesce(v_op ->> 'heading', ''), v_op ->> 'body', 'dm', 'draft')
          returning * into v_sec;
        end if;
      end if;
      if p_apply and v_prov is not null then
        insert into public.provenance (article_id, section_id, kind, reference, change_set_id, created_by)
        values (v_id, v_sec.id, v_prov::public.provenance_kind, left(coalesce(v_op #>> '{provenance,reference}', ''), 500), p_change_set_id, (select auth.uid()));
      end if;

    elsif v_kind = 'remove_section' then
      select * into v_sec from public.article_sections where id = nullif(v_op ->> 'section_id', '')::uuid and article_id = v_id;
      if not found then
        perform private.fail('VALIDATION_FAILED', format('Change %s: that section is not part of "%s".', v_i, v_slug));
      end if;
      v_diffs := v_diffs || jsonb_build_object('target', v_slug, 'section_id', v_sec.id, 'field', 'section',
        'before', jsonb_build_object('heading', v_sec.heading, 'body', v_sec.body), 'after', null, 'operation', 'remove');
      if p_apply then delete from public.article_sections where id = v_sec.id; end if;

    elsif v_kind = 'upsert_infobox_field' then
      if char_length(coalesce(trim(v_op ->> 'label'), '')) not between 1 and 80 or char_length(coalesce(v_op ->> 'value', '')) > 2000 then
        perform private.fail('VALIDATION_FAILED', format('Change %s: label must be 1 to 80 characters, value at most 2000.', v_i));
      end if;
      if v_prov is null then
        v_warn := v_warn || jsonb_build_object('code', 'UNVERIFIED_FACT', 'index', v_i, 'message', format('Field "%s" has no source.', v_op ->> 'label'));
      end if;
      if v_op ->> 'field_id' is not null then
        select * into v_fld from public.infobox_fields where id = (v_op ->> 'field_id')::uuid and article_id = v_id;
        if not found then
          perform private.fail('VALIDATION_FAILED', format('Change %s: that field is not part of "%s".', v_i, v_slug));
        end if;
        if v_mcp and v_fld.visibility = 'players' and exists (select 1 from public.articles x where x.id = v_id and x.visibility = 'players' and x.status = 'published') then
          perform private.fail('VALIDATION_FAILED', format('Change %s: that field is visible to players; edit it on the website.', v_i));
        end if;
        v_diffs := v_diffs || jsonb_build_object('target', v_slug, 'field_id', v_fld.id, 'field', v_fld.label,
          'before', v_fld.value, 'after', coalesce(v_op ->> 'value', ''), 'operation', 'patch');
        if p_apply then
          update public.infobox_fields set label = trim(v_op ->> 'label'), value = coalesce(v_op ->> 'value', ''),
            position = coalesce((v_op ->> 'position')::integer, position),
            visibility = case when v_op ->> 'visibility' = 'dm' then 'dm'::public.content_visibility else visibility end
          where id = v_fld.id;
        end if;
      else
        v_diffs := v_diffs || jsonb_build_object('target', v_slug, 'field', trim(v_op ->> 'label'), 'before', null,
          'after', coalesce(v_op ->> 'value', ''), 'operation', 'create');
        if p_apply then
          insert into public.infobox_fields (article_id, position, label, value, visibility)
          values (v_id, coalesce((v_op ->> 'position')::integer,
                    (select coalesce(max(position), 0) + 1 from public.infobox_fields where article_id = v_id)),
                  trim(v_op ->> 'label'), coalesce(v_op ->> 'value', ''), 'dm')
          returning * into v_fld;
        end if;
      end if;
      if p_apply and v_prov is not null then
        insert into public.provenance (article_id, field_id, kind, reference, change_set_id, created_by)
        values (v_id, v_fld.id, v_prov::public.provenance_kind, left(coalesce(v_op #>> '{provenance,reference}', ''), 500), p_change_set_id, (select auth.uid()));
      end if;

    elsif v_kind = 'remove_infobox_field' then
      select * into v_fld from public.infobox_fields where id = nullif(v_op ->> 'field_id', '')::uuid and article_id = v_id;
      if not found then
        perform private.fail('VALIDATION_FAILED', format('Change %s: that field is not part of "%s".', v_i, v_slug));
      end if;
      v_diffs := v_diffs || jsonb_build_object('target', v_slug, 'field_id', v_fld.id, 'field', v_fld.label, 'before', v_fld.value, 'after', null, 'operation', 'remove');
      if p_apply then delete from public.infobox_fields where id = v_fld.id; end if;

    elsif v_kind = 'add_relation' then
      if coalesce(v_op ->> 'kind', '') !~ '^[a-z_]{2,40}$' or char_length(coalesce(v_op ->> 'label', '')) > 120 then
        perform private.fail('VALIDATION_FAILED', format('Change %s: relation kind must be 2 to 40 lower-case letters or underscores.', v_i));
      end if;
      if (v_op ->> 'target_slug') = v_slug then
        perform private.fail('VALIDATION_FAILED', format('Change %s: an article cannot be related to itself.', v_i));
      end if;
      if (v_op ->> 'target_slug') = any (v_skip_slugs) then
        v_skipped := v_skipped || (v_op ->> 'target_slug');
        continue;
      end if;
      if (v_op ->> 'target_slug') = any (v_new_slugs) then
        v_tgt2 := jsonb_build_object('id', v_ids ->> (v_op ->> 'target_slug'));
      else
        select jsonb_build_object('id', id) into v_tgt2 from public.articles where slug = v_op ->> 'target_slug';
        if v_tgt2 is null then
          perform private.fail('VALIDATION_FAILED', format('Change %s: no article "%s".', v_i, v_op ->> 'target_slug'));
        end if;
      end if;
      if v_id is not null and nullif(v_tgt2 ->> 'id', '') is not null and exists (select 1 from public.relations
          where source_article_id = v_id and target_article_id = (v_tgt2 ->> 'id')::uuid and kind = v_op ->> 'kind') then
        v_warn := v_warn || jsonb_build_object('code', 'DUPLICATE_RELATION', 'index', v_i, 'message', 'This connection already exists; skipped.');
        continue;
      end if;
      v_diffs := v_diffs || jsonb_build_object('target', v_slug, 'field', 'relation', 'before', null,
        'after', jsonb_build_object('kind', v_op ->> 'kind', 'target_slug', v_op ->> 'target_slug', 'label', coalesce(v_op ->> 'label', '')), 'operation', 'create');
      if p_apply then
        insert into public.relations (source_article_id, target_article_id, kind, label, visibility)
        values (v_id, (v_tgt2 ->> 'id')::uuid, v_op ->> 'kind', coalesce(v_op ->> 'label', ''), 'dm');
      end if;

    elsif v_kind = 'remove_relation' then
      select * into v_rel from public.relations where id = nullif(v_op ->> 'relation_id', '')::uuid;
      if not found then
        perform private.fail('VALIDATION_FAILED', format('Change %s: no such connection.', v_i));
      end if;
      select * into v_art from public.articles where id = v_rel.source_article_id;
      v_slug := v_art.slug;
      if not (v_versions ? v_slug) then
        v_exp := coalesce(v_op ->> 'expected_version', v_expected ->> v_slug);
        if v_exp is null then
          perform private.fail('VALIDATION_FAILED', format('Change %s: expected_version is required to change "%s".', v_i, v_slug));
        end if;
        if p_apply then select * into v_art from public.articles where id = v_art.id for update; end if;
        if v_exp <> 'v' || v_art.version then
          if p_apply then
            perform private.fail('CONFLICT', format('"%s" changed since it was read.', v_slug), jsonb_build_object('slug', v_slug, 'current', 'v' || v_art.version));
          end if;
          v_conf := v_conf || jsonb_build_object('slug', v_slug, 'expected', v_exp, 'current', 'v' || v_art.version);
        end if;
        v_versions := v_versions || jsonb_build_object(v_slug, v_art.version);
        v_ids := v_ids || jsonb_build_object(v_slug, v_art.id);
        if not (v_slug = any (v_updated)) then v_updated := v_updated || v_slug; end if;
        if p_apply and not (v_art.id = any (v_snapshotted)) then
          v_id := public.snapshot_article(v_art.id, left(coalesce(p_note, 'Change set'), 200));
          update public.revisions set change_set_id = p_change_set_id where id = v_id;
          v_revisions := v_revisions || jsonb_build_object('slug', v_slug, 'revision_id', v_id);
          v_snapshotted := v_snapshotted || v_art.id;
        end if;
      end if;
      v_diffs := v_diffs || jsonb_build_object('target', v_slug, 'field', 'relation', 'before',
        jsonb_build_object('kind', v_rel.kind, 'label', v_rel.label), 'after', null, 'operation', 'remove');
      if p_apply then delete from public.relations where id = v_rel.id; end if;

    elsif v_kind in ('add_category_link', 'remove_category_link') then
      select * into v_cat from public.categories where slug = v_op ->> 'category_slug';
      if not found then
        perform private.fail('VALIDATION_FAILED', format('Change %s: no category "%s".', v_i, v_op ->> 'category_slug'));
      end if;
      v_diffs := v_diffs || jsonb_build_object('target', v_slug, 'field', 'category',
        'before', case when v_kind = 'remove_category_link' then v_cat.slug end,
        'after', case when v_kind = 'add_category_link' then v_cat.slug end,
        'operation', case when v_kind = 'add_category_link' then 'create' else 'remove' end);
      if p_apply then
        if v_kind = 'add_category_link' then
          insert into public.article_categories (article_id, category_id) values (v_id, v_cat.id) on conflict do nothing;
        else
          delete from public.article_categories where article_id = v_id and category_id = v_cat.id;
        end if;
      end if;

    elsif v_kind = 'add_dm_note' then
      if char_length(coalesce(v_op ->> 'title', '')) > 200 or char_length(coalesce(v_op ->> 'body', '')) not between 1 and 100000 then
        perform private.fail('VALIDATION_FAILED', format('Change %s: note title too long, or body empty or too long.', v_i));
      end if;
      v_diffs := v_diffs || jsonb_build_object('target', v_slug, 'field', 'dm_note', 'before', null,
        'after', jsonb_build_object('title', coalesce(v_op ->> 'title', ''), 'body', v_op ->> 'body'), 'operation', 'create');
      if p_apply then
        insert into public.dm_notes (article_id, title, body) values (v_id, coalesce(v_op ->> 'title', ''), v_op ->> 'body');
      end if;

    elsif v_kind = 'restore_revision' then
      if v_slug = any (v_new_slugs) then
        perform private.fail('VALIDATION_FAILED', format('Change %s: cannot restore an article created in the same change set.', v_i));
      end if;
      select * into v_rev from public.revisions where id = nullif(v_op ->> 'revision_id', '')::uuid and article_id = v_id;
      if not found then
        perform private.fail('VALIDATION_FAILED', format('Change %s: that revision does not belong to "%s".', v_i, v_slug));
      end if;
      v_diffs := v_diffs || private.cs_restore(v_id, v_rev.snapshot, p_apply, p_change_set_id);
    end if;
  end loop;

  -------------------------------------------------------------- links that point nowhere
  for v_link in
    select distinct private.slugify(m[1]) from regexp_matches(v_bodies, '\[\[([^\]|]+)(?:\|[^\]]*)?\]\]', 'g') as m
  loop
    if v_link <> '' and not (v_link = any (v_new_slugs))
       and not exists (select 1 from public.articles where slug = v_link)
       and not exists (select 1 from public.redirects where from_slug = v_link) then
      v_warn := v_warn || jsonb_build_object('code', 'BROKEN_LINK', 'target_slug', v_link, 'message', format('No page "%s" exists yet.', v_link));
    end if;
  end loop;

  -------------------------------------------------------------- limits after the change (apply)
  if p_apply then
    for v_slug, v_val in select key, value from jsonb_each(v_ids) loop
      v_id := (v_val #>> '{}')::uuid;
      if (select count(*) from public.article_sections where article_id = v_id) > 30
         or (select count(*) from public.infobox_fields where article_id = v_id) > 50
         or (select coalesce(sum(octet_length(body)), 0) from public.article_sections where article_id = v_id) > 102400 then
        perform private.fail('VALIDATION_FAILED', format('"%s" would exceed 30 sections, 50 fields or 100 KB of text.', v_slug));
      end if;
      select * into v_art from public.articles where id = v_id;
      v_new_versions := v_new_versions || jsonb_build_object(v_slug, 'v' || v_art.version);
    end loop;
    if (select count(distinct key) from jsonb_each(v_ids)) > 100 then
      perform private.fail('VALIDATION_FAILED', 'A change set may touch at most 100 articles.');
    end if;
  elsif (select count(*) from jsonb_object_keys(v_ids)) > 100 then
    perform private.fail('VALIDATION_FAILED', 'A change set may touch at most 100 articles.');
  end if;

  return jsonb_build_object(
    'diffs', v_diffs, 'warnings', v_warn, 'conflicts', v_conf,
    'created', to_jsonb(v_created), 'updated', to_jsonb(v_updated), 'skipped', to_jsonb(v_skipped),
    'base_versions', v_versions, 'new_versions', v_new_versions, 'revision_ids', v_revisions,
    'article_ids', v_ids);
end;
$$;

-------------------------------------------------------------------------------
-- 7. Public RPCs
-------------------------------------------------------------------------------
create or replace function public.preview_change_set(p_change_set jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_result jsonb;
  v_digest text;
  v_stored jsonb;
begin
  perform private.require_dm();
  v_result := private.run_change_set(p_change_set, false, null, null);
  if jsonb_array_length(v_result -> 'conflicts') > 0 then
    -- No preview id: the caller must read the current versions and preview again.
    return jsonb_build_object('preview_id', null, 'digest', null, 'expires_at', null,
      'review_required', true, 'change_set_id', null) || (v_result - 'base_versions' - 'new_versions' - 'revision_ids' - 'article_ids');
  end if;
  v_digest := 'sha256:' || encode(extensions.digest(convert_to(
    jsonb_build_object('change_set', p_change_set, 'base_versions', v_result -> 'base_versions')::text, 'UTF8'), 'sha256'), 'hex');
  v_stored := private.cs_store_preview(p_change_set, v_digest, v_result -> 'base_versions',
    v_result - 'new_versions' - 'revision_ids' - 'article_ids', p_change_set ->> 'label');
  return jsonb_build_object('preview_id', v_stored -> 'preview_id', 'digest', v_digest, 'expires_at', v_stored -> 'expires_at',
    'review_required', true, 'change_set_id', null)
    || (v_result - 'base_versions' - 'new_versions' - 'revision_ids' - 'article_ids');
end;
$$;

create or replace function public.approve_change_preview(p_preview_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.change_previews;
begin
  perform private.require_dm();
  if private.request_client() <> 'web' then
    perform private.fail('FORBIDDEN', 'Changes can only be approved in Chronicle itself.');
  end if;
  select * into v_row from public.change_previews where id = p_preview_id for update;
  if not found or v_row.principal_id <> (select auth.uid()) then
    perform private.fail('NOT_FOUND', 'No such preview.');
  end if;
  if v_row.expires_at <= now() then
    perform private.fail('PREVIEW_EXPIRED', 'The preview has expired.');
  end if;
  if v_row.consumed_at is not null then
    perform private.fail('CONFLICT', 'This preview has already been applied.');
  end if;
  update public.change_previews set approved_at = coalesce(approved_at, now()) where id = v_row.id;
  return jsonb_build_object('preview_id', v_row.id, 'approved', true);
end;
$$;

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
  v_result := private.run_change_set(v_preview.change_set, true, (v_begin ->> 'change_set_id')::uuid,
    coalesce(nullif(v_preview.label, ''), 'Change set'));
  v_out := jsonb_build_object(
    'schema_version', '1', 'change_set_id', v_begin ->> 'change_set_id', 'preview_id', v_preview.id,
    'created', v_result -> 'created', 'updated', v_result -> 'updated', 'skipped', v_result -> 'skipped',
    'new_versions', v_result -> 'new_versions', 'revision_ids', v_result -> 'revision_ids',
    'warnings', v_result -> 'warnings', 'replayed', false);
  perform private.cs_finish((v_begin ->> 'change_set_id')::uuid, v_out);
  return v_out;
end;
$$;

-------------------------------------------------------------------------------
-- 8. Privileges
-------------------------------------------------------------------------------
revoke all on function
  private.bump_article_version(), private.bump_parent_article(), private.request_client(),
  private.fail(text, text, jsonb), private.require_dm(),
  private.cs_store_preview(jsonb, text, jsonb, jsonb, text), private.cs_claim_preview(uuid, text),
  private.cs_begin(text, text, uuid, text), private.cs_finish(uuid, jsonb),
  private.cs_restore(uuid, jsonb, boolean, uuid), private.run_change_set(jsonb, boolean, uuid, text)
  from public;
grant execute on function
  private.bump_article_version(), private.bump_parent_article(), private.request_client(),
  private.fail(text, text, jsonb), private.require_dm(),
  private.cs_store_preview(jsonb, text, jsonb, jsonb, text), private.cs_claim_preview(uuid, text),
  private.cs_begin(text, text, uuid, text), private.cs_finish(uuid, jsonb),
  private.cs_restore(uuid, jsonb, boolean, uuid), private.run_change_set(jsonb, boolean, uuid, text)
  to authenticated, service_role;

revoke all on function public.preview_change_set(jsonb), public.approve_change_preview(uuid),
  public.apply_change_set(uuid, text, text) from public, anon, authenticated;
grant execute on function public.preview_change_set(jsonb), public.approve_change_preview(uuid),
  public.apply_change_set(uuid, text, text) to authenticated;
