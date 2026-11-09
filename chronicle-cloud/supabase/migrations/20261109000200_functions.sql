-- Chronicle cloud: API functions.
--
-- Read functions are SECURITY INVOKER, so the caller's RLS applies and they can never return
-- more than the caller could select directly. The few SECURITY DEFINER functions check the
-- caller's role first and pin search_path.

-------------------------------------------------------------------------------
-- Search (PostgreSQL full-text; no paid search service)
-------------------------------------------------------------------------------
create function public.search_wiki(q text, max_results integer default 20)
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
    select a.id, ts_rank(a.search_tsv, query.tsq) * 2 as rank, null::text as snippet
    from public.articles a, query
    where a.search_tsv @@ query.tsq
    union all
    select s.article_id, ts_rank(s.search_tsv, query.tsq),
      ts_headline('english', s.body, query.tsq,
        'StartSel=⟦, StopSel=⟧, MaxWords=28, MinWords=10, MaxFragments=1')
    from public.article_sections s, query
    where s.search_tsv @@ query.tsq
  )
  select a.id, a.slug, a.title, a.type, a.summary,
    (array_agg(h.snippet) filter (where h.snippet is not null))[1],
    sum(h.rank)::real
  from hits h
  join public.articles a on a.id = h.id
  group by a.id
  order by sum(h.rank) desc, a.title
  limit least(greatest(coalesce(max_results, 20), 1), 50);
$$;

-- Title suggestions for the search box. starts_with, not LIKE, so % and _ are literal.
create function public.suggest_articles(prefix text, max_results integer default 8)
returns table (slug text, title text, type public.article_type)
language sql stable security invoker set search_path = ''
as $$
  select a.slug, a.title, a.type
  from public.articles a
  where char_length(trim(coalesce(prefix, ''))) >= 1
    and starts_with(lower(a.title), lower(trim(prefix)))
  order by a.importance desc, a.title
  limit least(greatest(coalesce(max_results, 8), 1), 20);
$$;

-- Category list with counts computed under the caller's RLS.
create function public.category_counts()
returns table (id uuid, slug text, name text, kind text, description text, article_count bigint)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.slug, c.name, c.kind, c.description, count(a.id)
  from public.categories c
  left join public.article_categories ac on ac.category_id = c.id
  left join public.articles a on a.id = ac.article_id
  group by c.id
  order by c.kind, c.name;
$$;

-- Backlinks: published sections (visible to the caller) that link to this article's slug or
-- to one of its redirects.
create function public.backlinks(p_article uuid)
returns table (slug text, title text, type public.article_type)
language sql stable security invoker set search_path = ''
as $$
  select distinct a.slug, a.title, a.type
  from public.articles target
  join public.article_links l
    on l.target_slug = target.slug
    or l.target_slug in (select r.from_slug from public.redirects r where r.article_id = target.id)
  join public.article_sections s on s.id = l.source_section_id
  join public.articles a on a.id = s.article_id
  where target.id = p_article and a.id <> p_article
  order by a.title;
$$;

-- Resolve a slug, following a redirect the caller can see.
create function public.resolve_slug(p_slug text)
returns table (slug text, redirected_from text)
language sql stable security invoker set search_path = ''
as $$
  select a.slug, null::text from public.articles a where a.slug = p_slug
  union all
  select a.slug, r.from_slug
  from public.redirects r join public.articles a on a.id = r.article_id
  where r.from_slug = p_slug and not exists (select 1 from public.articles x where x.slug = p_slug)
  limit 1;
$$;

-------------------------------------------------------------------------------
-- DM: preview an article exactly as a player would receive it. Uses the same visibility rule
-- (private.player_visible) and the same parent checks as the RLS policies.
-------------------------------------------------------------------------------
create function public.preview_article_as_player(p_slug text)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_article public.articles;
begin
  if not private.is_dm() then
    raise exception 'Only the DM can preview as a player' using errcode = '42501';
  end if;

  select * into v_article from public.articles a where a.slug = p_slug;
  if not found or not private.player_visible(v_article.visibility, v_article.status) then
    return jsonb_build_object('visible', false);
  end if;

  return jsonb_build_object(
    'visible', true,
    'article', jsonb_build_object(
      'id', v_article.id, 'slug', v_article.slug, 'type', v_article.type,
      'title', v_article.title, 'subtitle', v_article.subtitle, 'summary', v_article.summary,
      'hero_media_id', v_article.hero_media_id, 'updated_at', v_article.updated_at
    ),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'heading', s.heading, 'body', s.body) order by s.position, s.id)
      from public.article_sections s
      where s.article_id = v_article.id and private.player_visible(s.visibility, s.status)
    ), '[]'::jsonb),
    'infobox', coalesce((
      select jsonb_agg(jsonb_build_object('label', f.label, 'value', f.value) order by f.position, f.id)
      from public.infobox_fields f
      where f.article_id = v_article.id and f.visibility = 'players'
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('slug', c.slug, 'name', c.name, 'kind', c.kind) order by c.name)
      from public.article_categories ac join public.categories c on c.id = ac.category_id
      where ac.article_id = v_article.id and c.visibility = 'players'
    ), '[]'::jsonb),
    'relations', coalesce((
      select jsonb_agg(jsonb_build_object('kind', r.kind, 'label', r.label, 'slug', o.slug, 'title', o.title) order by o.title)
      from public.relations r
      join public.articles o on o.id = case when r.source_article_id = v_article.id then r.target_article_id else r.source_article_id end
      where (r.source_article_id = v_article.id or r.target_article_id = v_article.id)
        and r.visibility = 'players' and private.player_visible(o.visibility, o.status)
    ), '[]'::jsonb)
  );
