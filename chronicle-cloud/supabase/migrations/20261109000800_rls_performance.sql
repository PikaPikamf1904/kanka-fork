-- Chronicle cloud: faster row-level security and search. The rules do not change.
--
-- Why: with a few thousand articles a player's list and count queries took about 2 s and a
-- search about 3 s (measured locally, 4,000 articles / 16,000 sections). Two causes:
--   1. Every policy called private.is_dm(), private.is_member() and private.can_read_*() once
--      per row. Wrapped in a scalar sub-select, the role checks run once per statement; the
--      parent-page checks are written inline so the planner can use the primary-key index.
--   2. search_wiki built a highlighted snippet for every matching section before choosing the
--      top results. It now ranks first and builds one snippet per returned article.
--
-- Same rule as before, written out: a player (an active member who is not the DM, or a DM who
-- has not completed two-step sign-in) sees a row only when it is visibility = 'players' (and
-- status = 'published' where the table has a status) AND its parent article / map / category is
-- too. That is what private.player_visible() and private.can_read_*() returned; those functions
-- stay in place for the read functions and the storage policy. Inner look-ups also pass through
-- the parent table's own policy, so the parent check is enforced twice.
-- Write policies are unchanged apart from the same wrapping. Policies changed in migration
-- 20261109000600 (media writes, members_dm_update) are not touched.
--
-- No data changes. Safe to run more than once.
-- Rollback: re-run the "create policy" statements from 20261109000100_core_schema.sql (after
-- "drop policy if exists" for each) and the search_wiki block from 20261109000200_functions.sql
-- as "create or replace". Slower, same visibility.

drop policy if exists settings_read on public.campaign_settings;
create policy settings_read on public.campaign_settings for select to authenticated
  using ((select private.is_member()));

drop policy if exists settings_dm on public.campaign_settings;
create policy settings_dm on public.campaign_settings for update to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

drop policy if exists members_read on public.campaign_members;
create policy members_read on public.campaign_members for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_dm()));

drop policy if exists codes_dm_read on public.access_codes;
create policy codes_dm_read on public.access_codes for select to authenticated
  using ((select private.is_dm()));

drop policy if exists media_read on public.media;
create policy media_read on public.media for select to authenticated
  using ((select private.is_dm()) or ((select private.is_member()) and visibility = 'players'));

drop policy if exists articles_read on public.articles;
create policy articles_read on public.articles for select to authenticated
  using ((select private.is_dm()) or ((select private.is_member()) and visibility = 'players' and status = 'published'));

drop policy if exists articles_dm on public.articles;
create policy articles_dm on public.articles for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

drop policy if exists sections_read on public.article_sections;
create policy sections_read on public.article_sections for select to authenticated
  using ((select private.is_dm()) or ((select private.is_member()) and visibility = 'players' and status = 'published'
    and exists (select 1 from public.articles a where a.id = article_sections.article_id and a.visibility = 'players' and a.status = 'published')));

drop policy if exists sections_dm on public.article_sections;
create policy sections_dm on public.article_sections for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

drop policy if exists infobox_read on public.infobox_fields;
create policy infobox_read on public.infobox_fields for select to authenticated
  using ((select private.is_dm()) or ((select private.is_member()) and visibility = 'players'
    and exists (select 1 from public.articles a where a.id = infobox_fields.article_id and a.visibility = 'players' and a.status = 'published')));

drop policy if exists infobox_dm on public.infobox_fields;
create policy infobox_dm on public.infobox_fields for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

drop policy if exists dm_notes_dm on public.dm_notes;
create policy dm_notes_dm on public.dm_notes for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select to authenticated
  using ((select private.is_dm()) or ((select private.is_member()) and visibility = 'players'));

drop policy if exists categories_dm on public.categories;
create policy categories_dm on public.categories for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

drop policy if exists article_categories_read on public.article_categories;
create policy article_categories_read on public.article_categories for select to authenticated
  using ((select private.is_dm()) or ((select private.is_member()) and exists (select 1 from public.articles a where a.id = article_categories.article_id and a.visibility = 'players' and a.status = 'published')
    and exists (select 1 from public.categories c where c.id = article_categories.category_id and c.visibility = 'players')));

drop policy if exists article_categories_dm on public.article_categories;
create policy article_categories_dm on public.article_categories for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

drop policy if exists article_links_read on public.article_links;
create policy article_links_read on public.article_links for select to authenticated
  using ((select private.is_dm()) or ((select private.is_member()) and exists (
      select 1 from public.article_sections s join public.articles a on a.id = s.article_id
      where s.id = article_links.source_section_id
        and s.visibility = 'players' and s.status = 'published'
        and a.visibility = 'players' and a.status = 'published')));

