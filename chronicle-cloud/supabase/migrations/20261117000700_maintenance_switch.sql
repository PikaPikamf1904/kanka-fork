-- The DM's own maintenance switch on the website. The visitor notice already shows when the
-- Pages environment says MAINTENANCE_MODE=on or a deploy record exists (functions/api/status.ts);
-- this adds a switch the DM can flip from Wiki settings without touching Cloudflare.
--
-- It always expires: the DM picks how long, at most 8 hours (480 minutes; 0 turns it off), so a
-- forgotten switch cannot leave the notice on. Members learn only whether it is on and until when; nothing else.
--
-- Rollback (local only): drop the trigger campaign_settings_maintenance_guard, the three functions and `alter table public.campaign_settings drop
-- column maintenance_until`.

alter table public.campaign_settings add column if not exists maintenance_until timestamptz;

create or replace function public.maintenance_switch()
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select case when s.maintenance_until > now() then s.maintenance_until end
  from public.campaign_settings s
  where private.is_member()
  limit 1;
$$;

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
  update public.campaign_settings set maintenance_until = v_until;
  return v_until;
end;
$$;

-- The table already grants UPDATE to authenticated (the DM's settings policy), so a direct API write
-- could set any time and skip the 8-hour cap. Only set_maintenance (running as its owner) may change it.
create or replace function private.guard_maintenance_until()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.maintenance_until is distinct from old.maintenance_until
     and current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'Use the maintenance switch' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_maintenance_until() from public;

drop trigger if exists campaign_settings_maintenance_guard on public.campaign_settings;
create trigger campaign_settings_maintenance_guard
  before update of maintenance_until on public.campaign_settings
  for each row execute function private.guard_maintenance_until();

revoke all on function public.maintenance_switch(), public.set_maintenance(integer) from public, anon;
grant execute on function public.maintenance_switch(), public.set_maintenance(integer) to authenticated;

notify pgrst, 'reload schema';
