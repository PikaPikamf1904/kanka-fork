-- Feedback Center: bugs, ideas, what players enjoy or want more or less of, confusing parts of
-- the campaign, things that make someone uncomfortable, and anything else.
--
-- Two modes:
-- * Named: the player knowingly signs it; they can read their own named submissions and the DM's
--   reply.
-- * Anonymous: submitted only through submit_anonymous_feedback(). The row stores no user id, no
--   name, no time of day (only the date) and no address or device. A daily per-person limit is
--   counted under a keyed hash with a per-day random salt. Earlier days' salts and counts are
--   deleted at the next anonymous submission (there is no timer); once a day's salt is gone its
--   keys cannot be linked to anyone, and the keys never name the submission they counted.
--   Honest limit (stated on the form): writing style and details can identify someone, and the
--   hosting providers keep normal request logs.
--
-- Only the DM reads feedback. It is never indexed for search, never shown in the graph or any
-- player-facing tool, and assistants (OAuth/MCP) cannot read or write it.
--
-- Rollback (local only): drop the functions below and `drop table public.feedback`,
-- `drop table private.feedback_quota, private.feedback_salt`.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('bug', 'improvement', 'feature', 'enjoy', 'more', 'less', 'confusing', 'comfort', 'other')),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  mode text not null check (mode in ('named', 'anonymous')),
  author_id uuid references auth.users (id) on delete set null,
  author_name text,
  submitted_on date not null default current_date,
  status text not null default 'new' check (status in ('new', 'read', 'in_progress', 'done', 'closed')),
  priority text not null default 'none' check (priority in ('none', 'low', 'normal', 'high')),
  dm_note text not null default '' check (char_length(dm_note) <= 5000),
  reply text not null default '' check (char_length(reply) <= 5000),
  replied_at timestamptz,
  check (mode = 'named' or (author_id is null and author_name is null and reply = '' and replied_at is null))
);
create index if not exists feedback_author on public.feedback (author_id);

create table if not exists private.feedback_salt (
  day date primary key,
  salt bytea not null
);
create table if not exists private.feedback_quota (
  day date not null,
  key text not null,
  n integer not null default 0,
  primary key (day, key)
);
revoke all on private.feedback_salt, private.feedback_quota from public, anon, authenticated;

alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
grant select on public.feedback to authenticated;
grant insert (category, body, mode) on public.feedback to authenticated;
grant update (status, priority, dm_note, reply, replied_at) on public.feedback to authenticated;

--------------------------------------------------------------------------------
-- Named submissions: author forced to the caller; 20 per day.
--------------------------------------------------------------------------------
create or replace function private.feedback_named_before()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.mode = 'anonymous' and coalesce(current_setting('chronicle.anonymous_feedback', true), '') = 'on' then
    -- Only submit_anonymous_feedback() sets this flag, for its own insert; nothing is attached.
    new.author_id := null;
    new.author_name := null;
    new.submitted_on := current_date;
    return new;
  end if;
  if new.mode <> 'named' then
    raise exception 'Anonymous feedback goes through submit_anonymous_feedback' using errcode = '42501';
  end if;
  new.author_id := (select auth.uid());
  new.author_name := (select m.display_name from public.campaign_members m where m.user_id = (select auth.uid()));
  new.submitted_on := current_date;
  new.status := 'new';
  new.priority := 'none';
  new.dm_note := '';
  new.reply := '';
  new.replied_at := null;
  if (select count(*) from public.feedback f where f.author_id = new.author_id and f.submitted_on = current_date) >= 20 then
    raise exception 'That is a lot of feedback for one day. Please try again tomorrow.' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_named on public.feedback;
create trigger feedback_named before insert on public.feedback for each row execute function private.feedback_named_before();

-- The DM's replies are only for named feedback; the reply time is set here.
create or replace function private.feedback_update_before()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.reply is distinct from old.reply then
    if old.mode <> 'named' then
      raise exception 'Anonymous feedback cannot be answered' using errcode = '22023';
    end if;
    new.replied_at := case when btrim(new.reply) = '' then null else now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_update on public.feedback;
create trigger feedback_update before update on public.feedback for each row execute function private.feedback_update_before();

--------------------------------------------------------------------------------
-- Anonymous submissions.
--------------------------------------------------------------------------------
create or replace function public.submit_anonymous_feedback(p_category text, p_body text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_salt bytea;
  v_key text;
  v_n integer;
begin
  if not private.is_member() or private.is_oauth_request() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  -- Yesterday's salt and counts are gone for good.
  delete from private.feedback_quota where day < current_date;
  delete from private.feedback_salt where day < current_date;
  insert into private.feedback_salt (day, salt) values (current_date, extensions.gen_random_bytes(32)) on conflict (day) do nothing;
  select salt into v_salt from private.feedback_salt where day = current_date;
  v_key := encode(extensions.hmac(convert_to((select auth.uid())::text, 'utf8'), v_salt, 'sha256'), 'hex');
  insert into private.feedback_quota (day, key, n) values (current_date, v_key, 1)
  on conflict (day, key) do update set n = private.feedback_quota.n + 1
  returning n into v_n;
  if v_n > 5 then
    raise exception 'That is a lot of anonymous feedback for one day. Please try again tomorrow.' using errcode = '54000';
  end if;
  perform set_config('chronicle.anonymous_feedback', 'on', true);
  insert into public.feedback (category, body, mode) values (p_category, p_body, 'anonymous');
  perform set_config('chronicle.anonymous_feedback', '', true);
end;
$$;

--------------------------------------------------------------------------------
-- Policies: the DM reads and triages everything; a member reads only their own named rows.
--------------------------------------------------------------------------------
drop policy if exists feedback_dm_read on public.feedback;
create policy feedback_dm_read on public.feedback for select to authenticated
  using ((select private.is_dm()) and not (select private.is_oauth_request()));
drop policy if exists feedback_own_read on public.feedback;
create policy feedback_own_read on public.feedback for select to authenticated
  using (mode = 'named' and author_id = (select auth.uid()) and (select private.is_member()) and not (select private.is_oauth_request()));
drop policy if exists feedback_named_insert on public.feedback;
create policy feedback_named_insert on public.feedback for insert to authenticated
  with check (mode = 'named' and (select private.is_member()) and not (select private.is_oauth_request()));
drop policy if exists feedback_dm_update on public.feedback;
create policy feedback_dm_update on public.feedback for update to authenticated
  using ((select private.is_dm()) and not (select private.is_oauth_request()))
  with check ((select private.is_dm()) and not (select private.is_oauth_request()));
drop policy if exists feedback_dm_delete on public.feedback;
create policy feedback_dm_delete on public.feedback for delete to authenticated
  using ((select private.is_dm()) and not (select private.is_oauth_request()));
grant delete on public.feedback to authenticated;

revoke all on function private.feedback_named_before(), private.feedback_update_before() from public, anon;
revoke all on function public.submit_anonymous_feedback(text, text) from public, anon;
grant execute on function public.submit_anonymous_feedback(text, text) to authenticated;

notify pgrst, 'reload schema';
