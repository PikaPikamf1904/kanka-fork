-- LOCAL DEVELOPMENT ONLY. Never run against a hosted project.
--
-- Run after Supabase's official init scripts (github.com/supabase/postgres,
-- migrations/db/init-scripts) to reproduce the privileges a hosted project gives the `postgres`
-- role. Each statement mirrors a migration in that repository:
--   20220609081115_grant-supabase-auth-admin-and-supabase-storage-admin-to-postgres.sql
--   20211115181400_update-auth-permissions.sql
--   20230201083204_grant_auth_roles_to_postgres.sql
-- plus the auth function ownership that later image migrations hand to supabase_auth_admin, so
-- GoTrue can run its own migrations.

alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;
alter function auth.email() owner to supabase_auth_admin;
alter schema auth owner to supabase_auth_admin;

grant supabase_auth_admin, supabase_storage_admin to postgres;
grant anon, authenticated, service_role to postgres;
grant all on schema auth to postgres;
grant all on schema storage to postgres;
grant create on database postgres to postgres;
grant create, usage on schema public to postgres;