drop policy if exists redirects_read on public.redirects;
create policy redirects_read on public.redirects for select to authenticated
  using ((select private.is_dm()) or ((select private.is_member()) and visibility = 'players'
    and exists (select 1 from public.articles a where a.id = redirects.article_id and a.visibility = 'players' and a.status = 'published')));

drop policy if exists redirects_dm on public.redirects;
create policy redirects_dm on public.redirects for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

drop policy if exists relations_read on public.relations;
create policy relations_read on public.relations for select to authenticated
  using ((select private.is_dm()) or ((select private.is_member()) and visibility = 'players'
    and exists (select 1 from public.articles a where a.id = relations.source_article_id and a.visibility = 'players' and a.status = 'published')
    and exists (select 1 from public.articles a where a.id = relations.target_article_id and a.visibility = 'players' and a.status = 'published')));

drop policy if exists relations_dm on public.relations;
create policy relations_dm on public.relations for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

drop policy if exists timeline_read on public.timeline_events;
create policy timeline_read on public.timeline_events for select to authenticated
  using ((select private.is_dm()) or ((select private.is_member()) and visibility = 'players' and status = 'published'
    and (article_id is null or exists (select 1 from public.articles a where a.id = timeline_events.article_id and a.visibility = 'players' and a.status = 'published'))));

drop policy if exists timeline_dm on public.timeline_events;
create policy timeline_dm on public.timeline_events for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

drop policy if exists maps_read on public.maps;
create policy maps_read on public.maps for select to authenticated
  using ((select private.is_dm()) or ((select private.is_member()) and visibility = 'players' and status = 'published'));

drop policy if exists maps_dm on public.maps;
create policy maps_dm on public.maps for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

drop policy if exists markers_read on public.map_markers;
create policy markers_read on public.map_markers for select to authenticated
  using ((select private.is_dm()) or ((select private.is_member()) and visibility = 'players'
    and exists (select 1 from public.maps m where m.id = map_markers.map_id and m.visibility = 'players' and m.status = 'published')
    and (article_id is null or exists (select 1 from public.articles a where a.id = map_markers.article_id and a.visibility = 'players' and a.status = 'published'))));

drop policy if exists markers_dm on public.map_markers;
create policy markers_dm on public.map_markers for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

drop policy if exists revisions_dm on public.revisions;
create policy revisions_dm on public.revisions for all to authenticated
  using ((select private.is_dm())) with check ((select private.is_dm()));

-------------------------------------------------------------------------------
-- Search: rank first, then one snippet (from the best-ranked visible section) per result.
-------------------------------------------------------------------------------
create or replace function public.search_wiki(q text, max_results integer default 20)
returns table (
  article_id uuid, slug text, title text, type public.article_type, summary text,
  snippet text, rank real
)
language sql stable security invoker set search_path = ''
as $$
  with query as (
    select websearch_to_tsquery('english', left(coalesce(q, ''), 200)) as tsq
  ),
  hits as (
    select a.id, ts_rank(a.search_tsv, query.tsq) * 2 as rank, null::uuid as section_id
    from public.articles a, query
    where a.search_tsv @@ query.tsq
    union all
    select s.article_id, ts_rank(s.search_tsv, query.tsq), s.id
    from public.article_sections s, query
    where s.search_tsv @@ query.tsq
  ),
  ranked as (
    select h.id, sum(h.rank) as rank,
      (array_agg(h.section_id order by h.rank desc, h.section_id) filter (where h.section_id is not null))[1] as best_section
    from hits h
    group by h.id
  ),
  top as (
    select a.id, a.slug, a.title, a.type, a.summary, r.rank, r.best_section
    from ranked r
    join public.articles a on a.id = r.id
    order by r.rank desc, a.title
    limit least(greatest(coalesce(max_results, 20), 1), 50)
  )
  select t.id, t.slug, t.title, t.type, t.summary,
    (select ts_headline('english', s.body, query.tsq,
        'StartSel=⟦, StopSel=⟧, MaxWords=28, MinWords=10, MaxFragments=1')
     from public.article_sections s, query where s.id = t.best_section),
    t.rank::real
  from top t
  order by t.rank desc, t.title;
$$;

revoke all on function public.search_wiki(text, integer) from public, anon, authenticated;
grant execute on function public.search_wiki(text, integer) to authenticated;
