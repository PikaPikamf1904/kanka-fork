-- Chronicle cloud: Living World — scheduled Gazette stories and "Letters from Krynn".
--
-- Design: a scheduled story is an ordinary Gazette page that stays 'draft' (so every existing
-- read path — direct URL, search, suggestions, the graph, related pages, counts, maps, timelines,
-- media, the export — already treats it as unpublished) plus a `publish_at` time. When that time
-- has passed, `public.release_due_stories()` flips it to 'published' using the DATABASE clock, in the
-- same way a manual "Print" does (same approval guard, same triggers, same hero-image sync). There
-- is no cron job and no worker: any signed-in member opening the site runs it (it is idempotent and
-- can only release what the DM already approved and scheduled). A player's device clock never
-- decides anything.
--
-- * Only an APPROVED story can be scheduled, only by the DM on the website (news_schedule).
-- * Editing an approved story sends it back to review; that clears its schedule, so text that was
--   never approved cannot go out on a timer.
-- * Taking a story back to draft clears its schedule.
-- * Letters from Krynn are Gazette pages with section 'letters' plus sender, recipient and
--   signature. They use the same review, approval, scheduling, privacy and search as stories.
-- * campaign_settings.timezone is the campaign's own time zone, used to read the DM's chosen
--   publication time (the website converts it to an exact instant; the database stores the instant).
--
-- Rollback (local only):
--   drop function if exists public.release_due_stories(), public.news_schedule(uuid, timestamptz, text);
--   drop trigger if exists settings_timezone_check on public.campaign_settings;
--   drop function if exists private.check_timezone();
--   alter table public.campaign_settings drop column if exists timezone;
--   alter table public.news_stories drop column if exists letter_from, drop column if exists letter_to, drop column if exists letter_signature;
--   drop index if exists articles_publish_due;
--   alter table public.articles drop column if exists publish_at;
--   and restore private.set_published_at(), private.news_unpublish_on_retract() and private.news_write()
--   from migrations 20261109000100 and 20261112001300. ('letters' cannot be removed from the enum
--   without recreating the type; retype or delete any letters first if that is ever needed.)

alter type public.news_section add value if not exists 'letters';

alter table public.articles add column if not exists publish_at timestamptz;
create index if not exists articles_publish_due on public.articles (publish_at) where publish_at is not null;

alter table public.news_stories
  add column if not exists letter_from text not null default '' check (char_length(letter_from) <= 120),
  add column if not exists letter_to text not null default '' check (char_length(letter_to) <= 120),
  add column if not exists letter_signature text not null default '' check (char_length(letter_signature) <= 200);

alter table public.campaign_settings add column if not exists timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64);
grant select (timezone) on public.campaign_settings to authenticated;

create or replace function private.check_timezone()
returns trigger language plpgsql set search_path = ''
as $$
begin
  perform now() at time zone new.timezone; -- raises for an unknown zone
  return new;
end;
$$;
drop trigger if exists settings_timezone_check on public.campaign_settings;
create trigger settings_timezone_check before insert or update of timezone on public.campaign_settings
  for each row execute function private.check_timezone();

-- A scheduled story that is published (by hand or by its time) is dated by its scheduled time when
-- that has passed, otherwise now; the schedule is then spent.
create or replace function private.set_published_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at := case when new.publish_at is not null and new.publish_at <= now() then new.publish_at else now() end;
    new.publish_at := null;
  end if;
  return new;
end;
$$;

-- Back to review or draft: the schedule goes too.
create or replace function private.news_unpublish_on_retract()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.review_state <> 'approved' then
    update public.articles set status = 'draft', publish_at = null
    where id = new.article_id and (status = 'published' or publish_at is not null);
  end if;
  return null;
end;
$$;

-- The same as before, plus the letter fields (and the printed-story guard now covers them).
create or replace function private.news_write(p_story jsonb, p_expected_version text, p_cur public.articles)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_a jsonb := coalesce(p_story -> 'article', '{}');
  v_d jsonb := coalesce(p_story -> 'details', '{}');
  v_saved jsonb;
  v_id uuid;
