-- Where a page is named in text the reader can already read.
--
-- `backlinks()` only finds pages that link with [[...]]. Real session write-ups rarely do: they say
-- "Bob chose the brass egg" or "Mara reviewed the papers". `mentions()` finds those plain-text
-- mentions so a character, place or NPC page can show the sessions and stories it appears in,
-- without the DM adding links.
--
-- Security: SECURITY INVOKER, like backlinks(). Every table (articles, article_sections, redirects)
-- is read through the caller's own row-level security, so a player only ever matches against
-- published sections of published pages they may read, and only through aliases (redirects) they
-- may read. Nothing is stored. The function returns only the matching pages' slug, title and type —
-- the same columns the caller can already select from public.articles.
--
-- What counts as a mention (case-sensitive, whole words):
--   * the page title, and the title without a leading "The " / "A " / "An ";
--   * for characters, each part of the name with four or more letters that is not an honorific or a
--     common word ("Mara Venn" -> "Mara", "Venn"; "Mayor Raven" -> "Raven"; "Swift Claw" -> none);
--   * every redirect (alias) of the page that the caller can read, written as words
--     ("fargab" -> "Fargab").
--
-- Rollback:
--   drop function if exists public.named_in(uuid);
--   drop function if exists public.mentions(uuid);
--   drop function if exists private.mention_pattern(uuid);

create or replace function private.mention_pattern(p_article uuid)
returns text
language sql stable security invoker set search_path = ''
as $$
  with target as (
    select a.id, a.title, a.type from public.articles a where a.id = p_article
  ),
  terms as (
    select t.title as term from target t
    union
    select regexp_replace(t.title, '^(The|A|An)\s+', '') from target t
    union
    select w from target t, regexp_split_to_table(t.title, '\s+') as w
    where t.type = 'character'
      and char_length(w) >= 4
      and w ~ '^[A-Z]'
      and w not in ('Captain', 'Mayor', 'Lord', 'Lady', 'Sir', 'Dame', 'Commander', 'General', 'Professor',
                    'Madame', 'Master', 'Mistress', 'King', 'Queen', 'Prince', 'Princess', 'Doctor', 'Brother',
                    'Sister', 'Father', 'Mother', 'Elder', 'Swift', 'Claw', 'Iron', 'Stone', 'Black', 'White',
                    'Silver', 'Gold', 'Golden', 'Green', 'Brown', 'Grey', 'Gray', 'Long', 'Little', 'Great',
                    'High', 'Hill', 'Young', 'Elder', 'Dragon', 'Shadow', 'Moon', 'Star', 'Storm')
    union
    select initcap(replace(r.from_slug, '-', ' '))
    from public.redirects r join target t on r.article_id = t.id
  ),
  usable as (
    select distinct term from terms where char_length(btrim(term)) >= 3
  )
  select case when count(*) = 0 then null else
    -- \m and \M are word boundaries; every term is escaped so it is matched literally.
    '\m(' || string_agg(regexp_replace(btrim(term), '([.\\+*?^$(){}|\[\]-])', '\\\1', 'g'), '|' order by char_length(term) desc) || ')\M'
  end
  from usable;
$$;

create or replace function public.mentions(p_article uuid)
returns table (slug text, title text, type public.article_type)
language sql stable security invoker set search_path = ''
as $$
  with pat as (select private.mention_pattern(p_article) as re)
  select distinct a.slug, a.title, a.type
  from pat
  join public.articles a on a.id <> p_article
  where pat.re is not null
    and (
      coalesce(a.summary, '') ~ pat.re
      or exists (
        select 1 from public.article_sections s
        where s.article_id = a.id and coalesce(s.body, '') ~ pat.re
      )
    )
  order by a.title;
$$;

revoke all on function private.mention_pattern(uuid) from public, anon;
revoke all on function public.mentions(uuid) from public, anon;
grant execute on function private.mention_pattern(uuid) to authenticated, service_role;
grant execute on function public.mentions(uuid) to authenticated, service_role;

-- The other direction: the pages this page's own text names ("At the table" on a session journal,
-- "In the Chronicle" on a Gazette story). Same rules: the caller's row-level security decides which
-- of this page's sections are read and which pages may be returned.
create or replace function public.named_in(p_article uuid)
returns table (slug text, title text, type public.article_type)
language sql stable security invoker set search_path = ''
as $$
  with doc as (
    select coalesce(a.summary, '') || E'\n' || coalesce(string_agg(s.body, E'\n'), '') as txt
    from public.articles a
    left join public.article_sections s on s.article_id = a.id
    where a.id = p_article
    group by a.id, a.summary
  ),
  candidates as (
    select a.id, a.slug, a.title, a.type, private.mention_pattern(a.id) as re
    from public.articles a
    where a.id <> p_article and a.type <> 'news'
  )
  select c.slug, c.title, c.type
  from candidates c, doc
  where c.re is not null and doc.txt ~ c.re
  order by c.title;
$$;

revoke all on function public.named_in(uuid) from public, anon;
grant execute on function public.named_in(uuid) to authenticated, service_role;
