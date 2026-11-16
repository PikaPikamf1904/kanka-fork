-- Chronicle cloud: proposed changes no longer expire.
--
-- A preview used to expire 20 minutes after it was made, so the DM had to review it quickly. The
-- DM asked to remove that timer. A preview now waits until the DM approves it, however long that
-- takes.
--
-- This stays safe without the timer. Applying still re-checks everything at that moment:
--   - every page the preview touches must still have the version it had when it was previewed,
--     otherwise apply returns CONFLICT and writes nothing;
--   - the digest, the owner, the client and the DM's approval are checked as before;
--   - each preview can be applied once.
-- The expiry check itself is unchanged: a preview whose expires_at has passed is still refused.
-- New previews simply get expires_at = 'infinity'.
--
-- Housekeeping: previews already applied are removed after 30 days. Pending previews are kept.
--
-- Rollback: re-run the private.cs_store_preview definition from 20261111000900_change_sets.sql.

create or replace function private.cs_store_preview(p_change_set jsonb, p_digest text, p_base jsonb, p_result jsonb, p_label text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.change_previews;
begin
  perform private.require_dm();
  delete from public.change_previews where consumed_at < now() - interval '30 days';
  insert into public.change_previews (principal_id, client_id, label, change_set, base_versions, digest, result, expires_at)
  values ((select auth.uid()), private.request_client(), left(coalesce(p_label, ''), 200), p_change_set, p_base, p_digest, p_result,
          'infinity')
  returning * into v_row;
  return jsonb_build_object('preview_id', v_row.id, 'expires_at', v_row.expires_at);
end;
$$;

revoke all on function private.cs_store_preview(jsonb, text, jsonb, jsonb, text) from public;
grant execute on function private.cs_store_preview(jsonb, text, jsonb, jsonb, text) to authenticated, service_role;

-- Previews still waiting for a decision keep waiting.
update public.change_previews set expires_at = 'infinity'
where consumed_at is null and expires_at > now();
