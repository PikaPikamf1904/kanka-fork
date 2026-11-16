import pg from 'pg';
import { assertDisposableDatabase, readLocalEnv } from '../../scripts/local-targets.mjs';

// LOCAL ONLY: forget earlier failed code attempts so repeated test runs do not trip the real
// rate limit for 127.0.0.1.
export default async function globalSetup() {
  readLocalEnv();
  await assertDisposableDatabase();
  const client = new pg.Client({ connectionString: 'postgres://supabase_admin@127.0.0.1:54322/postgres' });
  await client.connect();
  await client.query('delete from public.enrollment_attempts');
  await client.end();
}
