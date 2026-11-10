-- Chronicle cloud: private media bucket.
--
-- The bucket is not public, so every download goes through Storage's RLS check (or a short-lived
-- signed URL that the caller could only create if that check passed). A file is readable by
-- players only when a public.media row with the same path is marked visibility = 'players'.
-- SVG is not accepted: it can carry script and DTDs (see the earlier map-marker fix in Kanka).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chronicle-media', 'chronicle-media', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "chronicle media read" on storage.objects for select to authenticated
  using (bucket_id = 'chronicle-media' and private.can_read_media_path(name));

create policy "chronicle media dm insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'chronicle-media' and private.is_dm());

create policy "chronicle media dm update" on storage.objects for update to authenticated
  using (bucket_id = 'chronicle-media' and private.is_dm())
  with check (bucket_id = 'chronicle-media' and private.is_dm());

create policy "chronicle media dm delete" on storage.objects for delete to authenticated
  using (bucket_id = 'chronicle-media' and private.is_dm());