end;
$$;

-------------------------------------------------------------------------------
-- DM: revisions
-------------------------------------------------------------------------------
create function public.snapshot_article(p_article uuid, p_note text default '')
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_dm() then
    raise exception 'Only the DM can save revisions' using errcode = '42501';
  end if;
  insert into public.revisions (article_id, snapshot, note, created_by)
  select a.id,
    jsonb_build_object(
      'article', to_jsonb(a) - 'search_tsv',
      'sections', coalesce((select jsonb_agg(to_jsonb(s) - 'search_tsv' order by s.position, s.id)
        from public.article_sections s where s.article_id = a.id), '[]'::jsonb),
      'infobox', coalesce((select jsonb_agg(to_jsonb(f) order by f.position, f.id)
        from public.infobox_fields f where f.article_id = a.id), '[]'::jsonb)
    ),
    left(coalesce(p_note, ''), 200), (select auth.uid())
  from public.articles a where a.id = p_article
  returning id into v_id;
  if v_id is null then
    raise exception 'Article not found' using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;

-- Restore an earlier revision. The current state is snapshotted first, so a restore can be undone.
create function public.restore_revision(p_revision uuid)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_rev public.revisions;
  v_a jsonb;
begin
  if not private.is_dm() then
    raise exception 'Only the DM can restore revisions' using errcode = '42501';
  end if;
  select * into v_rev from public.revisions where id = p_revision;
  if not found then
    raise exception 'Revision not found' using errcode = 'P0002';
  end if;
  perform public.snapshot_article(v_rev.article_id, 'Before restoring revision ' || p_revision);

  v_a := v_rev.snapshot -> 'article';
  update public.articles set
    title = v_a ->> 'title', subtitle = v_a ->> 'subtitle', summary = v_a ->> 'summary',
    type = (v_a ->> 'type')::public.article_type,
    visibility = (v_a ->> 'visibility')::public.content_visibility,
    status = (v_a ->> 'status')::public.publish_status,
    hero_media_id = nullif(v_a ->> 'hero_media_id', '')::uuid,
    is_featured = coalesce((v_a ->> 'is_featured')::boolean, false),
    is_party_member = coalesce((v_a ->> 'is_party_member')::boolean, false),
    importance = coalesce((v_a ->> 'importance')::smallint, 0),
    session_date = nullif(v_a ->> 'session_date', '')::date
  where id = v_rev.article_id;

  delete from public.article_sections where article_id = v_rev.article_id;
  insert into public.article_sections (id, article_id, position, heading, body, visibility, status)
  select (s ->> 'id')::uuid, v_rev.article_id, (s ->> 'position')::integer, s ->> 'heading', s ->> 'body',
    (s ->> 'visibility')::public.content_visibility, (s ->> 'status')::public.publish_status
  from jsonb_array_elements(v_rev.snapshot -> 'sections') s;

  delete from public.infobox_fields where article_id = v_rev.article_id;
  insert into public.infobox_fields (id, article_id, position, label, value, visibility)
  select (f ->> 'id')::uuid, v_rev.article_id, (f ->> 'position')::integer, f ->> 'label', f ->> 'value',
    (f ->> 'visibility')::public.content_visibility
  from jsonb_array_elements(v_rev.snapshot -> 'infobox') f;

  return v_rev.article_id;
end;
$$;

