-- LOCAL DEVELOPMENT ONLY. Run after GoTrue and storage-api have created their tables.
-- Mirrors the hosted grants from github.com/supabase/postgres migrations
-- (20211115181400_update-auth-permissions.sql, 20220609081115_...-to-postgres.sql).
grant all on all tables in schema auth to postgres;
grant all on all sequences in schema auth to postgres;
grant all on all routines in schema auth to postgres;
grant all on all tables in schema storage to postgres;
grant all on all sequences in schema storage to postgres;
grant all on all routines in schema storage to postgres;
-- Hosted projects grant the API roles access to storage tables (RLS does the filtering); see the
-- default privileges in init-scripts/00000000000002-storage-schema.sql. storage-api does not do
-- this itself when DB_INSTALL_ROLES=false.
grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant all on all sequences in schema storage to anon, authenticated, service_role;
-- storage-api connects as supabase_storage_admin and switches to the caller's API role.
grant anon, authenticated, service_role to supabase_storage_admin;
