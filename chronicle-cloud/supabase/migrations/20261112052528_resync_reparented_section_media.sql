-- CH-104 (partial): changing a section's parent changes whether its inline images are
-- player-visible. Reuse migration 14's existing old/new body synchronization on reparenting.
-- Requires migrations through 20261112052438. Existing visibility state is reconciled below.
-- Forward recovery: restore the previous trigger definition in a new reviewed migration.
-- This does not protect private media metadata or establish real Storage-service behavior.
drop trigger if exists sections_inline_media_sync on public.article_sections;
create trigger sections_inline_media_sync
  after insert or delete or update of article_id, body, visibility, status on public.article_sections
  for each row execute function private.inline_media_changed();

-- Repair stale visibility locally or during an explicitly approved future deployment.
select private.sync_media_visibility(id) from public.media;
