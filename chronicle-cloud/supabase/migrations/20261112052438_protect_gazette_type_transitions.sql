-- CH-103 (partial): changing a news article into another type, or turning an existing
-- article into news, bypasses Gazette safeguards. Gazette APIs create news articles but do
-- not convert types, so reject both transitions at the database boundary. Other Gazette
-- editing bypasses remain open. Requires migrations through 20261112052309.
-- Forward recovery: drop this trigger and function in a new reviewed migration.
create function private.guard_news_type_transition()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.type is distinct from new.type and (old.type::text = 'news' or new.type::text = 'news') then
    perform private.fail('FORBIDDEN', 'Gazette stories cannot be converted to or from another article type.');
  end if;
  return new;
end;
$$;
revoke all on function private.guard_news_type_transition() from public, anon, authenticated;
create trigger articles_news_type_transition_guard
  before update of type on public.articles
  for each row execute function private.guard_news_type_transition();
