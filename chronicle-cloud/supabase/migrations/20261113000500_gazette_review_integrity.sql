-- CH-103: approval covers exactly the text that gets printed. Requires 20261113000400.
-- Forward-only; not authorized for production until the owner approves the migration bundle.
--
-- Reproduced before this migration: approve a story, change its section text directly (or with
-- the general article editor), then print it; the unreviewed text reached players while the story
-- still said "approved". Printed stories were already protected (edits wait as revisions); stories
-- approved but not yet printed were not.
--
-- Now any change to a Gazette story's headline, deck, opening, picture, address or sections, by
-- any route other than applying an approved revision, sends an approved story back to "in review".
-- Printing requires "approved" (20261112001300), so the changed text cannot be printed until the
-- DM approves it again. Drafts and stories in review are unaffected. Type changes into or out of
-- news are refused by 20261112052438; the newspaper details table has no write grants.
--
-- Forward recovery: drop the news_review_reset triggers in a new reviewed migration.

create or replace function private.news_content_changed()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_article uuid;
begin
  -- Applying a revision the DM approved is the one route that may change approved text.
  if coalesce(current_setting('chronicle.news_apply', true), '') = 'on' then
    return null;
  end if;
  if tg_table_name = 'articles' then
    if new.type <> 'news' or (new.title, new.subtitle, new.summary, new.hero_media_id, new.slug)
       is not distinct from (old.title, old.subtitle, old.summary, old.hero_media_id, old.slug) then
      return null;
    end if;
    v_article := new.id;
  else
    v_article := coalesce(new.article_id, old.article_id);
    if tg_op = 'UPDATE' and (new.heading, new.body, new.visibility, new.status, new.position, new.article_id)
       is not distinct from (old.heading, old.body, old.visibility, old.status, old.position, old.article_id) then
      return null;
    end if;
  end if;
  update public.news_stories n
  set review_state = 'in_review', reviewed_at = null, updated_at = now()
  from public.articles a
  where n.article_id = v_article and a.id = n.article_id and a.type = 'news' and n.review_state = 'approved';
  return null;
end;
$$;
revoke all on function private.news_content_changed() from public, anon;
grant execute on function private.news_content_changed() to authenticated, service_role;

drop trigger if exists news_review_reset on public.articles;
create trigger news_review_reset after update of title, subtitle, summary, hero_media_id, slug on public.articles
  for each row execute function private.news_content_changed();
drop trigger if exists news_review_reset on public.article_sections;
create trigger news_review_reset after insert or update or delete on public.article_sections
  for each row execute function private.news_content_changed();
