-- Chronicle cloud: The Goblin Gazette (in-world newspaper) and the campaign's "where we are now".
--
-- A Gazette story is an ordinary wiki page of the new type 'news', so it inherits the existing
-- privacy rules, history, search, wiki links and the MCP proposal flow. The newspaper details
-- live in public.news_stories, one row per story.
--
-- Editorial workflow (enforced here, not only in the interface):
--   draft  -> in_review -> approved -> published
-- - A 'news' page can only be published (status 'published') while its story is 'approved'. This
--   guard sits on the articles table, so the Gazette desk, the general editor and any future tool
--   are all held to it.
-- - Sending a story back to draft or review un-publishes it in the same transaction.
-- - Editing a printed story does not change what players read: the edit waits in news_pending
--   (DM-only) until the DM approves it; then it replaces the printed version in one transaction.
--   Any other attempt to change a printed story's text, pictures or details is refused.
-- - Only the DM, on the website, can save stories or change their state (website-only, like
--   save_article): an MCP client can propose a story draft through the change-set engine, but
--   cannot submit, approve or publish it.
-- - reliability says what kind of reporting it is: confirmed in-world reporting, rumour, satire
--   or a correction. A rumour printed in the Gazette is not campaign canon.
--
-- Also adds campaign_settings.current_location_id and current_status: the DM's own "where the
-- party is now" for the home page. Players only receive the location if they may read that page.
--
-- Rollback:
--   drop trigger if exists articles_news_printed_guard on public.articles;
--   drop trigger if exists sections_news_printed_guard on public.article_sections;
--   drop trigger if exists news_stories_printed_guard on public.news_stories;
--   drop function if exists private.news_guard_printed(), private.news_printed(uuid);
--   drop function if exists private.news_apply_pending(uuid), private.news_write(jsonb, text, public.articles);
--   drop table if exists public.news_pending;
--   drop function if exists public.news_transition(uuid, text);
--   drop function if exists public.save_news_story(jsonb, text);
--   drop trigger if exists articles_news_publish_guard on public.articles;
--   drop trigger if exists news_stories_unpublish on public.news_stories;
--   drop function if exists private.news_publish_guard();
--   drop function if exists private.news_unpublish_on_retract();
--   drop table if exists public.news_stories;
--   drop type if exists public.news_section, public.news_reliability, public.news_review_state;
--   alter table public.campaign_settings drop column if exists current_location_id, drop column if exists current_status;
--   ('news' cannot be removed from public.article_type without recreating the type; delete or
--    retype the news pages first if that is ever needed.)

alter type public.article_type add value if not exists 'news';

do $$ begin
  create type public.news_section as enum ('breaking', 'war', 'local', 'rumors', 'interviews', 'corrections');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.news_reliability as enum ('confirmed', 'rumor', 'satire', 'correction');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.news_review_state as enum ('draft', 'in_review', 'approved');
exception when duplicate_object then null; end $$;

