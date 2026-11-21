-- One address rule everywhere. The lore importer dropped apostrophes when it made a page address
-- ("Jenna’s Silver Pendant" -> jennas-silver-pendant), but the database and the website turned them
-- into a dash (jenna-s-silver-pendant), so a link written with the page's title, [[Jenna’s Silver
-- Pendant]], pointed at an address no page has: missing from backlinks, the graph and the page.
-- All five imported pages with an apostrophe use the importer's form, so that form becomes the rule.
--
-- Only links that contain an apostrophe change; they are recomputed below with the same query the
-- section trigger uses. No page, section or address is changed.
--
-- Rollback: re-create private.slugify from 20261109000100_core_schema.sql and re-run the recompute.

create or replace function private.slugify(p text)
returns text language sql immutable set search_path = ''
as $$
  select trim(both '-' from regexp_replace(regexp_replace(lower(coalesce(p, '')), '[''’]', '', 'g'), '[^a-z0-9]+', '-', 'g'))
$$;

-- Links already stored for sections whose wiki links contain an apostrophe: deleted, then rebuilt
-- (two statements, so the rebuild sees the deletion).
delete from public.article_links l
using public.article_sections s
where l.source_section_id = s.id
  and s.body ~ '\[\[[^\]|]*[''’][^\]|]*(\|[^\]]*)?\]\]';

insert into public.article_links (source_section_id, target_slug)
select distinct s.id, private.slugify(m[1])
from public.article_sections s, regexp_matches(s.body, '\[\[([^\]|]+)(?:\|[^\]]*)?\]\]', 'g') as m
where s.body ~ '\[\[[^\]|]*[''’][^\]|]*(\|[^\]]*)?\]\]'
  and private.slugify(m[1]) <> ''
on conflict do nothing;

notify pgrst, 'reload schema';
