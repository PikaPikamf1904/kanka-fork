-- Hardening after the independent review of 20261113000200..0500. Requires 20261113000500.
-- Forward-only; not authorized for production until the owner approves the migration bundle.
--
-- 1. Source records (provenance). Reproduced: an assistant (OAuth) connection could insert, change
--    or delete rows in public.provenance directly through the Data API, forging or erasing the
--    record of where a fact came from (for example marking its own text "dm_confirmed"). The
--    table was missing from the statement guard of 20261113000200. It is now guarded like every
--    other campaign table: assistants write provenance only while an approved change set applies.
--
-- 2. Review binding for the Goblin Gazette. Reproduced: with a story open in two tabs, the DM
--    could approve or print from a stale tab after the text had been saved again elsewhere,
--    approving text they had not seen. public.news_transition(uuid, text, text, timestamptz)
--    takes the page version (and, for a printed story, the waiting revision's timestamp) the DM
--    was looking at, and refuses with CONFLICT when either has changed. The website passes both.
--    The older two-argument function is unchanged, so an older website build keeps working.
--
-- Forward recovery: drop trigger oauth_content_guard on public.provenance and drop the
-- four-argument public.news_transition in a new reviewed migration.

drop trigger if exists oauth_content_guard on public.provenance;
create trigger oauth_content_guard before insert or update or delete on public.provenance
  for each statement execute function private.guard_oauth_content();

create or replace function public.news_transition(p_article uuid, p_action text, p_expected_version text, p_expected_revision timestamptz)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_art public.articles;
  v_pending public.news_pending;
begin
  perform private.require_dm();
  if private.request_client() <> 'web' then
    perform private.fail('FORBIDDEN', 'Only the DM, on the Chronicle website, can review or publish Gazette stories.');
  end if;
  -- Same lock order as the two-argument function: page, then waiting revision.
  select * into v_art from public.articles where id = p_article and type::text = 'news' for update;
  if not found then
    perform private.fail('NOT_FOUND', 'No such Gazette story.');
  end if;
  if p_expected_version is not null and p_expected_version <> 'v' || v_art.version then
    perform private.fail('CONFLICT', 'This story was changed somewhere else since you opened it. Reload it and review the current text.',
      jsonb_build_object('slug', v_art.slug, 'expected', p_expected_version, 'current', 'v' || v_art.version));
  end if;
  select * into v_pending from public.news_pending where article_id = p_article for update;
  if p_expected_revision is not null and (not found or v_pending.updated_at <> p_expected_revision) then
    perform private.fail('CONFLICT', 'The waiting revision was changed somewhere else since you opened it. Reload it and review the current text.',
      jsonb_build_object('slug', v_art.slug));
  end if;
  return public.news_transition(p_article, p_action);
end;
$$;
revoke all on function public.news_transition(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.news_transition(uuid, text, text, timestamptz) to authenticated;
notify pgrst, 'reload schema';
