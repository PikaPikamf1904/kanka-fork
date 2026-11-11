// Release-blocking: a player must never receive anything the DM has not revealed, through any
// table, function, count or join. Every case runs against real PostgreSQL with the same role
// switching PostgREST performs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, columns, pool, resetFixtures, type Who } from './helpers.ts';

const A = 'a0000000-0000-4000-8000-00000000000a';
const B = 'a0000000-0000-4000-8000-00000000000b';
const D = 'a0000000-0000-4000-8000-00000000000d';
const E = 'a0000000-0000-4000-8000-00000000000e';

beforeAll(resetFixtures);
afterAll(() => pool.end());

const secretWords = [
  'SECRETWORD', 'DRAFTWORD', 'SPYMASTERWORD', 'HIDDENARTICLEWORD', 'INFOBOXSECRET', 'NOTEWORD',
  'TIMELINESECRET', 'MARKERSECRET', 'Traitors', 'traitor-captain', 'Hidden Spymaster',
  'Secretly serves', 'Dragon Nest', 'Unfinished Keep', 'nest-plan', 'FOGSECRET', 'FOGNEST',
];

/** Everything a player could pull through the API, as one string, to scan for secrets. */
async function everythingVisibleTo(who: Who) {
  const queries = [
    'select * from public.articles',
    'select * from public.article_sections',
    'select * from public.infobox_fields',
    'select * from public.categories',
    'select * from public.article_categories',
    'select * from public.article_links',
    'select * from public.redirects',
    'select * from public.relations',
    'select * from public.timeline_events',
    'select * from public.maps',
    'select * from public.map_markers',
    'select * from public.map_fog_areas',
    'select * from public.media',
    "select name from storage.objects where bucket_id = 'chronicle-media'",
    'select * from public.campaign_settings',
    "select * from public.search_wiki('captain OR secretword OR draftword OR spymasterword OR hiddenarticleword OR lighthousewords')",
    "select * from public.suggest_articles('h')",
    "select * from public.suggest_articles('u')",
    'select * from public.category_counts()',
    `select * from public.backlinks('${D}')`,
    `select * from public.backlinks('${E}')`,
    `select * from public.backlinks('${B}')`,
    "select * from public.resolve_slug('traitor-captain')",
    "select * from public.resolve_slug('secret-article')",
  ];
  const out: unknown[] = [];
  for (const sql of queries) {
    const result = await as(who, sql);
    if (result.error) throw new Error(`${sql}: ${result.error.message}`);
    out.push(result.rows);
  }
  return JSON.stringify(out);
}

