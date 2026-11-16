-- Chronicle cloud: atomic article save for the website editor, and the identity check the MCP
-- server makes on every request.
--
--   save_article(draft, expected_version, note)
--       The editor's whole save (article, sections, infobox fields, categories) in ONE
--       transaction, with a snapshot first and a version check: if someone else saved since this
--       editor loaded the page, nothing is written and CONFLICT is returned. Website only: a
--       request carrying an OAuth client id is refused, because this path can publish.
--   mcp_whoami()
--       Who the caller is according to the database: role, whether DM rights are in force, whether
--       two-step sign-in is satisfied, and the client id from the token. Never returns secrets.
--
-- Rollback:
--   drop function if exists public.save_article(jsonb, text, text);
--   drop function if exists public.mcp_whoami();

create or replace function public.save_article(p_draft jsonb, p_expected_version text default null, p_note text default 'Before save')
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_a jsonb := p_draft -> 'article';
  v_id uuid := nullif(v_a ->> 'id', '')::uuid;
  v_cur public.articles;
  v_s jsonb;
  v_f jsonb;
  v_keep uuid[] := '{}';
  v_pos integer := 0;
  v_row public.articles;
begin
  perform private.require_dm();
  if private.request_client() <> 'web' then
    perform private.fail('FORBIDDEN', 'Articles can only be saved this way from the Chronicle website.');
  end if;
  if jsonb_typeof(v_a) <> 'object' or jsonb_typeof(coalesce(p_draft -> 'sections', '[]')) <> 'array'
     or jsonb_typeof(coalesce(p_draft -> 'infobox', '[]')) <> 'array' then
    perform private.fail('VALIDATION_FAILED', 'Malformed draft.');
  end if;
  if char_length(coalesce(trim(v_a ->> 'title'), '')) not between 1 and 200 or coalesce(v_a ->> 'slug', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    perform private.fail('VALIDATION_FAILED', 'A title and a valid address are required.');
  end if;
  if jsonb_array_length(coalesce(p_draft -> 'sections', '[]')) > 30 or jsonb_array_length(coalesce(p_draft -> 'infobox', '[]')) > 50 then
    perform private.fail('VALIDATION_FAILED', 'At most 30 sections and 50 infobox fields.');
  end if;

  if v_id is not null then
    select * into v_cur from public.articles where id = v_id for update;
    if not found then
      perform private.fail('NOT_FOUND', 'This article no longer exists.');
    end if;
    if p_expected_version is not null and p_expected_version <> 'v' || v_cur.version then
      perform private.fail('CONFLICT', 'This article was changed somewhere else since you opened it.',
        jsonb_build_object('slug', v_cur.slug, 'expected', p_expected_version, 'current', 'v' || v_cur.version));
    end if;
    perform public.snapshot_article(v_id, left(coalesce(p_note, 'Before save'), 200));
    update public.articles set
      slug = v_a ->> 'slug', type = (v_a ->> 'type')::public.article_type, title = trim(v_a ->> 'title'),
      subtitle = coalesce(v_a ->> 'subtitle', ''), summary = coalesce(v_a ->> 'summary', ''),
      hero_media_id = nullif(v_a ->> 'hero_media_id', '')::uuid,
      visibility = (v_a ->> 'visibility')::public.content_visibility, status = (v_a ->> 'status')::public.publish_status,
      is_featured = coalesce((v_a ->> 'is_featured')::boolean, false),
      is_party_member = coalesce((v_a ->> 'is_party_member')::boolean, false),
      importance = coalesce((v_a ->> 'importance')::smallint, 0),
      session_date = nullif(v_a ->> 'session_date', '')::date
    where id = v_id;
  else
    if exists (select 1 from public.articles where slug = v_a ->> 'slug') then
      perform private.fail('ALREADY_EXISTS', 'Another page already uses this address.', jsonb_build_object('slug', v_a ->> 'slug'));
    end if;
    insert into public.articles (slug, type, title, subtitle, summary, hero_media_id, visibility, status, is_featured, is_party_member, importance, session_date)
    values (v_a ->> 'slug', (v_a ->> 'type')::public.article_type, trim(v_a ->> 'title'), coalesce(v_a ->> 'subtitle', ''),
            coalesce(v_a ->> 'summary', ''), nullif(v_a ->> 'hero_media_id', '')::uuid,
            coalesce(v_a ->> 'visibility', 'dm')::public.content_visibility, coalesce(v_a ->> 'status', 'draft')::public.publish_status,
            coalesce((v_a ->> 'is_featured')::boolean, false), coalesce((v_a ->> 'is_party_member')::boolean, false),
            coalesce((v_a ->> 'importance')::smallint, 0), nullif(v_a ->> 'session_date', '')::date)
    returning id into v_id;
  end if;

  -- Sections: unchanged ones keep their ids; removed ones go; order follows the draft.
  for v_s in select value from jsonb_array_elements(coalesce(p_draft -> 'sections', '[]')) loop
    if v_s ->> 'id' is not null then v_keep := v_keep || (v_s ->> 'id')::uuid; end if;
  end loop;
  delete from public.article_sections where article_id = v_id and not (id = any (v_keep));
  for v_s in select value from jsonb_array_elements(coalesce(p_draft -> 'sections', '[]')) loop
    v_pos := v_pos + 1;
    if v_s ->> 'id' is not null then
      update public.article_sections set position = v_pos, heading = coalesce(v_s ->> 'heading', ''), body = coalesce(v_s ->> 'body', ''),
        visibility = (v_s ->> 'visibility')::public.content_visibility, status = (v_s ->> 'status')::public.publish_status
      where id = (v_s ->> 'id')::uuid and article_id = v_id;
      if not found then
        perform private.fail('CONFLICT', 'A section was removed somewhere else since you opened this article.');
      end if;
    else
      insert into public.article_sections (article_id, position, heading, body, visibility, status)
      values (v_id, v_pos, coalesce(v_s ->> 'heading', ''), coalesce(v_s ->> 'body', ''),
              coalesce(v_s ->> 'visibility', 'dm')::public.content_visibility, coalesce(v_s ->> 'status', 'draft')::public.publish_status);
    end if;
  end loop;

  v_keep := '{}';
  v_pos := 0;
  for v_f in select value from jsonb_array_elements(coalesce(p_draft -> 'infobox', '[]')) loop
    if v_f ->> 'id' is not null then v_keep := v_keep || (v_f ->> 'id')::uuid; end if;
  end loop;
  delete from public.infobox_fields where article_id = v_id and not (id = any (v_keep));
  for v_f in select value from jsonb_array_elements(coalesce(p_draft -> 'infobox', '[]')) loop
    v_pos := v_pos + 1;
    if v_f ->> 'id' is not null then
      update public.infobox_fields set position = v_pos, label = v_f ->> 'label', value = coalesce(v_f ->> 'value', ''),
        visibility = (v_f ->> 'visibility')::public.content_visibility
      where id = (v_f ->> 'id')::uuid and article_id = v_id;
      if not found then
        perform private.fail('CONFLICT', 'An infobox field was removed somewhere else since you opened this article.');
      end if;
    else
      insert into public.infobox_fields (article_id, position, label, value, visibility)
      values (v_id, v_pos, v_f ->> 'label', coalesce(v_f ->> 'value', ''), coalesce(v_f ->> 'visibility', 'dm')::public.content_visibility);
    end if;
  end loop;

  if p_draft ? 'categoryIds' then
    delete from public.article_categories where article_id = v_id
      and not (category_id in (select (x #>> '{}')::uuid from jsonb_array_elements(p_draft -> 'categoryIds') x));
    insert into public.article_categories (article_id, category_id)
    select v_id, (x #>> '{}')::uuid from jsonb_array_elements(p_draft -> 'categoryIds') x
    on conflict do nothing;
  end if;

  select * into v_row from public.articles where id = v_id;
  return (to_jsonb(v_row) - 'search_tsv') || jsonb_build_object('version', 'v' || v_row.version);
end;
$$;

create or replace function public.mcp_whoami()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'principal_id', (select auth.uid()),
    'role', (select m.role from public.campaign_members m where m.user_id = (select auth.uid()) and m.revoked_at is null),
    'is_dm', private.is_dm(),
    'is_member', private.is_member(),
    'mfa_satisfied', coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified'),
    'client_id', private.request_client());
$$;

revoke all on function public.save_article(jsonb, text, text), public.mcp_whoami() from public, anon, authenticated;
grant execute on function public.save_article(jsonb, text, text), public.mcp_whoami() to authenticated;