create table if not exists public.news_stories (
  article_id uuid primary key references public.articles (id) on delete cascade,
  section public.news_section not null default 'local',
  reliability public.news_reliability not null default 'confirmed',
  -- One of the Gazette's staff (see src/lib/gazette.ts); stored as a short key.
  reporter text not null default 'editor' check (reporter ~ '^[a-z0-9-]{1,40}$'),
  dateline text not null default '' check (char_length(dateline) <= 120),
  in_world_date text not null default '' check (char_length(in_world_date) <= 120),
  issue_number integer check (issue_number between 1 and 100000),
  is_lead boolean not null default false,
  corrects_article_id uuid references public.articles (id) on delete set null,
  review_state public.news_review_state not null default 'draft',
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists news_stories_corrects on public.news_stories (corrects_article_id);
create index if not exists news_stories_issue on public.news_stories (issue_number desc);

alter table public.news_stories enable row level security;
revoke all on public.news_stories from anon, authenticated;
grant select on public.news_stories to authenticated;
grant all on public.news_stories to service_role;

-- Readable exactly when its page is readable (the articles policy applies inside the subquery).
drop policy if exists news_read on public.news_stories;
create policy news_read on public.news_stories for select to authenticated
  using ((select private.is_dm()) or exists (select 1 from public.articles a where a.id = news_stories.article_id));

-- Writes go through save_news_story / news_transition only (no direct write grant).

alter table public.campaign_settings
  add column if not exists current_location_id uuid references public.articles (id) on delete set null,
  add column if not exists current_status text not null default '' check (char_length(current_status) <= 600);
create index if not exists campaign_settings_current_location on public.campaign_settings (current_location_id);

-------------------------------------------------------------------------------
-- Guards
-------------------------------------------------------------------------------
create or replace function private.news_publish_guard()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.type::text = 'news' and new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published' or old.type::text is distinct from 'news')
     and not exists (select 1 from public.news_stories s where s.article_id = new.id and s.review_state = 'approved') then
    perform private.fail('FORBIDDEN', 'A Gazette story can only be published after the DM has approved it.');
  end if;
  return new;
end;
$$;

drop trigger if exists articles_news_publish_guard on public.articles;
create trigger articles_news_publish_guard before insert or update of status, type on public.articles
  for each row execute function private.news_publish_guard();

create or replace function private.news_unpublish_on_retract()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.review_state <> 'approved' then
    update public.articles set status = 'draft' where id = new.article_id and status = 'published';
  end if;
  return null;
end;
$$;

drop trigger if exists news_stories_unpublish on public.news_stories;
create trigger news_stories_unpublish after update of review_state on public.news_stories
  for each row execute function private.news_unpublish_on_retract();

-------------------------------------------------------------------------------
-- Revisions of printed stories
-------------------------------------------------------------------------------
-- An edit to a story players can already read is not applied: it waits here, DM-only, until the DM
-- approves it. Players keep reading the approved version in the meantime.
create table if not exists public.news_pending (
  article_id uuid primary key references public.articles (id) on delete cascade,
  story jsonb not null,
  review_state public.news_review_state not null default 'draft',
  updated_at timestamptz not null default now()
);
alter table public.news_pending enable row level security;
revoke all on public.news_pending from anon, authenticated;
grant select on public.news_pending to authenticated;
grant all on public.news_pending to service_role;
drop policy if exists news_pending_dm on public.news_pending;
create policy news_pending_dm on public.news_pending for select to authenticated using ((select private.is_dm()));

-- The text, pictures and newspaper details of a printed story change only when an approved revision
-- is applied (news_transition sets chronicle.news_apply for that one transaction). The news desk,
-- the general editor, change sets and direct writes are all held to this.
create or replace function private.news_printed(p_article uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.articles a where a.id = p_article and a.type::text = 'news' and a.status = 'published');
$$;

create or replace function private.news_guard_printed()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_article uuid;
begin
  if coalesce(current_setting('chronicle.news_apply', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'articles' then
    if old.type::text = 'news' and old.status = 'published' and new.status = 'published'
       and (new.title, new.subtitle, new.summary, new.hero_media_id, new.slug)
           is distinct from (old.title, old.subtitle, old.summary, old.hero_media_id, old.slug) then
      perform private.fail('FORBIDDEN', 'Printed Gazette stories change only through an approved revision on the news desk.');
    end if;
    return new;
  end if;
  v_article := case when tg_op = 'DELETE' then old.article_id else new.article_id end;
  if private.news_printed(v_article) or (tg_op = 'UPDATE' and private.news_printed(old.article_id)) then
    perform private.fail('FORBIDDEN', 'Printed Gazette stories change only through an approved revision on the news desk.');
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists articles_news_printed_guard on public.articles;
create trigger articles_news_printed_guard before update of title, subtitle, summary, hero_media_id, slug on public.articles
  for each row execute function private.news_guard_printed();
drop trigger if exists sections_news_printed_guard on public.article_sections;
create trigger sections_news_printed_guard before insert or update or delete on public.article_sections
  for each row execute function private.news_guard_printed();
drop trigger if exists news_stories_printed_guard on public.news_stories;
create trigger news_stories_printed_guard before update of section, reliability, reporter, dateline, in_world_date, issue_number, is_lead, corrects_article_id on public.news_stories
  for each row execute function private.news_guard_printed();

-------------------------------------------------------------------------------
-- Website functions (DM only, never through an OAuth client)
-------------------------------------------------------------------------------
-- SECURITY DEFINER so that review states can only change through these functions (there is no
-- direct write grant on news_stories or news_pending, not even for the DM). Each checks first that
-- the caller is the DM, through the website, from the caller's own token.

-- Writes a story's page and details now (one transaction, version check, snapshot first).
create or replace function private.news_write(p_story jsonb, p_expected_version text, p_cur public.articles)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_a jsonb := coalesce(p_story -> 'article', '{}');
  v_d jsonb := coalesce(p_story -> 'details', '{}');
  v_saved jsonb;
  v_id uuid;
begin
  -- Publication is never changed here.
  v_a := v_a || jsonb_build_object(
    'type', 'news',
    'status', coalesce(p_cur.status::text, 'draft'),
    'visibility', coalesce(p_cur.visibility::text, 'dm'),
    'is_party_member', false,
    'is_featured', coalesce(p_cur.is_featured, false));
  v_saved := public.save_article(
    jsonb_build_object('article', v_a, 'sections', coalesce(p_story -> 'sections', '[]'::jsonb), 'infobox', '[]'::jsonb),
    p_expected_version, 'Before Gazette save');
  v_id := (v_saved ->> 'id')::uuid;
  insert into public.news_stories as s (article_id, section, reliability, reporter, dateline, in_world_date, issue_number, is_lead, corrects_article_id)
  values (v_id,
    coalesce(nullif(v_d ->> 'section', ''), 'local')::public.news_section,
    coalesce(nullif(v_d ->> 'reliability', ''), 'confirmed')::public.news_reliability,
    coalesce(nullif(v_d ->> 'reporter', ''), 'editor'),
    left(coalesce(v_d ->> 'dateline', ''), 120),
    left(coalesce(v_d ->> 'in_world_date', ''), 120),
    nullif(v_d ->> 'issue_number', '')::integer,
    coalesce((v_d ->> 'is_lead')::boolean, false),
    nullif(v_d ->> 'corrects_article_id', '')::uuid)
  on conflict (article_id) do update set
    section = excluded.section, reliability = excluded.reliability, reporter = excluded.reporter,
    dateline = excluded.dateline, in_world_date = excluded.in_world_date, issue_number = excluded.issue_number,
    is_lead = excluded.is_lead, corrects_article_id = excluded.corrects_article_id, updated_at = now();
  return v_saved;
end;
$$;

-- Applies a waiting revision to the page, inside the caller's transaction.
create or replace function private.news_apply_pending(p_article uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.news_pending;
  v_cur public.articles;
begin
  select * into v_p from public.news_pending where article_id = p_article for update;
  if not found then return; end if;
  select * into v_cur from public.articles where id = p_article for update;
  perform set_config('chronicle.news_apply', 'on', true);
  perform private.news_write(v_p.story, null, v_cur);
  perform set_config('chronicle.news_apply', '', true);
  delete from public.news_pending where article_id = p_article;
end;
$$;

-- Saves a story. A story players can read is not changed: the edit becomes (or replaces) its
-- waiting revision. An approved story that is not printed yet goes back to review.
create or replace function public.save_news_story(p_story jsonb, p_expected_version text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_a jsonb := coalesce(p_story -> 'article', '{}');
  v_cur public.articles;
  v_saved jsonb;
begin
  perform private.require_dm();
  if private.request_client() <> 'web' then
    perform private.fail('FORBIDDEN', 'Gazette stories can only be saved from the Chronicle website.');
  end if;
  if nullif(v_a ->> 'id', '') is not null then
    select * into v_cur from public.articles where id = (v_a ->> 'id')::uuid for update;
    if not found or v_cur.type::text <> 'news' then
      perform private.fail('NOT_FOUND', 'No such Gazette story.');
    end if;
    if p_expected_version is not null and p_expected_version <> 'v' || v_cur.version then
      perform private.fail('CONFLICT', 'This story was changed somewhere else since you opened it.',
        jsonb_build_object('slug', v_cur.slug, 'expected', p_expected_version, 'current', 'v' || v_cur.version));
    end if;
  end if;

  if v_cur.id is not null and v_cur.status = 'published' then
    if coalesce(v_a ->> 'slug', v_cur.slug) <> v_cur.slug then
      perform private.fail('VALIDATION_FAILED', 'The address of a printed story cannot change.');
    end if;
    insert into public.news_pending as p (article_id, story, review_state)
    values (v_cur.id, jsonb_set(p_story, '{article,id}', to_jsonb(v_cur.id::text)), 'draft')
    on conflict (article_id) do update set story = excluded.story, review_state = 'draft', updated_at = now();
    return (to_jsonb(v_cur) - 'search_tsv') || jsonb_build_object('version', 'v' || v_cur.version, 'pending', true);
  end if;

  v_saved := private.news_write(p_story, p_expected_version, v_cur);
  update public.news_stories set review_state = 'in_review', reviewed_at = null, updated_at = now()
  where article_id = (v_saved ->> 'id')::uuid and review_state = 'approved';
  return v_saved || jsonb_build_object('pending', false);
end;
$$;

-- Unprinted story:  submit (draft -> in_review), approve (in_review -> approved),
--                   return (-> draft), publish (approved -> printed).
-- Printed story:    submit / approve act on its waiting revision (approve applies it), discard
--                   drops the revision; return / unpublish take the story out of the paper, keeping
--                   any waiting revision's text as the new draft.
create or replace function public.news_transition(p_article uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_story public.news_stories;
  v_art public.articles;
  v_pending public.news_pending;
  v_has_pending boolean;
begin
  perform private.require_dm();
  if private.request_client() <> 'web' then
    perform private.fail('FORBIDDEN', 'Only the DM, on the Chronicle website, can review or publish Gazette stories.');
  end if;
  select * into v_art from public.articles where id = p_article and type::text = 'news' for update;
  if not found then
    perform private.fail('NOT_FOUND', 'No such Gazette story.');
  end if;
  insert into public.news_stories (article_id) values (p_article) on conflict (article_id) do nothing;
  select * into v_story from public.news_stories where article_id = p_article for update;
  select * into v_pending from public.news_pending where article_id = p_article for update;
  v_has_pending := found;

  if v_art.status = 'published' and p_action in ('submit', 'approve', 'discard') then
    if not v_has_pending then
      perform private.fail('CONFLICT', 'This story is printed and has no waiting revision.');
    end if;
    case p_action
      when 'submit' then
        if v_pending.review_state <> 'draft' then perform private.fail('CONFLICT', 'The revision is already in review.'); end if;
        update public.news_pending set review_state = 'in_review', updated_at = now() where article_id = p_article;
      when 'approve' then
        if v_pending.review_state <> 'in_review' then perform private.fail('CONFLICT', 'Send the revision for review before approving it.'); end if;
        perform private.news_apply_pending(p_article);
        update public.news_stories set reviewed_at = now(), updated_at = now() where article_id = p_article;
      else
        delete from public.news_pending where article_id = p_article;
    end case;
  else
    case p_action
      when 'submit' then
        if v_story.review_state <> 'draft' then perform private.fail('CONFLICT', 'Only a draft can be sent for review.'); end if;
        update public.news_stories set review_state = 'in_review', updated_at = now() where article_id = p_article;
      when 'approve' then
        if v_story.review_state <> 'in_review' then perform private.fail('CONFLICT', 'Send the story for review before approving it.'); end if;
        update public.news_stories set review_state = 'approved', reviewed_at = now(), updated_at = now() where article_id = p_article;
      when 'return' then
        update public.news_stories set review_state = 'draft', reviewed_at = null, updated_at = now() where article_id = p_article;
        perform private.news_apply_pending(p_article);
      when 'publish' then
        if v_story.review_state <> 'approved' then perform private.fail('FORBIDDEN', 'Approve the story before publishing it.'); end if;
        update public.articles set status = 'published', visibility = 'players', published_at = coalesce(published_at, now()) where id = p_article;
      when 'unpublish' then
        update public.articles set status = 'draft' where id = p_article;
        if v_has_pending then
          -- The waiting text was never approved: it becomes the draft, back in review.
          perform private.news_apply_pending(p_article);
          update public.news_stories set review_state = 'in_review', reviewed_at = null, updated_at = now() where article_id = p_article;
        end if;
      when 'discard' then
        perform private.fail('CONFLICT', 'There is no waiting revision to discard.');
      else
        perform private.fail('VALIDATION_FAILED', 'Unknown action.');
    end case;
  end if;
  select * into v_story from public.news_stories where article_id = p_article;
  select * into v_art from public.articles where id = p_article;
  select * into v_pending from public.news_pending where article_id = p_article;
  return jsonb_build_object('review_state', v_story.review_state, 'status', v_art.status, 'visibility', v_art.visibility,
    'version', 'v' || v_art.version, 'pending', case when found then v_pending.review_state::text else null end);
end;
$$;

revoke all on function public.save_news_story(jsonb, text), public.news_transition(uuid, text) from public, anon, authenticated;
grant execute on function public.save_news_story(jsonb, text), public.news_transition(uuid, text) to authenticated;
revoke all on function private.news_publish_guard(), private.news_unpublish_on_retract(), private.news_guard_printed(),
  private.news_printed(uuid), private.news_write(jsonb, text, public.articles), private.news_apply_pending(uuid) from public;
grant execute on function private.news_publish_guard(), private.news_unpublish_on_retract(), private.news_guard_printed(),
  private.news_printed(uuid) to authenticated, service_role;
grant execute on function private.news_write(jsonb, text, public.articles), private.news_apply_pending(uuid) to service_role;
