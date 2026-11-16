-- Import bookkeeping: rows created by the Kanka importer carry source_ref = 'kanka:<kind>:<id>'.
-- Re-running an import skips rows that already exist, and a rollback can remove exactly the
-- imported rows (see docs/migration/kanka-import-plan.md). Not readable in any new way: the
-- columns sit on tables whose RLS already applies.
alter table public.categories add column source_ref text unique;
alter table public.media add column source_ref text unique;
alter table public.relations add column source_ref text unique;
alter table public.maps add column source_ref text unique;
alter table public.map_markers add column source_ref text unique;
