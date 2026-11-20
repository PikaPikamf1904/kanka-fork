// The hosted Data API runs with pg_safeupdate: an UPDATE or DELETE without a WHERE clause fails
// with "UPDATE requires a WHERE clause". The local test database does not enforce that, so a
// migration that does it passes every local test and breaks on the hosted project (this is how the
// maintenance switch shipped broken). This reads every migration and refuses such statements.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve(import.meta.dirname, '../../supabase/migrations');

/** Statements that change every row of a table. Comments are removed first. */
export function unscopedWrites(sql: string): string[] {
  const text = sql.replace(/--[^\n]*/g, '');
  const found: string[] = [];
  const pattern = /\b(update\s+(?:only\s+)?[\w."]+\s+(?:as\s+\w+\s+)?set\b[^;]*;|delete\s+from\s+[\w."]+[^;]*;)/gis;
  for (const m of text.matchAll(pattern)) {
    if (!/\bwhere\b|\bcurrent\s+of\b/i.test(m[1]!)) found.push(m[1]!.replace(/\s+/g, ' ').trim());
  }
  return found;
}

describe('migrations are safe for the hosted Data API', () => {
  it('the checker finds a write with no WHERE and accepts one with it', () => {
    expect(unscopedWrites('update public.t set a = 1;')).toHaveLength(1);
    expect(unscopedWrites('delete from public.t;')).toHaveLength(1);
    expect(unscopedWrites('update public.t set a = 1 where id = true;')).toEqual([]);
    expect(unscopedWrites('-- update public.t set a = 1;\nselect 1;')).toEqual([]);
  });

  it('no migration updates or deletes every row of a table', () => {
    const bad: string[] = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      // The one known case is the original function, replaced by 20261120000100.
      const found = unscopedWrites(fs.readFileSync(path.join(dir, f), 'utf8')).filter(() => f !== '20261117000700_maintenance_switch.sql');
      for (const s of found) bad.push(`${f}: ${s.slice(0, 100)}`);
    }
    expect(bad).toEqual([]);
  });
});
