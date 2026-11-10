// Apply, re-run and roll back a synthetic Kanka import against the LOCAL stack.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPlan, readExport, rollback } from '../../importer/kanka-import.ts';
import { buildPlan } from '../../importer/lib.ts';
import { admin, as, pool, resetFixtures } from './helpers.ts';

const env = Object.fromEntries(
  fs.readFileSync(path.resolve(import.meta.dirname, '../../.local/env'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const fixture = path.resolve(import.meta.dirname, '../../importer/fixtures/kanka-export');

beforeAll(resetFixtures);
afterAll(() => pool.end());

describe('Kanka import against the local stack', () => {
  const plan = buildPlan(readExport(fixture).records, { trustPublicEntities: true });

  it('creates articles, sections, fields, tags and relations with source refs', async () => {
    const summary = await applyPlan(plan, env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!);
    expect(summary).toEqual({ articlesCreated: 4, articlesSkipped: 0, categories: 2, relations: 3 });
    const { rows } = await admin<{ n: string }>("select count(*) as n from public.articles where source_ref like 'kanka:%'");
    expect(rows[0]!.n).toBe('4');
  });

  it('a player sees only what the import rules allow', async () => {
    const titles = await as<{ title: string }>('player', "select title from public.articles where source_ref like 'kanka:%' order by title");
    expect(titles.rows.map((r) => r.title)).toEqual(['Captain Merrin', 'Captain Merrin', 'Port Vellmoor']);
    const all = JSON.stringify((await as('player', 'select * from public.article_sections')).rows)
      + JSON.stringify((await as('player', 'select * from public.infobox_fields')).rows)
      + JSON.stringify((await as('player', 'select * from public.categories')).rows)
      + JSON.stringify((await as('player', 'select * from public.relations')).rows);
    for (const secret of ['SECRETPOST', 'SECRETATTR', 'SECRETNOTE', 'Villains', 'Secretly owns', 'The Plan']) {
      expect(all, secret).not.toContain(secret);
    }
  });

  it('re-running skips everything that already exists', async () => {
    const summary = await applyPlan(plan, env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!);
    expect(summary).toEqual({ articlesCreated: 0, articlesSkipped: 4, categories: 0, relations: 0 });
  });

  it('rollback removes exactly the imported rows', async () => {
    const before = await admin<{ n: string }>("select count(*) as n from public.articles where source_ref is null");
    const deleted = await rollback(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!);
    expect(deleted).toEqual({ relations: 3, articles: 4, categories: 2 });
    const after = await admin<{ n: string }>("select count(*) as n from public.articles where source_ref is null");
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    const left = await admin<{ n: string }>("select count(*) as n from public.article_sections s join public.articles a on a.id = s.article_id where a.source_ref like 'kanka:%'");
    expect(left.rows[0]!.n).toBe('0');
  });
});