describe('player view', () => {
  it('contains none of the secret marker words anywhere', async () => {
    const all = await everythingVisibleTo('player');
    for (const word of secretWords) {
      expect(all, word).not.toContain(word);
    }
  });

  it('sees only published, player-visible articles', async () => {
    const { rows } = await as<{ slug: string }>('player', 'select slug from public.articles');
    expect(columns(rows, 'slug')).toEqual(['public-article', 'public-three', 'public-two']);
  });

  it('gets only the player-visible, published section of a mixed article', async () => {
    const { rows } = await as<{ heading: string }>('player', 'select heading from public.article_sections where article_id = $1', [A]);
    expect(columns(rows, 'heading')).toEqual(['Known history']);
  });

  it('cannot fetch a DM section or a hidden article section by id', async () => {
    const dmSection = await as('player', "select * from public.article_sections where id = '50000000-0000-4000-8000-000000000002'");
    const hiddenArticle = await as('player', 'select * from public.article_sections where article_id = $1', [B]);
    expect(dmSection.rowCount).toBe(0);
    expect(hiddenArticle.rowCount).toBe(0);
  });

  it('sees only player infobox fields', async () => {
    const { rows } = await as<{ label: string }>('player', 'select label from public.infobox_fields');
    expect(columns(rows, 'label')).toEqual(['Race']);
  });

  it('cannot read DM notes, revisions, access codes or enrollment attempts', async () => {
    expect((await as('player', 'select * from public.dm_notes')).rowCount).toBe(0);
    expect((await as('player', 'select * from public.revisions')).rowCount).toBe(0);
    expect((await as('player', 'select id from public.access_codes')).rowCount).toBe(0);
    expect((await as('player', 'select code_hash from public.access_codes')).error?.code).toBe('42501');
    expect((await as('player', 'select * from public.enrollment_attempts')).error?.code).toBe('42501');
  });

  it('only sees its own membership row', async () => {
    const { rows } = await as<{ display_name: string }>('player', 'select display_name from public.campaign_members');
    expect(columns(rows, 'display_name')).toEqual(['Test Player']);
  });

  it('category counts only include visible categories and visible articles', async () => {
    const { rows } = await as<{ slug: string; article_count: string }>('player', 'select slug, article_count from public.category_counts()');
    expect(rows).toEqual([{ slug: 'sailors', article_count: '1' }]);
  });

  it('relations hide both hidden relations and relations to hidden articles', async () => {
    const { rows } = await as<{ kind: string }>('player', 'select kind from public.relations');
    expect(columns(rows, 'kind')).toEqual(['resides_in']);
  });

  it('backlinks ignore links written in DM sections and links from hidden articles', async () => {
    const toTown = await as<{ slug: string }>('player', 'select slug from public.backlinks($1)', [D]);
    const toGuild = await as<{ slug: string }>('player', 'select slug from public.backlinks($1)', [E]);
    expect(columns(toTown.rows, 'slug')).toEqual(['public-article']);
    expect(toGuild.rowCount).toBe(0);
  });

  it('redirects and slug resolution hide DM redirects and hidden articles', async () => {
    const redirects = await as<{ from_slug: string }>('player', 'select from_slug from public.redirects');
    expect(columns(redirects.rows, 'from_slug')).toEqual(['old-captain-name']);
    expect((await as('player', "select * from public.resolve_slug('traitor-captain')")).rowCount).toBe(0);
    expect((await as('player', "select * from public.resolve_slug('secret-article')")).rowCount).toBe(0);
    const ok = await as<{ slug: string }>('player', "select slug from public.resolve_slug('old-captain-name')");
    expect(ok.rows[0]?.slug).toBe('public-article');
  });

  it('timeline shows only published, visible events not tied to hidden articles', async () => {
    const { rows } = await as<{ title: string }>('player', 'select title from public.timeline_events');
    expect(columns(rows, 'title')).toEqual(['Visible event']);
  });

  it('maps hide DM maps, DM markers and markers that link to hidden articles', async () => {
    const maps = await as<{ slug: string }>('player', 'select slug from public.maps');
    const markers = await as<{ label: string }>('player', 'select label from public.map_markers');
    expect(columns(maps.rows, 'slug')).toEqual(['world']);
    expect(columns(markers.rows, 'label')).toEqual(['Harbour']);
  });

  it('media rows and storage objects are limited to player-visible files', async () => {
    const media = await as<{ path: string }>('player', 'select path from public.media');
    const objects = await as<{ name: string }>('player', "select name from storage.objects where bucket_id = 'chronicle-media'");
    expect(columns(media.rows, 'path')).toEqual(['public/harbour.webp']);
    expect(columns(objects.rows, 'name')).toEqual(['public/harbour.webp']);
  });

  it('search never matches DM sections, drafts or hidden articles', async () => {
    for (const word of ['SECRETWORD', 'DRAFTWORD', 'SPYMASTERWORD', 'HIDDENARTICLEWORD', 'Spymaster']) {
      const { rows } = await as('player', 'select * from public.search_wiki($1)', [word]);
      expect(rows, word).toEqual([]);
    }
    // A word in both a visible and a DM section: the article is found, the snippet is player-safe.
    const { rows } = await as<{ slug: string; snippet: string }>('player', 'select slug, snippet from public.search_wiki($1)', ['Lighthousewords']);
    expect(rows.map((r) => r.slug)).toEqual(['public-article']);
    expect(rows[0]?.snippet).not.toContain('SECRETWORD');
  });

  it('suggestions never include hidden titles', async () => {
    const { rows } = await as<{ title: string }>('player', 'select title from public.suggest_articles($1)', ['h']);
    expect(columns(rows, 'title')).toEqual(['Harbour Town']);
  });

  it('cannot use the DM preview', async () => {
    const result = await as('player', "select public.preview_article_as_player('public-article')");
    expect(result.error?.code).toBe('42501');
  });
});

