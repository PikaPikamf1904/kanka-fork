-- CH-101 (partial): OAuth clients cannot mutate access codes or campaign membership,
-- including through SECURITY DEFINER RPCs. This does not restrict campaign content writes.
-- Requires migrations through 20261112001400. Forward recovery: drop these two triggers
-- and the function in a new migration if this guard must be disabled after review.
-- The request JWT is set by the API gateway, not by an application-provided context flag.
create function private.guard_oauth_access_management()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if nullif((select auth.jwt()) ->> 'client_id', '') is not null
     or nullif((select auth.jwt()) ->> 'chronicle_client', '') is not null then
    raise exception 'Access management requires a Chronicle website session' using errcode = '42501';
  end if;
  return null;
end;
$$;
revoke all on function private.guard_oauth_access_management() from public, anon, authenticated;

-- Statement triggers also reject RPC calls that happen not to match a row. They run inside
-- privileged functions too, so SECURITY DEFINER cannot silently bypass this boundary.
create trigger oauth_access_codes_guard
  before insert or update or delete on public.access_codes
  for each statement execute function private.guard_oauth_access_management();
create trigger oauth_campaign_members_guard
  before insert or update or delete on public.campaign_members
  for each statement execute function private.guard_oauth_access_management();
