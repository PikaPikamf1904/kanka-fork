-- Fix for the DM's maintenance switch (20261117000700): on the hosted project every call failed with
-- "UPDATE requires a WHERE clause", because Supabase's PostgREST refuses an UPDATE without WHERE
-- (the pg_safeupdate guard), so the switch could never be turned on and the banner never showed.
-- The local test database does not enforce that guard, which is why it passed there.
-- The settings table holds one row (id = true); the statement now says so.
--
-- Rollback: re-run set_maintenance from 20261117000700_maintenance_switch.sql (it will fail on the
-- hosted project for the same reason).

create or replace function public.set_maintenance(p_minutes integer)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_until timestamptz;
begin
  if not private.is_dm() or private.is_oauth_request() then
    raise exception 'Only the DM can switch the maintenance notice' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes < 0 or p_minutes > 480 then
    raise exception 'Choose between 0 (off) and 480 minutes' using errcode = '22023';
  end if;
  v_until := case when p_minutes = 0 then null else now() + make_interval(mins => p_minutes) end;
  update public.campaign_settings set maintenance_until = v_until where id = true;
  return v_until;
end;
$$;

revoke all on function public.set_maintenance(integer) from public, anon;
grant execute on function public.set_maintenance(integer) to authenticated;

notify pgrst, 'reload schema';
