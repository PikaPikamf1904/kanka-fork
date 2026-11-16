-- Search suggestions match the start of any word in a title, not only the start of the title.
-- Requires 20261114000100. Forward-only; not authorized for production until the owner approves
-- the migration bundle.
--
-- Before: typing "merrin" suggested nothing for "Captain Merrin Vael"; only "cap..." did. At the
-- table the DM usually remembers a name, not the title's first word. Titles that START with the
-- typed text still come first. The typed text is matched literally (%, _ and \ are escaped).
-- Still SECURITY INVOKER: Row Level Security decides which titles a reader can be offered, exactly
-- as before.
--
-- Forward recovery: restore public.suggest_articles from 20261109000200 in a new reviewed migration.

create or replace function public.suggest_articles(prefix text, max_results integer default 8)
returns table (slug text, title text, type public.article_type)
language sql stable set search_path = ''
as $$
  with typed as (
    select lower(trim(coalesce(prefix, ''))) as p,
           replace(replace(replace(lower(trim(coalesce(prefix, ''))), '\', '\\'), '%', '\%'), '_', '\_') as pat
  )
  select a.slug, a.title, a.type
  from public.articles a, typed
  where char_length(typed.p) >= 1
    and (starts_with(lower(a.title), typed.p)
         or lower(a.title) like '% ' || typed.pat || '%' escape '\')
  order by starts_with(lower(a.title), typed.p) desc, a.importance desc, a.title
  limit least(greatest(coalesce(max_results, 8), 1), 20);
$$;
revoke all on function public.suggest_articles(text, integer) from public, anon;
grant execute on function public.suggest_articles(text, integer) to authenticated;
notify pgrst, 'reload schema';
