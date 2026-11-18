// Apply the pending migrations to a HOSTED Chronicle project through the Supabase Management API.
//
//   SUPABASE_PROJECT_REF=<ref> node scripts/apply-hosted-migrations.mjs --expect <count>            # dry run
//   SUPABASE_PROJECT_REF=<ref> node scripts/apply-hosted-migrations.mjs --expect <count> --apply    # writes
//
// The dry run (default) only reads: it lists the pending files with their SHA-256 and changes nothing.
// --apply runs each pending file in its own transaction together with its row in
// supabase_migrations.schema_migrations (version = file prefix, name = rest of the file name,
// statements = the file text, as the hosted project already records its first 13), and stops at the
// first error. --expect is required so a changed file list cannot be applied by surprise.
// Authentication: SUPABASE_ACCESS_TOKEN if set, otherwise the request is sent as is (a network proxy
// may add it). The token is never printed. Take and verify a backup first (BACKUP-RESTORE-CHECKLIST).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const expectAt = args.indexOf('--expect');
const expected = expectAt >= 0 ? Number(args[expectAt + 1]) : NaN;
const ref = process.env.SUPABASE_PROJECT_REF ?? '';
if (!/^[a-z0-9]{20}$/.test(ref) || !Number.isInteger(expected) || expected < 0) {
  console.error('usage: SUPABASE_PROJECT_REF=<ref> node scripts/apply-hosted-migrations.mjs --expect <count> [--apply]');
  process.exit(2);
}
const dir = path.resolve(import.meta.dirname, '../supabase/migrations');
const headers = { 'content-type': 'application/json', ...(process.env.SUPABASE_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` } : {}) };

async function run(query, readOnly) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers, body: JSON.stringify({ query, read_only: readOnly }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

const last = (await run('select coalesce(max(version), \'\') as v from supabase_migrations.schema_migrations', true))[0].v;
const pending = fs.readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort().filter((f) => f.slice(0, 14) > last);
console.log(`hosted last migration: ${last}; pending files: ${pending.length}`);
for (const f of pending) {
  console.log(`  ${f}  ${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')}`);
}
if (pending.length !== expected) {
  console.error(`expected ${expected} pending files, found ${pending.length}; nothing applied`);
  process.exit(1);
}
if (!apply) {
  console.log('dry run only; add --apply to write');
  process.exit(0);
}

for (const f of pending) {
  const version = f.slice(0, 14);
  const name = f.slice(15, -4);
  const sql = fs.readFileSync(path.join(dir, f), 'utf8');
  const tag = `$chr${crypto.randomBytes(6).toString('hex')}$`;
  if (sql.includes(tag)) throw new Error('quote tag collision');
  const body = `begin;\n${sql}\n;\ninsert into supabase_migrations.schema_migrations (version, name, statements) values ('${version}', '${name}', array[${tag}${sql}${tag}]);\ncommit;`;
  try {
    await run(body, false);
  } catch (error) {
    console.error(`FAILED ${f}: ${error instanceof Error ? error.message : error}`);
    console.error('The transaction was not committed. Nothing after this file was applied.');
    process.exit(1);
  }
  const now = (await run('select max(version) as v from supabase_migrations.schema_migrations', true))[0].v;
  console.log(`applied ${f} (hosted last migration now ${now})`);
}
console.log('all pending migrations applied');