-------------------------------------------------------------------------------
-- DM: access codes and members (SECURITY DEFINER because access_codes has no write grants)
-------------------------------------------------------------------------------
create function public.create_access_code(
  p_code text, p_label text default 'Player access code',
  p_expires_at timestamptz default null, p_max_uses integer default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_dm() then
    raise exception 'Only the DM can create access codes' using errcode = '42501';
  end if;
  if p_code is null or char_length(p_code) < 10 or char_length(p_code) > 200 then
    raise exception 'Access codes must be 10 to 200 characters' using errcode = '22023';
  end if;
  insert into public.access_codes (label, code_hash, created_by, expires_at, max_uses)
  values (left(coalesce(nullif(trim(p_label), ''), 'Player access code'), 80),
    extensions.crypt(p_code, extensions.gen_salt('bf', 10)), (select auth.uid()), p_expires_at, p_max_uses)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.revoke_access_code(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_dm() then
    raise exception 'Only the DM can revoke access codes' using errcode = '42501';
  end if;
  update public.access_codes set revoked_at = coalesce(revoked_at, now()) where id = p_id;
end;
$$;

-- Rotate: revoke every active code and create a new one in one step.
create function public.rotate_access_code(p_code text, p_label text default 'Player access code')
returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_dm() then
    raise exception 'Only the DM can rotate access codes' using errcode = '42501';
  end if;
  update public.access_codes set revoked_at = now() where revoked_at is null;
  return public.create_access_code(p_code, p_label);
end;
$$;

-- Revoke a player's device/identity. Takes effect on their next request, because every policy
-- re-checks membership. The DM cannot revoke themselves (no lockout).
create function public.revoke_member(p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_dm() then
    raise exception 'Only the DM can revoke members' using errcode = '42501';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'The DM cannot revoke their own access' using errcode = '22023';
  end if;
  update public.campaign_members set revoked_at = coalesce(revoked_at, now())
  where user_id = p_user and role = 'player';
end;
$$;

-- Revoke every player at once (for example after rotating a leaked code).
create function public.revoke_all_players()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.is_dm() then
    raise exception 'Only the DM can revoke members' using errcode = '42501';
  end if;
  update public.campaign_members set revoked_at = now()
  where role = 'player' and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-------------------------------------------------------------------------------
-- Enrollment. Called ONLY by the server (Cloudflare Pages Function) with the secret key. The
-- browser never talks to these functions. Flow:
--   1. begin_enrollment: rate-limit by hashed client IP, check the code, return its id.
--   2. The server creates a fresh Auth user for this device (random, discarded password).
--   3. complete_enrollment: re-check the code and add the user as a player.
-------------------------------------------------------------------------------
create function public.begin_enrollment(p_code text, p_ip_hash text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_code_id uuid;
begin
  if p_ip_hash is null or char_length(p_ip_hash) < 16 then
    raise exception 'Bad enrollment request' using errcode = '22023';
  end if;

  -- Keep the attempts table small.
  delete from public.enrollment_attempts where attempted_at < now() - interval '7 days';

  -- Per-address and global failure limits. Checked before the code, so a limited caller learns
  -- nothing about it.
  if (select count(*) from public.enrollment_attempts
      where ip_hash = p_ip_hash and not succeeded and attempted_at > now() - interval '15 minutes') >= 5
     or (select count(*) from public.enrollment_attempts
      where not succeeded and attempted_at > now() - interval '1 hour') >= 100 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  select c.id into v_code_id
  from public.access_codes c
  where c.revoked_at is null
    and (c.expires_at is null or c.expires_at > now())
    and (c.max_uses is null or c.use_count < c.max_uses)
    and p_code is not null and char_length(p_code) between 1 and 200
    and c.code_hash = extensions.crypt(p_code, c.code_hash)
  limit 1;

  insert into public.enrollment_attempts (ip_hash, succeeded) values (p_ip_hash, v_code_id is not null);
  if v_code_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  return jsonb_build_object('status', 'ok', 'code_id', v_code_id);
end;
$$;

create function public.complete_enrollment(p_user uuid, p_code_id uuid, p_display_name text default 'Adventurer')
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_code public.access_codes;
begin
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'Unknown user' using errcode = '22023';
  end if;
  -- Lock the code row and re-check it: it may have been revoked or used up meanwhile.
  select * into v_code from public.access_codes where id = p_code_id for update;
  if not found or v_code.revoked_at is not null
     or (v_code.expires_at is not null and v_code.expires_at <= now())
     or (v_code.max_uses is not null and v_code.use_count >= v_code.max_uses) then
    return 'invalid';
  end if;
  if exists (select 1 from public.campaign_members where user_id = p_user) then
    return 'already_member';
  end if;
  insert into public.campaign_members (user_id, role, display_name, enrolled_via)
  values (p_user, 'player', left(coalesce(nullif(trim(p_display_name), ''), 'Adventurer'), 60), p_code_id);
  update public.access_codes set use_count = use_count + 1 where id = p_code_id;
  return 'enrolled';
end;
$$;

-- Record that a member was active (for the DM's device list). Only touches the caller's row.
create function public.touch_member()
returns void
language sql security definer set search_path = ''
as $$
  update public.campaign_members set last_seen_at = now()
  where user_id = (select auth.uid()) and revoked_at is null
    and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
$$;

-------------------------------------------------------------------------------
-- Function privileges: nothing for anon; enrollment only for the server.
-------------------------------------------------------------------------------
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.search_wiki(text, integer),
  public.suggest_articles(text, integer),
  public.category_counts(),
  public.backlinks(uuid),
  public.resolve_slug(text),
  public.preview_article_as_player(text),
  public.snapshot_article(uuid, text),
  public.restore_revision(uuid),
  public.create_access_code(text, text, timestamptz, integer),
  public.revoke_access_code(uuid),
  public.rotate_access_code(text, text),
  public.revoke_member(uuid),
  public.revoke_all_players(),
  public.touch_member()
  to authenticated;
grant execute on function
  public.begin_enrollment(text, text),
  public.complete_enrollment(uuid, uuid, text)
  to service_role;