begin
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
  insert into public.news_stories as s (article_id, section, reliability, reporter, dateline, in_world_date, issue_number, is_lead, corrects_article_id,
                                        letter_from, letter_to, letter_signature)
  values (v_id,
    coalesce(nullif(v_d ->> 'section', ''), 'local')::public.news_section,
    coalesce(nullif(v_d ->> 'reliability', ''), 'confirmed')::public.news_reliability,
    coalesce(nullif(v_d ->> 'reporter', ''), 'editor'),
    left(coalesce(v_d ->> 'dateline', ''), 120),
    left(coalesce(v_d ->> 'in_world_date', ''), 120),
    nullif(v_d ->> 'issue_number', '')::integer,
    coalesce((v_d ->> 'is_lead')::boolean, false),
    nullif(v_d ->> 'corrects_article_id', '')::uuid,
    left(coalesce(v_d ->> 'letter_from', ''), 120),
    left(coalesce(v_d ->> 'letter_to', ''), 120),
    left(coalesce(v_d ->> 'letter_signature', ''), 200))
  on conflict (article_id) do update set
    section = excluded.section, reliability = excluded.reliability, reporter = excluded.reporter,
    dateline = excluded.dateline, in_world_date = excluded.in_world_date, issue_number = excluded.issue_number,
    is_lead = excluded.is_lead, corrects_article_id = excluded.corrects_article_id,
    letter_from = excluded.letter_from, letter_to = excluded.letter_to, letter_signature = excluded.letter_signature,
    updated_at = now();
  return v_saved;
end;
$$;

drop trigger if exists news_stories_printed_guard on public.news_stories;
create trigger news_stories_printed_guard
  before update of section, reliability, reporter, dateline, in_world_date, issue_number, is_lead, corrects_article_id,
                   letter_from, letter_to, letter_signature on public.news_stories
  for each row execute function private.news_guard_printed();

-------------------------------------------------------------------------------
-- Scheduling (DM, website only) and release (any member; database clock)
-------------------------------------------------------------------------------
-- p_at in the future schedules (or reschedules) an approved, unprinted story; null cancels.
create or replace function public.news_schedule(p_article uuid, p_at timestamptz, p_expected_version text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_art public.articles;
begin
  perform private.require_dm();
  if private.request_client() <> 'web' then
    perform private.fail('FORBIDDEN', 'Only the DM, on the Chronicle website, can schedule Gazette stories.');
  end if;
  select * into v_art from public.articles where id = p_article and type::text = 'news' for update;
  if not found then
    perform private.fail('NOT_FOUND', 'No such Gazette story.');
  end if;
  if p_expected_version is not null and p_expected_version <> 'v' || v_art.version then
    perform private.fail('CONFLICT', 'This story was changed somewhere else since you opened it. Reload it and try again.',
      jsonb_build_object('slug', v_art.slug, 'expected', p_expected_version, 'current', 'v' || v_art.version));
  end if;
  if v_art.status = 'published' then
    perform private.fail('CONFLICT', 'This story is already printed. Unprint it first if you want to schedule it again.');
  end if;
  if p_at is not null then
    if not exists (select 1 from public.news_stories s where s.article_id = p_article and s.review_state = 'approved') then
      perform private.fail('FORBIDDEN', 'Approve the story before scheduling it.');
    end if;
    if p_at <= now() then
      perform private.fail('VALIDATION_FAILED', 'Choose a time in the future, or print the story now.');
    end if;
  end if;
  -- Only the schedule changes: visibility is set when the story is printed, as for "Print now".
  update public.articles set publish_at = p_at where id = p_article;
  return jsonb_build_object('publish_at', p_at, 'status', v_art.status);
end;
$$;

-- Prints every approved Gazette story (or letter) whose time has come. Safe to call at any time and
-- by anyone signed in: it only does what the DM already approved and scheduled, judged by the
-- database clock. Returns how many it printed.
create or replace function public.release_due_stories()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  if not (private.is_member() or private.is_dm()) then
    return 0;
  end if;
  with due as (
    select a.id from public.articles a
    where a.type::text = 'news' and a.status = 'draft' and a.publish_at is not null and a.publish_at <= now()
      and exists (select 1 from public.news_stories s where s.article_id = a.id and s.review_state = 'approved')
    order by a.publish_at
    for update of a skip locked
  ), done as (
    update public.articles a set status = 'published', visibility = 'players'
    from due where a.id = due.id
    returning a.id
  )
  select count(*) into v_n from done;
  return v_n;
end;
$$;

revoke all on function public.news_schedule(uuid, timestamptz, text), public.release_due_stories() from public, anon, authenticated;
grant execute on function public.news_schedule(uuid, timestamptz, text) to authenticated;
grant execute on function public.release_due_stories() to authenticated;
revoke all on function private.check_timezone() from public;
notify pgrst, 'reload schema';
