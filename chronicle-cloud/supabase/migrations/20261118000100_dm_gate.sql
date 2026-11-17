-- Attempt log and limits for the DM screen passcode (checked by /api/dm-gate on the server).
-- The passcode itself is a Cloudflare secret and never stored here. It is an extra screen lock in
-- front of the DM sign-in; real DM access still needs the DM's account, password and second step,
-- and Row Level Security refuses DM data to anyone else.
--
-- begin_dm_gate records the attempt as a failure BEFORE the passcode is compared, under one lock,
-- so a burst of parallel guesses cannot all slip under the limit. finish_dm_gate turns the
-- attempt into a success. 5 failures per address per 15 minutes, 100 failures per hour overall.
--
-- Rollback (local only): drop both functions and `drop table public.dm_gate_attempts`.

create table if not exists public.dm_gate_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  succeeded boolean not null default false,
  attempted_at timestamptz not null default now()
);
create index if not exists dm_gate_attempts_ip_time on public.dm_gate_attempts (ip_hash, attempted_at);
create index if not exists dm_gate_attempts_time on public.dm_gate_attempts (attempted_at);
alter table public.dm_gate_attempts enable row level security;
revoke all on public.dm_gate_attempts from public, anon, authenticated;

create or replace function public.begin_dm_gate(p_ip_hash text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_ip_hash is null or char_length(p_ip_hash) < 16 then
    raise exception 'Bad request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('chronicle.dm_gate', 0));
  delete from public.dm_gate_attempts where attempted_at < now() - interval '7 days';
  if (select count(*) from public.dm_gate_attempts
      where ip_hash = p_ip_hash and not succeeded and attempted_at > now() - interval '15 minutes') >= 5
     or (select count(*) from public.dm_gate_attempts
      where not succeeded and attempted_at > now() - interval '1 hour') >= 100 then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  insert into public.dm_gate_attempts (ip_hash) values (p_ip_hash) returning id into v_id;
  return jsonb_build_object('status', 'ok', 'attempt', v_id);
end;
$$;

create or replace function public.finish_dm_gate(p_attempt bigint)
returns void
language sql security definer set search_path = ''
as $$
  update public.dm_gate_attempts set succeeded = true where id = p_attempt;
$$;

revoke all on function public.begin_dm_gate(text), public.finish_dm_gate(bigint) from public, anon, authenticated;
grant execute on function public.begin_dm_gate(text), public.finish_dm_gate(bigint) to service_role;

notify pgrst, 'reload schema';
