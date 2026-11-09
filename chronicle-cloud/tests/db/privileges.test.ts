// Guards against the hosted default of granting every new public table and function to anon.
import { afterAll, describe, expect, it } from 'vitest';
import { admin, pool } from './helpers.ts';

afterAll(() => pool.end());

describe('API role privileges', () => {
  it('anon has no privilege on any table or function in public', async () => {
    const tables = await admin(`select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon'`);
    const columns = await admin(`select table_name, column_name from information_schema.role_column_grants
      where table_schema = 'public' and grantee = 'anon'`);
    const functions = await admin(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`);
    expect(tables.rows).toEqual([]);
    expect(columns.rows).toEqual([]);
    expect(functions.rows).toEqual([]);
  });

  it('every table in public has RLS enabled', async () => {
    const { rows } = await admin(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });

  it('signed-in users cannot reach server-only functions, attempts or code hashes', async () => {
    const fn = await admin<{ f: string; ok: boolean }>(`select p.proname as f, has_function_privilege('authenticated', p.oid, 'execute') as ok
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('begin_enrollment', 'complete_enrollment')`);
    expect(fn.rows.every((r) => !r.ok)).toBe(true);
    const attempts = await admin<{ ok: boolean }>(`select has_table_privilege('authenticated', 'public.enrollment_attempts', 'select') as ok`);
    expect(attempts.rows[0]!.ok).toBe(false);
    const hash = await admin<{ ok: boolean }>(`select has_column_privilege('authenticated', 'public.access_codes', 'code_hash', 'select') as ok`);
    expect(hash.rows[0]!.ok).toBe(false);
  });

  it('every SECURITY DEFINER function pins its search_path', async () => {
    const { rows } = await admin(`select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(rows).toEqual([]);
  });
});
