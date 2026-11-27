-- Chronicle cloud: Gazette proposals with a suggested release time, and one DM-only batch action.
-- Requires 20261116000200 (news_proposals) and 20261126000100 (scheduled stories).
--
-- An assistant (ChatGPT over MCP) files complete stories as PROPOSALS and may suggest when each should
-- appear. A suggestion decides nothing. The DM reads the proposals on the news desk and, in one action,
-- accepts, approves and schedules the ones they choose. That action is public.schedule_news_proposals
-- and it only chains the functions that already exist, each of which is already DM-only and
-- website-only (an OAuth/assistant token is refused by every one of them):
--     accept_news_proposal -> news_transition('submit') -> news_transition('approve')
--     -> news_schedule(time)   or   news_transition('publish') when the DM chooses "print now".
-- It is all or nothing: if any story fails (a duplicate title, a time already past, a changed
-- proposal) nothing is changed.
--
-- Audit trail (no new table): news_proposals.created_via names the OAuth client that filed it, created_by is
-- the account it acted for, decided_by / decided_at record the DM's decision, news_proposals.article_id
-- links to the story, and news_stories.reviewed_at records the approval.
--
-- Rollback (local only):
--   drop function if exists public.schedule_news_proposals(jsonb);
--   alter table public.news_proposals drop column if exists suggested_publish_at, drop column if exists decided_by;
--   and restore private.guard_news_proposals() from 20261116000200.

alter table public.news_proposals
  add column if not exists suggested_publish_at timestamptz,
  add column if not exists decided_by uuid references auth.users (id) on delete set null;
create index if not exists news_proposals_decided_by on public.news_proposals (decided_by);

-- The same guard as before, plus: the suggestion is part of what an assistant filed (not rewritable),
-- and the decision records who decided.
create or replace function private.guard_news_proposals()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from unnest(new.based_on || new.warnings) as x(item) where char_length(x.item) > 300) then
      perform private.fail('VALIDATION_FAILED', 'Each based_on and warnings item must be at most 300 characters.');
    end if;
    if (select count(*) from public.news_proposals where status = 'pending') >= 50 then
      perform private.fail('RATE_LIMITED', '50 story proposals are already waiting on the news desk. The DM must accept or dismiss some before more can be filed.');
    end if;
    new.status := 'pending';
    new.article_id := null;
    new.decided_at := null;
    new.decided_by := null;
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
    if (new.title, new.subtitle, new.summary, new.body, new.section, new.reliability, new.reporter, new.dateline, new.in_world_date, new.based_on, new.warnings, new.suggested_publish_at, new.created_by, new.created_via, new.created_at)
       is distinct from (old.title, old.subtitle, old.summary, old.body, old.section, old.reliability, old.reporter, old.dateline, old.in_world_date, old.based_on, old.warnings, old.suggested_publish_at, old.created_by, old.created_via, old.created_at)
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
    -- Who decided is always the signed-in caller, never a value they supply.
    new.decided_by := old.decided_by;
    if new.status <> old.status then
      new.decided_at := now();
      new.decided_by := (select auth.uid());
    end if;
    return new;
  end if;
  return old;
end;
$$;

-- Accept, approve and schedule (or print) the chosen proposals, in one transaction.
--   p_items: [{ "id": "<proposal id>", "at": "<ISO time with offset>" | null, "print_now": true | false }, ...]
-- "at" in the future schedules; null with print_now false leaves the story approved and unscheduled;
-- print_now true prints it at once. A time that has already passed is refused: the DM must choose
-- "print now" or a new time, so a missed date is never backdated silently.
create or replace function public.schedule_news_proposals(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_item jsonb;
  v_p public.news_proposals;
  v_id uuid;
  v_at timestamptz;
  v_print boolean;
  v_acc jsonb;
  v_article uuid;
  v_out jsonb := '[]'::jsonb;
  v_state text;
begin
  perform private.require_dm();
  if private.request_client() <> 'web' then
    perform private.fail('FORBIDDEN', 'Only the DM, on the Chronicle website, can accept, approve and schedule story proposals.');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    perform private.fail('VALIDATION_FAILED', 'Choose between 1 and 20 proposals.');
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_id := (v_item ->> 'id')::uuid;
      v_at := nullif(v_item ->> 'at', '')::timestamptz;
    exception when others then
      perform private.fail('VALIDATION_FAILED', 'A proposal id or time is not valid.');
    end;
    v_print := coalesce((v_item ->> 'print_now')::boolean, false);
    if v_print and v_at is not null then
      perform private.fail('VALIDATION_FAILED', 'Choose either a time or "print now", not both.');
    end if;
    select * into v_p from public.news_proposals where id = v_id for update;
    if not found then
      perform private.fail('NOT_FOUND', 'No such story proposal.');
    end if;
    if v_p.status <> 'pending' then
      perform private.fail('CONFLICT', format('"%s" was already accepted or dismissed.', left(v_p.title, 80)));
    end if;
    if v_at is not null and v_at <= now() then
      perform private.fail('VALIDATION_FAILED', format('The time for "%s" has already passed. Choose "print now" or a new time.', left(v_p.title, 80)));
    end if;
    -- No second copy of a story the Gazette already has (printed, scheduled or in draft).
    if exists (select 1 from public.articles a where a.type::text = 'news' and lower(btrim(a.title)) = lower(btrim(v_p.title))) then
      perform private.fail('ALREADY_EXISTS', format('The Gazette already has a story titled "%s".', left(v_p.title, 80)));
    end if;

    v_acc := public.accept_news_proposal(v_id);
    v_article := (v_acc ->> 'id')::uuid;
    perform public.news_transition(v_article, 'submit');
    perform public.news_transition(v_article, 'approve');
    if v_print then
      perform public.news_transition(v_article, 'publish');
      v_state := 'printed';
    elsif v_at is not null then
      perform public.news_schedule(v_article, v_at);
      v_state := 'scheduled';
    else
      v_state := 'approved';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('proposal_id', v_id, 'article_id', v_article, 'slug', v_acc ->> 'slug', 'state', v_state, 'publish_at', v_at));
  end loop;
  return v_out;
end;
$$;

revoke all on function public.schedule_news_proposals(jsonb) from public, anon, authenticated;
grant execute on function public.schedule_news_proposals(jsonb) to authenticated;
notify pgrst, 'reload schema';
