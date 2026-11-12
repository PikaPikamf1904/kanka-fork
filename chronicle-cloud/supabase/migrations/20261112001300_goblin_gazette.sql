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
-- Website functions (DM only, never through an OAuth client)
-------------------------------------------------------------------------------
-- Saves the story page (through save_article: one transaction, version check, snapshot) and its
-- newspaper details together. Never changes publication or review state.
-- SECURITY DEFINER so that the review state can only change through these two functions (there is
-- no direct write grant on news_stories, not even for the DM). Each checks first that the caller is
-- the DM, through the website, from the caller's own token.
create or replace function public.save_news_story(p_story jsonb, p_expected_version text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_a jsonb := coalesce(p_story -> 'article', '{}');
  v_d jsonb := coalesce(p_story -> 'details', '{}');
  v_cur public.articles;
  v_saved jsonb;
  v_id uuid;
begin
  perform private.require_dm();
  if private.request_client() <> 'web' then
    perform private.fail('FORBIDDEN', 'Gazette stories can only be saved from the Chronicle website.');
  end if;
  if nullif(v_a ->> 'id', '') is not null then
    select * into v_cur from public.articles where id = (v_a ->> 'id')::uuid;
    if not found or v_cur.type::text <> 'news' then
      perform private.fail('NOT_FOUND', 'No such Gazette story.');
    end if;
  end if;
  -- Publication is changed only by news_transition.
  v_a := v_a || jsonb_build_object(
    'type', 'news',
    'status', coalesce(v_cur.status::text, 'draft'),
    'visibility', coalesce(v_cur.visibility::text, 'dm'),
    'is_party_member', false,
    'is_featured', coalesce(v_cur.is_featured, false));
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

-- submit: draft -> in_review; approve: in_review -> approved; return: -> draft (un-publishes);
-- publish: approved -> page published for players; unpublish: page back to draft (stays approved).
create or replace function public.news_transition(p_article uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_story public.news_stories;
  v_art public.articles;
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

  case p_action
    when 'submit' then
      if v_story.review_state <> 'draft' then perform private.fail('CONFLICT', 'Only a draft can be sent for review.'); end if;
      update public.news_stories set review_state = 'in_review', updated_at = now() where article_id = p_article;
    when 'approve' then
      if v_story.review_state <> 'in_review' then perform private.fail('CONFLICT', 'Send the story for review before approving it.'); end if;
      update public.news_stories set review_state = 'approved', reviewed_at = now(), updated_at = now() where article_id = p_article;
    when 'return' then
      update public.news_stories set review_state = 'draft', reviewed_at = null, updated_at = now() where article_id = p_article;
    when 'publish' then
      if v_story.review_state <> 'approved' then perform private.fail('FORBIDDEN', 'Approve the story before publishing it.'); end if;
      update public.articles set status = 'published', visibility = 'players', published_at = coalesce(published_at, now()) where id = p_article;
    when 'unpublish' then
      update public.articles set status = 'draft' where id = p_article;
    else
      perform private.fail('VALIDATION_FAILED', 'Unknown action.');
  end case;
  select * into v_story from public.news_stories where article_id = p_article;
  select * into v_art from public.articles where id = p_article;
  return jsonb_build_object('review_state', v_story.review_state, 'status', v_art.status, 'visibility', v_art.visibility, 'version', 'v' || v_art.version);
end;
$$;

revoke all on function public.save_news_story(jsonb, text), public.news_transition(uuid, text) from public, anon, authenticated;
grant execute on function public.save_news_story(jsonb, text), public.news_transition(uuid, text) to authenticated;
revoke all on function private.news_publish_guard(), private.news_unpublish_on_retract() from public;
grant execute on function private.news_publish_guard(), private.news_unpublish_on_retract() to authenticated, service_role;
