-- Personal player invitations, one identity per player across devices, and per-device revocation.
--
-- * The DM creates an invitation for a named player (Eliza, Sybil, ...). The link carries a random
--   32-byte token after '#', so it never reaches server logs; only its SHA-256 is stored.
-- * The first invitation for a name creates that player's account. Later invitations bound to the
--   same player sign the SAME account in on another device, so journals and notes follow the
--   player, not the phone.
-- * Every device that joins through an invitation is recorded with its Auth session id. Revoking a
--   device makes private.is_member() false for that session at once, in the database, for every
--   table and storage policy that relies on membership.
-- * An invitation can never create or reach a DM: role is fixed to 'player', and binding to a DM
--   member is refused.
-- * Claiming runs only through the server function /api/join (service role), under the same
--   advisory lock and rate limits as access-code enrollment. Access codes keep working.
--
-- Rollback (local only): drop the functions below, `drop table public.member_devices,
-- public.player_invitations`, and restore private.is_member() from 20261109000100_core_schema.sql.
-- No existing row is changed by this migration.

create table if not exists public.player_invitations (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  -- The player this invitation signs in as. Null until a new-player invitation is first used.
  member_user_id uuid references auth.users (id) on delete set null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  role text not null default 'player' check (role = 'player'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);
create index if not exists player_invitations_member on public.player_invitations (member_user_id);
create index if not exists player_invitations_created_by on public.player_invitations (created_by);
create index if not exists player_invitations_used_by on public.player_invitations (used_by);

create table if not exists public.member_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null unique,
  label text not null default 'Unknown browser' check (char_length(label) between 1 and 80),
  invitation_id uuid references public.player_invitations (id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists member_devices_user on public.member_devices (user_id);
create index if not exists member_devices_invitation on public.member_devices (invitation_id);

alter table public.player_invitations enable row level security;
alter table public.member_devices enable row level security;

revoke all on public.player_invitations, public.member_devices from anon, authenticated;
-- The token hash is never selectable, not even by the DM.
grant select (id, display_name, member_user_id, role, created_at, expires_at, used_at, used_by, revoked_at)
  on public.player_invitations to authenticated;
-- invitation_id stays server-side (it names a DM-only row).
grant select (id, user_id, label, created_at, last_seen_at, revoked_at) on public.member_devices to authenticated;

drop policy if exists invitations_dm_read on public.player_invitations;
create policy invitations_dm_read on public.player_invitations for select to authenticated
  using ((select private.is_dm()) and not (select private.is_oauth_request()));

drop policy if exists devices_read on public.member_devices;
create policy devices_read on public.member_devices for select to authenticated
  using (not (select private.is_oauth_request())
         and (((select private.is_dm())) or (user_id = (select auth.uid()) and (select private.is_member()))));

--------------------------------------------------------------------------------
-- Membership now also requires that this session's device has not been revoked.
-- Sessions that never joined through an invitation (the DM, access-code devices, tests) have no
-- device row and are unaffected.
--------------------------------------------------------------------------------
create or replace function private.current_session_id()
returns uuid language sql stable set search_path = ''
as $$
  select case when (select auth.jwt()) ->> 'session_id' ~ '^[0-9a-fA-F-]{36}$'
              then ((select auth.jwt()) ->> 'session_id')::uuid end;
$$;

create or replace function private.is_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.campaign_members m
    where m.user_id = (select auth.uid()) and m.revoked_at is null
  )
  and not exists (
    select 1 from public.member_devices d
    where d.session_id = private.current_session_id() and d.revoked_at is not null
  );
$$;

--------------------------------------------------------------------------------
-- Signed-in device: report status and keep "last seen" fresh (at most every five minutes).
--------------------------------------------------------------------------------
create or replace function public.touch_device()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_revoked timestamptz;
begin
  select d.revoked_at into v_revoked from public.member_devices d
  where d.session_id = private.current_session_id() and d.user_id = (select auth.uid());
  if not found then
    return 'untracked';
  end if;
  if v_revoked is not null then
    return 'revoked';
  end if;
  update public.member_devices set last_seen_at = now()
  where session_id = private.current_session_id() and last_seen_at < now() - interval '5 minutes';
  return 'ok';
end;
$$;

--------------------------------------------------------------------------------
-- DM: create, regenerate and revoke invitations; revoke devices.
--------------------------------------------------------------------------------
create or replace function private.require_dm_website()
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_dm() or private.is_oauth_request() then
    raise exception 'Only the DM can manage player access on the website' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.create_player_invitation(p_display_name text, p_member uuid default null, p_valid_days integer default 7)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  perform private.require_dm_website();
  if p_valid_days is null or p_valid_days not between 1 and 30 then
    raise exception 'An invitation lasts between 1 and 30 days' using errcode = '22023';
  end if;
  if (select count(*) from public.player_invitations where created_at > now() - interval '24 hours') >= 100 then
    raise exception 'Too many invitations today' using errcode = '54000';
  end if;

  if p_member is not null then
    -- A link for another device of an existing, active player. Never a DM.
    select m.display_name into v_name from public.campaign_members m
    where m.user_id = p_member and m.role = 'player' and m.revoked_at is null;
    if not found then
      raise exception 'That player cannot receive an invitation' using errcode = '22023';
    end if;
    update public.player_invitations set revoked_at = now()
    where member_user_id = p_member and used_at is null and revoked_at is null;
  else
    v_name := btrim(coalesce(p_display_name, ''));
    if char_length(v_name) not between 1 and 60 then
      raise exception 'Give the player a name (1 to 60 characters)' using errcode = '22023';
    end if;
    -- A new link for the same not-yet-joined name replaces the old one.
    update public.player_invitations set revoked_at = now()
    where member_user_id is null and lower(display_name) = lower(v_name) and used_at is null and revoked_at is null;
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + make_interval(days => p_valid_days);
  insert into public.player_invitations (display_name, member_user_id, token_hash, created_by, expires_at)
  values (v_name, p_member, encode(extensions.digest(v_token, 'sha256'), 'hex'), (select auth.uid()), v_expires)
  returning id into v_id;
  -- The token is returned once and never stored.
  return jsonb_build_object('id', v_id, 'token', v_token, 'display_name', v_name, 'expires_at', v_expires);
end;
$$;

create or replace function public.regenerate_player_invitation(p_invitation uuid, p_valid_days integer default 7)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_inv public.player_invitations;
begin
  perform private.require_dm_website();
  select * into v_inv from public.player_invitations where id = p_invitation;
  if not found then
    raise exception 'Unknown invitation' using errcode = '22023';
  end if;
  update public.player_invitations set revoked_at = coalesce(revoked_at, now()) where id = p_invitation and used_at is null;
  return public.create_player_invitation(v_inv.display_name, v_inv.member_user_id, p_valid_days);
end;
$$;

create or replace function public.revoke_player_invitation(p_invitation uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_dm_website();
  update public.player_invitations set revoked_at = coalesce(revoked_at, now())
  where id = p_invitation and used_at is null;
end;
$$;

-- The DM can sign out any player device; a player can sign out their own devices.
create or replace function public.revoke_member_device(p_device uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if private.is_oauth_request() then
    raise exception 'Not available to assistants' using errcode = '42501';
  end if;
  if private.is_dm() then
    update public.member_devices set revoked_at = coalesce(revoked_at, now()) where id = p_device;
  elsif private.is_member() then
    update public.member_devices set revoked_at = coalesce(revoked_at, now())
    where id = p_device and user_id = (select auth.uid());
  else
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not found then
    raise exception 'Unknown device' using errcode = '22023';
  end if;
end;
$$;

--------------------------------------------------------------------------------
-- Server only (service role, from /api/join): check, claim, release and finish an invitation.
--------------------------------------------------------------------------------
create or replace function public.begin_player_invitation(p_token_hash text, p_ip_hash text, p_claim boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_inv public.player_invitations;
begin
  if p_ip_hash is null or char_length(p_ip_hash) < 16 then
    raise exception 'Bad request' using errcode = '22023';
  end if;
  -- Same lock and limits as access-code enrollment, so the two paths share one budget.
  perform pg_advisory_xact_lock(hashtextextended('chronicle.begin_enrollment', 0));
  delete from public.enrollment_attempts where attempted_at < now() - interval '7 days';
  if (select count(*) from public.enrollment_attempts
      where ip_hash = p_ip_hash and not succeeded and attempted_at > now() - interval '15 minutes') >= 5
     or (select count(*) from public.enrollment_attempts
      where not succeeded and attempted_at > now() - interval '1 hour') >= 100
     or (select count(*) from public.enrollment_attempts
      where ip_hash = p_ip_hash and succeeded and attempted_at > now() - interval '1 hour') >= 20
     or (select count(*) from public.enrollment_attempts
      where succeeded and attempted_at > now() - interval '24 hours') >= 200 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  select i.* into v_inv from public.player_invitations i
  where p_token_hash ~ '^[0-9a-f]{64}$' and i.token_hash = p_token_hash
    and i.revoked_at is null and i.used_at is null and i.expires_at > now()
    and (i.member_user_id is null or exists (
      select 1 from public.campaign_members m
      where m.user_id = i.member_user_id and m.role = 'player' and m.revoked_at is null))
  for update;
  if not found then
    insert into public.enrollment_attempts (ip_hash, succeeded) values (p_ip_hash, false);
    return jsonb_build_object('status', 'invalid');
  end if;

  if p_claim then
    update public.player_invitations set used_at = now() where id = v_inv.id;
    insert into public.enrollment_attempts (ip_hash, succeeded) values (p_ip_hash, true);
  end if;
  return jsonb_build_object('status', 'ok', 'invitation_id', v_inv.id, 'display_name', v_inv.display_name,
                            'member_user_id', v_inv.member_user_id);
end;
$$;

-- Undo a claim when the server could not finish signing the player in.
create or replace function public.release_player_invitation(p_invitation uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.player_invitations set used_at = null
  where id = p_invitation and used_by is null and revoked_at is null;
$$;

create or replace function public.finish_player_invitation(p_invitation uuid, p_user uuid, p_session uuid, p_label text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_inv public.player_invitations;
begin
  select * into v_inv from public.player_invitations where id = p_invitation for update;
  if not found or v_inv.used_at is null or v_inv.used_by is not null or v_inv.revoked_at is not null then
    return 'invalid';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) or p_session is null then
    raise exception 'Bad request' using errcode = '22023';
  end if;
  if v_inv.member_user_id is null then
    -- First use: this new account becomes the player. It must not already be a member of any kind.
    if exists (select 1 from public.campaign_members where user_id = p_user) then
      return 'invalid';
    end if;
    insert into public.campaign_members (user_id, role, display_name) values (p_user, 'player', v_inv.display_name);
    update public.player_invitations set member_user_id = p_user where id = p_invitation;
  elsif v_inv.member_user_id <> p_user
        or not exists (select 1 from public.campaign_members m
                       where m.user_id = p_user and m.role = 'player' and m.revoked_at is null) then
    return 'invalid';
  end if;
  update public.player_invitations set used_by = p_user where id = p_invitation;
  insert into public.member_devices (user_id, session_id, label, invitation_id)
  values (p_user, p_session, left(coalesce(nullif(btrim(p_label), ''), 'Unknown browser'), 80), p_invitation);
  return 'joined';
end;
$$;

--------------------------------------------------------------------------------
-- Grants
--------------------------------------------------------------------------------
revoke all on function private.current_session_id(), private.require_dm_website() from public, anon;
grant execute on function private.current_session_id(), private.require_dm_website() to authenticated, service_role;
revoke all on function
  public.touch_device(),
  public.create_player_invitation(text, uuid, integer),
  public.regenerate_player_invitation(uuid, integer),
  public.revoke_player_invitation(uuid),
  public.revoke_member_device(uuid)
  from public, anon;
grant execute on function
  public.touch_device(),
  public.create_player_invitation(text, uuid, integer),
  public.regenerate_player_invitation(uuid, integer),
  public.revoke_player_invitation(uuid),
  public.revoke_member_device(uuid)
  to authenticated;
revoke all on function
  public.begin_player_invitation(text, text, boolean),
  public.release_player_invitation(uuid),
  public.finish_player_invitation(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.begin_player_invitation(text, text, boolean),
  public.release_player_invitation(uuid),
  public.finish_player_invitation(uuid, uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
