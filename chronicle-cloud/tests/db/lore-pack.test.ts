// Stage, re-run and roll back the Dragonlance lore pack against the LOCAL stack, and check that
// nothing in it is visible to a player by any route. Never runs against a hosted project.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPack, readPack, rollbackPack } from '../../importer/lore-pack.ts';
import { admin, as, pool, resetFixtures } from './helpers.ts';

const env = Object.fromEntries(
  fs.readFileSync(path.resolve(import.meta.dirname, '../../.local/env'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const pack = readPack(path.resolve(import.meta.dirname, '../../lore/dragonlance/pack.json'));
const apply = () => applyPack(pack, env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!);

beforeAll(resetFixtures);
afterAll(() => pool.end());

describe('lore pack against the local stack', () => {
  it('creates every page as a DM-only draft with provenance notes', async () => {
    const summary = await apply();
    expect(summary).toEqual({
      articlesCreated: pack.articles.length, articlesSkipped: 0, slugConflicts: [],
      relationsCreated: pack.relations.length, relationsSkipped: 0,
    });
    const { rows } = await admin<{ n: string; unsafe: string }>(
      `select count(*) as n, count(*) filter (where visibility <> 'dm' or status <> 'draft') as unsafe
       from public.articles where source_ref like 'lore:dragonlance:%'`,
    );
    expect(rows[0]).toEqual({ n: String(pack.articles.length), unsafe: '0' });
    const parts = await admin<{ sections: string; fields: string; relations: string; notes: string }>(
      `select
         (select count(*) from public.article_sections s join public.articles a on a.id = s.article_id
           where a.source_ref like 'lore:%' and (s.visibility <> 'dm' or s.status <> 'draft')) as sections,
         (select count(*) from public.infobox_fields f join public.articles a on a.id = f.article_id
           where a.source_ref like 'lore:%' and f.visibility <> 'dm') as fields,
         (select count(*) from public.relations where source_ref like 'lore:%' and visibility <> 'dm') as relations,
         (select count(*) from public.dm_notes n join public.articles a on a.id = n.article_id
           where a.source_ref like 'lore:%' and n.title = 'Provenance') as notes`,
    );
    expect(parts.rows[0]).toEqual({ sections: '0', fields: '0', relations: '0', notes: String(pack.articles.length) });
  });

  it('shows a player none of it: lists, search, suggestions, links, relations, counts', async () => {
    const before = await as<{ slug: string }>('player', 'select slug from public.articles order by slug');
    expect(before.rows.map((r) => r.slug)).toEqual(['public-article', 'public-three', 'public-two']);
    const probes = await as<{ search: string; suggest: string; sections: string; relations: string; links: string; notes: string; resolve: string }>(
      'player',
      `select
         (select count(*) from public.search_wiki('dragon OR eggs OR Jenna OR pendant OR Gears OR Vogler OR Pelican')) as search,
         (select count(*) from public.suggest_articles('Operation')) + (select count(*) from public.suggest_articles('The four')) as suggest,
         (select count(*) from public.article_sections where body ilike '%Planned material%') as sections,
         (select count(*) from public.relations where kind in ('member_of', 'part_of', 'subject_of')) as relations,
         (select count(*) from public.article_links where target_slug in ('metallic-dragon-eggs', 'operation-dragon-nest', 'jenna')) as links,
         (select count(*) from public.dm_notes) as notes,
         (select count(*) from public.resolve_slug('metallic-dragon-eggs')) as resolve`,
    );
    expect(probes.rows[0]).toEqual({ search: '0', suggest: '0', sections: '0', relations: '0', links: '0', notes: '0', resolve: '0' });
  });

  it('the DM sees all of it', async () => {
    const dm = await as<{ n: string }>('dm', "select count(*) as n from public.articles where source_ref like 'lore:dragonlance:%'");
    expect(dm.rows[0]!.n).toBe(String(pack.articles.length));
  });

  it('running it again creates nothing and overwrites nothing', async () => {
    await admin("update public.articles set title = 'Edited by the DM' where source_ref = 'lore:dragonlance:gears'");
    const again = await apply();
    expect(again.articlesCreated).toBe(0);
    expect(again.articlesSkipped).toBe(pack.articles.length);
    expect(again.relationsCreated).toBe(0);
    const { rows } = await admin<{ title: string }>("select title from public.articles where source_ref = 'lore:dragonlance:gears'");
    expect(rows[0]!.title).toBe('Edited by the DM');
  });

  it('never replaces or duplicates a page the DM already wrote at the same address', async () => {
    await rollbackPack(pack.pack, env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!);
    await admin("insert into public.articles (slug, title) values ('vogler', 'My own Vogler page')");
    const summary = await apply();
    expect(summary.slugConflicts).toEqual(['vogler']);
    expect(summary.articlesCreated).toBe(pack.articles.length - 1);
    const { rows } = await admin<{ title: string; n: string }>("select min(title) as title, count(*) as n from public.articles where slug like 'vogler%'");
    expect(rows[0]).toEqual({ title: 'My own Vogler page', n: '1' });
  });

  it('rollback removes only what the pack created', async () => {
    const deleted = await rollbackPack(pack.pack, env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!);
    expect(deleted.articles).toBe(pack.articles.length - 1);
    const left = await admin<{ lore: string; mine: string; fixtures: string }>(
      `select (select count(*) from public.articles where source_ref like 'lore:%') as lore,
              (select count(*) from public.articles where slug = 'vogler') as mine,
              (select count(*) from public.articles where slug like 'public-%') as fixtures`,
    );
    expect(left.rows[0]).toEqual({ lore: '0', mine: '1', fixtures: '3' });
  });
});