describe('player writes are refused', () => {
  it('cannot insert, update or delete content', async () => {
    const insert = await as('player', "insert into public.articles (slug, title) values ('x', 'X')");
    expect(insert.error?.code).toBe('42501');
    const update = await as('player', "update public.articles set title = 'Hacked' where id = $1 returning id", [A]);
    expect(update.rowCount).toBe(0);
    const del = await as('player', 'delete from public.articles where id = $1 returning id', [A]);
    expect(del.rowCount).toBe(0);
    const reveal = await as('player', "update public.article_sections set visibility = 'players' returning id");
    expect(reveal.rowCount).toBe(0);
  });

  it('cannot promote itself or un-revoke anyone', async () => {
    const role = await as('player', "update public.campaign_members set role = 'dm'");
    expect(role.error?.code).toBe('42501');
    const unrevoke = await as('player', 'update public.campaign_members set revoked_at = null returning user_id');
    expect(unrevoke.rowCount).toBe(0);
    const join = await as('player', "insert into public.campaign_members (user_id, role) values (gen_random_uuid(), 'dm')");
    expect(join.error?.code).toBe('42501');
  });

  it('cannot upload or delete files', async () => {
    const upload = await as('player', "insert into storage.objects (bucket_id, name) values ('chronicle-media', 'public/evil.webp')");
    expect(upload.error).toBeDefined();
    const del = await as('player', "delete from storage.objects where bucket_id = 'chronicle-media' returning name");
    expect(del.rowCount).toBe(0);
  });

  it('cannot call DM or server-only functions', async () => {
    for (const sql of [
      "select public.create_access_code('a-very-long-code')",
      "select public.rotate_access_code('a-very-long-code')",
      'select public.revoke_all_players()',
      `select public.snapshot_article('${A}')`,
      "select public.begin_enrollment('correct horse battery', 'abcdefabcdefabcdef')",
      "select public.complete_enrollment(gen_random_uuid(), gen_random_uuid())",
    ]) {
      const result = await as('player', sql);
      expect(result.error?.code, sql).toBe('42501');
    }
  });

  it('ignores role claims in the token and in user or app metadata', async () => {
    const forged = {
      extra: {
        user_role: 'dm',
        app_metadata: { role: 'dm' },
        user_metadata: { role: 'dm', chronicle_role: 'dm' },
      },
    };
    const notes = await as('player', 'select * from public.dm_notes', [], forged);
    expect(notes.rowCount).toBe(0);
    const aal2 = await as('player', 'select * from public.dm_notes', [], { aal: 'aal2' });
    expect(aal2.rowCount).toBe(0);
  });
});

describe('everyone without active membership sees nothing', () => {
  for (const who of ['outsider', 'revoked'] as const) {
    it(`${who}: every table and function returns nothing`, async () => {
      const all = await everythingVisibleTo(who);
      expect(all).toBe(JSON.stringify(Array.from({ length: 24 }, () => [])));
    });
  }

  it('anon: permission denied on tables and functions', async () => {
    for (const sql of [
      'select * from public.articles',
      'select * from public.campaign_settings',
      "select * from public.search_wiki('captain')",
      "select name from storage.objects where bucket_id = 'chronicle-media'",
    ]) {
      const result = await as('anon', sql);
      if (sql.includes('storage.objects')) {
        expect(result.rowCount, sql).toBe(0);
      } else {
        expect(result.error?.code, sql).toBe('42501');
      }
    }
  });
});

describe('DM view', () => {
  it('sees everything', async () => {
    const all = await everythingVisibleTo('dm');
    for (const word of ['SECRETWORD', 'DRAFTWORD', 'INFOBOXSECRET', 'TIMELINESECRET', 'MARKERSECRET', 'Traitors']) {
      expect(all, word).toContain(word);
    }
    expect((await as('dm', 'select * from public.dm_notes')).rowCount).toBe(1);
  });

  it('preview-as-player matches what a player actually receives', async () => {
    const preview = await as<{ p: { sections: { heading: string }[]; infobox: { label: string }[]; categories: { slug: string }[]; relations: { slug: string }[] } }>(
      'dm', "select public.preview_article_as_player('public-article') as p",
    );
    const p = preview.rows[0]!.p;
    const sections = await as<{ heading: string }>('player', 'select heading from public.article_sections where article_id = $1 order by position', [A]);
    const infobox = await as<{ label: string }>('player', 'select label from public.infobox_fields where article_id = $1 order by position', [A]);
    const cats = await as<{ slug: string }>('player',
      'select c.slug from public.article_categories ac join public.categories c on c.id = ac.category_id where ac.article_id = $1', [A]);
    const rels = await as<{ slug: string }>('player',
      `select o.slug from public.relations r join public.articles o
         on o.id = case when r.source_article_id = $1 then r.target_article_id else r.source_article_id end
       where r.source_article_id = $1 or r.target_article_id = $1`, [A]);
    expect(p.sections.map((s) => s.heading)).toEqual(sections.rows.map((s) => s.heading));
    expect(p.infobox.map((f) => f.label)).toEqual(infobox.rows.map((f) => f.label));
    expect(p.categories.map((c) => c.slug).sort()).toEqual(columns(cats.rows, 'slug'));
    expect(p.relations.map((r) => r.slug).sort()).toEqual(columns(rels.rows, 'slug'));
    const hidden = await as<{ p: { visible: boolean } }>('dm', "select public.preview_article_as_player('secret-article') as p");
    expect(hidden.rows[0]!.p.visible).toBe(false);
  });

  it('a DM with MFA needs an aal2 session to see DM content', async () => {
    const aal1 = await as('dmMfa', 'select * from public.dm_notes');
    expect(aal1.rowCount).toBe(0);
    // With aal1 the account still counts as a member, so it sees only player content.
    const articles = await as<{ slug: string }>('dmMfa', 'select slug from public.articles');
    expect(columns(articles.rows, 'slug')).toEqual(['public-article', 'public-three', 'public-two']);
    const aal2 = await as('dmMfa', 'select * from public.dm_notes', [], { aal: 'aal2' });
    expect(aal2.rowCount).toBe(1);
  });
});
