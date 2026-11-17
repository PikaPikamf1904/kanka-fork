// Restore a logical Chronicle backup (one JSON file per table, as written by
// scripts/export-logical-backup.sh) into the LOCAL disposable stack, then compare row counts.
//
//   node scripts/restore-logical-backup.mjs <backup-dir>
//
// Refuses any database that is not the local stack (scripts/local-targets.mjs). Restores auth users
// (so accounts keep their ids) and every public table, with triggers and foreign-key checks
// suspended for the load so the order of tables does not matter. Never prints row contents.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { assertDatabaseUrl, localAdminUrl } from './local-targets.mjs';

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error('usage: node scripts/restore-logical-backup.mjs <backup-dir>');
  process.exit(2);
}
// supabase_admin owns auth and can suspend triggers for the load.
const url = (process.env.CHRONICLE_RESTORE_DB_URL ?? localAdminUrl).replace('://postgres@', '://supabase_admin@');
assertDatabaseUrl(url);

const rowsOf = (file) => {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(d) && d[0] && Array.isArray(d[0].rows) ? d[0].rows : Array.isArray(d) ? d : [];
};

const client = new pg.Client({ connectionString: url });
await client.connect();
const report = [];
try {
  await client.query('begin');
  await client.query('set local session_replication_role = replica');
  const files = fs.readdirSync(dir).filter((f) => /^(public|auth)\.[a-z_]+\.json$/.test(f)).sort((a, b) => (a.startsWith('auth.') ? -1 : 1) - (b.startsWith('auth.') ? -1 : 1) || a.localeCompare(b));
  for (const f of files) {
    const [schema, table] = f.replace(/\.json$/, '').split('.');
    const rows = rowsOf(path.join(dir, f));
    const cols = (await client.query(
      `select column_name from information_schema.columns
       where table_schema = $1 and table_name = $2 and is_generated = 'NEVER' and generation_expression is null
       order by ordinal_position`, [schema, table])).rows.map((r) => r.column_name);
    if (cols.length === 0) {
      report.push({ table: `${schema}.${table}`, backup: rows.length, restored: 'table missing' });
      continue;
    }
    const present = cols.filter((c) => rows.length === 0 || Object.prototype.hasOwnProperty.call(rows[0], c));
    const list = present.map((c) => `"${c}"`).join(', ');
    await client.query(`delete from "${schema}"."${table}"`);
    if (rows.length) {
      await client.query(
        `insert into "${schema}"."${table}" (${list}) overriding system value select ${list} from json_populate_recordset(null::"${schema}"."${table}", $1::json)`,
        [JSON.stringify(rows)],
      );
    }
    const n = (await client.query(`select count(*)::int as n from "${schema}"."${table}"`)).rows[0].n;
    report.push({ table: `${schema}.${table}`, backup: rows.length, restored: n });
  }
  await client.query('commit');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error('restore failed:', error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await client.end();
}
let ok = true;
for (const r of report) {
  const same = r.backup === r.restored;
  if (!same) ok = false;
  console.log(`${same ? 'ok  ' : 'DIFF'} ${r.table}: backup ${r.backup}, restored ${r.restored}`);
}
console.log(ok ? 'RESTORE OK: every table matches the backup' : 'RESTORE INCOMPLETE');
process.exit(ok ? 0 : 1);
