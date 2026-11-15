-- Gazette stories proposed by an assistant. Requires 20261116000100. Forward-only; not authorized
-- for production until the owner approves the migration bundle.
--
-- An assistant (OAuth, connected as the DM) may file a story proposal. It cannot save, review,
-- approve or print anything: the DM sees the proposal on the news desk and either accepts it,
-- which saves it as an ordinary private draft through public.save_news_story (website only), or
-- dismisses it. From there the story follows the normal Draft -> In review -> Approved -> Printed
-- workflow, which assistants were already refused.
--
-- Forward recovery: drop public.accept_news_proposal(uuid), public.news_proposals and
-- private.guard_news_proposals() in a new reviewed migration (no story depends on a proposal).

create table if not exists public.news_proposals (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 200),
  subtitle text not null default '' check (char_length(subtitle) <= 200),
  summary text not null default '' check (char_length(summary) <= 2000),
  body text not null check (char_length(body) between 1 and 30000),
  section public.news_section not null,
  reliability public.news_reliability not null,
  reporter text not null check (char_length(reporter) between 1 and 80),
  dateline text not null default '' check (char_length(dateline) <= 120),
  in_world_date text not null default '' check (char_length(in_world_date) <= 120),
  based_on text[] not null default '{}' check (cardinality(based_on) <= 20),
  warnings text[] not null default '{}' check (cardinality(warnings) <= 20),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  article_id uuid references public.articles (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_via text not null default 'web' check (char_length(created_via) <= 200),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists news_proposals_created on public.news_proposals (created_at desc);
create index if not exists news_proposals_created_by on public.news_proposals (created_by);
create index if not exists news_proposals_article on public.news_proposals (article_id);

alter table public.news_proposals enable row level security;
revoke all on public.news_proposals from anon, authenticated;
grant select, insert, update, delete on public.news_proposals to authenticated;
grant all on public.news_proposals to service_role;
drop policy if exists news_proposals_dm on public.news_proposals;
create policy news_proposals_dm on public.news_proposals for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

create or replace function private.guard_news_proposals()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- An OAuth token can insert directly, past the Worker's own checks, so the limits live here.
    if exists (select 1 from unnest(new.based_on || new.warnings) as x(item) where char_length(x.item) > 300) then
      perform private.fail('VALIDATION_FAILED', 'Each based_on and warnings item must be at most 300 characters.');
    end if;
    if (select count(*) from public.news_proposals where status = 'pending') >= 50 then
      perform private.fail('RATE_LIMITED', '50 story proposals are already waiting on the news desk. The DM must accept or dismiss some before more can be filed.');
    end if;
    -- A proposal always starts pending and attached to nothing, whoever files it.
    new.status := 'pending';
    new.article_id := null;
    new.decided_at := null;
    new.created_by := (select auth.uid());
    new.created_via := private.request_client();
    new.created_at := now();
    return new;
  end if;
  if private.is_oauth_request() then
    raise exception 'Only the DM, on the Chronicle website, can accept or dismiss a story proposal'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    -- The DM decides; the proposal itself is not rewritten. Accepting goes through
    -- accept_news_proposal, which is the only way a proposal gets an article.
    if (new.title, new.subtitle, new.summary, new.body, new.section, new.reliability, new.reporter, new.dateline, new.in_world_date, new.based_on, new.warnings, new.created_by, new.created_via, new.created_at)
       is distinct from (old.title, old.subtitle, old.summary, old.body, old.section, old.reliability, old.reporter, old.dateline, old.in_world_date, old.based_on, old.warnings, old.created_by, old.created_via, old.created_at)
       and not (new.created_by is null and old.created_by is not null) then
      raise exception 'A story proposal cannot be rewritten' using errcode = '42501';
    end if;
    if new.article_id is distinct from old.article_id and coalesce(current_setting('chronicle.news_proposal_accept', true), '') <> 'on'
       and not (new.article_id is null and old.article_id is not null) then
      raise exception 'Accept a story proposal with accept_news_proposal' using errcode = '42501';
    end if;
    if old.status <> 'pending' and new.status <> old.status then
      raise exception 'This proposal was already decided' using errcode = '42501';
    end if;
    if new.status <> old.status then new.decided_at := now(); end if;
    return new;
  end if;
  return old;
end;
$$;
revoke all on function private.guard_news_proposals() from public, anon;
grant execute on function private.guard_news_proposals() to authenticated, service_role;
drop trigger if exists news_proposals_guard on public.news_proposals;
create trigger news_proposals_guard before insert or update or delete on public.news_proposals
  for each row execute function private.guard_news_proposals();

-- Accept: save the proposal as a private draft story (never printed), once.
create or replace function public.accept_news_proposal(p_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.news_proposals;
  v_slug text;
  v_saved jsonb;
begin
  perform private.require_dm();
  if private.request_client() <> 'web' then
    perform private.fail('FORBIDDEN', 'Only the DM, on the Chronicle website, can accept a story proposal.');
  end if;
  select * into v_p from public.news_proposals where id = p_id for update;
  if not found then
    perform private.fail('NOT_FOUND', 'No such story proposal.');
  end if;
  if v_p.status <> 'pending' then
    perform private.fail('CONFLICT', 'This proposal was already accepted or dismissed.');
  end if;
  v_slug := trim(both '-' from left(regexp_replace(lower(v_p.title), '[^a-z0-9]+', '-', 'g'), 150));
  if v_slug = '' or exists (select 1 from public.articles where slug = v_slug) or exists (select 1 from public.redirects where from_slug = v_slug) then
    v_slug := trim(both '-' from (left(v_slug, 140) || '-' || left(replace(p_id::text, '-', ''), 6)));
  end if;
  v_saved := public.save_news_story(jsonb_build_object(
    'article', jsonb_build_object('slug', v_slug, 'title', trim(v_p.title), 'subtitle', v_p.subtitle, 'summary', v_p.summary, 'hero_media_id', null),
    'sections', jsonb_build_array(jsonb_build_object('heading', '', 'body', v_p.body, 'visibility', 'players', 'status', 'published')),
    'details', jsonb_build_object('section', v_p.section, 'reliability', v_p.reliability, 'reporter', v_p.reporter,
      'dateline', v_p.dateline, 'in_world_date', v_p.in_world_date, 'issue_number', null, 'is_lead', false, 'corrects_article_id', null)));
  perform set_config('chronicle.news_proposal_accept', 'on', true);
  update public.news_proposals set status = 'accepted', article_id = (v_saved ->> 'id')::uuid where id = p_id;
  perform set_config('chronicle.news_proposal_accept', '', true);
  return jsonb_build_object('id', v_saved ->> 'id', 'slug', v_saved ->> 'slug');
end;
$$;
revoke all on function public.accept_news_proposal(uuid) from public, anon, authenticated;
grant execute on function public.accept_news_proposal(uuid) to authenticated;

notify pgrst, 'reload schema';
