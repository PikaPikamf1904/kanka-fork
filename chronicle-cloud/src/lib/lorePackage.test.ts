import { describe, expect, it } from 'vitest';
import { danglingLinks, PACKAGE_LIMITS, packageToChangeSet, parsePackage, parsePackageText } from './lorePackage.ts';

const article = (over: Record<string, unknown> = {}) => ({
  slug: 'gears', title: 'Gears', type: 'character', summary: 'A mechanical adventurer.',
  sections: [{ heading: 'Overview', body: 'Joined aboard the [[the-bone-pelican|Bone Pelican]].' }],
  infobox: [{ label: 'Nature', value: 'Mechanical' }],
  ...over,
});
const messages = (p: { errors: { message: string }[] }) => p.errors.map((e) => e.message).join(' | ');

describe('parsePackage: what gets through', () => {
  it('accepts a valid package', () => {
    const p = parsePackage({ articles: [article()] });
    expect(p.errors).toEqual([]);
    expect(p.articles).toHaveLength(1);
    expect(p.articles[0]).toMatchObject({ slug: 'gears', type: 'character', subtitle: '', notes: [] });
  });

  it('keeps special characters, non-Latin text and Markdown as plain text', () => {
    const body = 'Čaj & <b>bold</b> <script>alert(1)</script> 龍 🐉 "quotes" [link](javascript:alert(1))';
    const p = parsePackage({ articles: [article({ title: 'Ünïcødé 龍', sections: [{ heading: 'H', body }] })] });
    expect(p.errors).toEqual([]);
    expect(p.articles[0]!.sections[0]!.body).toBe(body);
  });

  it('ignores unexpected extra properties', () => {
    const p = parsePackage({ extra: 1, articles: [article({ is_featured: true, importance: 99, id: 'x', created_by: 'y', source_ref: 'z' })] });
    expect(p.errors).toEqual([]);
    expect(Object.keys(p.articles[0]!).sort()).toEqual(['infobox', 'notes', 'sections', 'slug', 'subtitle', 'summary', 'title', 'type']);
  });

  it('accepts the largest allowed package and refuses one more', () => {
    const many = (n: number) => ({ articles: Array.from({ length: n }, (_, i) => article({ slug: `page-${i}`, title: `Page ${i}` })) });
    expect(parsePackage(many(PACKAGE_LIMITS.articles)).articles).toHaveLength(PACKAGE_LIMITS.articles);
    const over = parsePackage(many(PACKAGE_LIMITS.articles + 1));
    expect(over.articles).toHaveLength(0);
    expect(messages(over)).toContain('the limit is 100');
  });
});

describe('parsePackage: visibility and publication can never be requested', () => {
  it('drops visibility and status fields wherever they appear, and says so', () => {
    const p = parsePackage({
      visibility: 'players',
      articles: [article({
        visibility: 'players', status: 'published',
        sections: [{ heading: 'H', body: 'B', visibility: 'players', status: 'published' }],
        infobox: [{ label: 'L', value: 'V', visibility: 'players' }],
      })],
    });
    expect(p.errors).toEqual([]);
    expect(JSON.stringify(p.articles)).not.toMatch(/visibility|status|players|published/);
    expect(p.warnings[0]!.message).toContain('imported as a DM-only draft');
  });

  it('says nothing when the file only asks for what it would get anyway', () => {
    expect(parsePackage({ articles: [article({ visibility: 'dm', status: 'draft' })] }).warnings).toEqual([]);
  });
});

describe('parsePackage: what is refused', () => {
  it('refuses things that are not packages', () => {
    for (const bad of [null, 5, 'text', [], {}, { articles: 'no' }, { articles: {} }]) {
      const p = parsePackage(bad);
      expect(p.articles).toHaveLength(0);
      expect(p.errors).toHaveLength(1);
    }
    expect(messages(parsePackage({ articles: [] }))).toContain('no articles');
    expect(messages(parsePackageText('{not json'))).toContain('not valid JSON');
    expect(messages(parsePackageText(' '.repeat(PACKAGE_LIMITS.fileBytes + 1)))).toContain('too large');
  });

  it('reports every bad entry and still keeps the good ones', () => {
    const p = parsePackage({ articles: [
      article(),
      'not an object',
      article({ slug: 'Bad Slug' }),
      article({ slug: '../etc/passwd' }),
      article({ slug: 'no-title', title: '   ' }),
      article({ slug: 'bad-type', type: 'spell' }),
      article({ slug: 'no-sections', sections: [] }),
      article({ slug: 'empty-body', sections: [{ heading: 'H', body: '' }] }),
      article({ slug: 'sections-object', sections: { a: 1 } }),
      article({ slug: 'long-title', title: 'x'.repeat(201) }),
      article({ slug: 'long-body', sections: [{ heading: 'H', body: 'x'.repeat(PACKAGE_LIMITS.body + 1) }] }),
      article({ slug: 'bad-infobox', infobox: [{ label: '', value: 'v' }] }),
      article({ slug: 'number-summary', summary: 5 }),
      article({ slug: 'control-chars', sections: [{ heading: 'H', body: 'a\u0000b' }] }),
      article({ slug: 'x'.repeat(161) }),
      article({ slug: 'fine-too', title: 'Fine too' }),
    ] });
    expect(p.articles.map((a) => a.slug)).toEqual(['gears', 'fine-too']);
    expect(p.errors).toHaveLength(14);
    expect(p.errors.map((e) => e.index)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const all = messages(p);
    for (const expected of ['not an object', 'lower-case letters', 'title is empty', 'is not supported', 'at least one section', 'text is empty', 'sections must be a list', 'too long', 'label is empty', 'must be text', 'control characters']) {
      expect(all).toContain(expected);
    }
  });

  it('refuses the second of two entries with the same address, and warns about equal titles', () => {
    const p = parsePackage({ articles: [article(), article({ title: 'Other' }), article({ slug: 'gears-2' })] });
    expect(p.articles.map((a) => a.slug)).toEqual(['gears', 'gears-2']);
    expect(messages(p)).toContain('same address as entry 1');
    expect(p.warnings.map((w) => w.message).join(' ')).toContain('Same title as "gears"');
  });
});

describe('connections and links', () => {
  it('keeps only connections between two different valid pages of the package', () => {
    const p = parsePackage({
      articles: [article(), article({ slug: 'the-bone-pelican', title: 'The Bone Pelican', type: 'location' }), article({ slug: 'Bad' })],
      relations: [
        { source: 'gears', target: 'the-bone-pelican', kind: 'appears_in', label: 'Joined aboard', visibility: 'players' },
        { source: 'gears', target: 'the-bone-pelican', kind: 'appears_in', label: 'duplicate' },
        { source: 'gears', target: 'gears', kind: 'related_to', label: 'self' },
        { source: 'gears', target: 'nobody', kind: 'related_to', label: 'missing end' },
        { source: 'gears', target: 'Bad', kind: 'related_to', label: 'invalid end' },
        { source: 'gears', target: 'the-bone-pelican', kind: 'Bad Kind', label: 'bad kind' },
        'nonsense',
      ],
    });
    expect(p.relations).toEqual([{ source: 'gears', target: 'the-bone-pelican', kind: 'appears_in', label: 'Joined aboard' }]);
    expect(p.warnings.filter((w) => w.name.startsWith('Connection'))).toHaveLength(5);
  });

  it('finds links to pages that exist nowhere', () => {
    const p = parsePackage({ articles: [article({ sections: [{ heading: 'H', body: '[[the-bone-pelican]] [[Jenna]] [[vogler|Vogler]]' }] })] });
    expect(danglingLinks(p.articles, new Set(['vogler']))).toEqual([{ slug: 'gears', targets: ['the-bone-pelican', 'jenna'] }]);
    expect(danglingLinks(p.articles, new Set(['vogler', 'the-bone-pelican', 'jenna']))).toEqual([]);
  });
});

describe('packageToChangeSet', () => {
  it('builds one change set of skip-if-exists creates with their parts, for the chosen pages only', () => {
    const p = parsePackage({
      articles: [article({ notes: [{ title: 'Provenance', body: 'Synthetic.' }] }), article({ slug: 'the-bone-pelican', title: 'The Bone Pelican', type: 'location' }), article({ slug: 'left-out', title: 'Left out' })],
      relations: [{ source: 'gears', target: 'the-bone-pelican', kind: 'appears_in', label: 'Joined' }, { source: 'gears', target: 'left-out', kind: 'knows' }],
    });
    const cs = packageToChangeSet(p, new Set(['gears', 'the-bone-pelican']), 'Import test');
    expect(cs.label).toBe('Import test');
    expect(cs.changes.map((c) => c.operation)).toEqual([
      'create_article', 'upsert_section', 'upsert_infobox_field', 'add_dm_note',
      'create_article', 'upsert_section', 'upsert_infobox_field',
      'add_relation',
    ]);
    expect(cs.changes.filter((c) => c.operation === 'create_article').every((c) => 'on_exists' in c && c.on_exists === 'skip')).toBe(true);
    expect(JSON.stringify(cs)).not.toMatch(/visibility|status|published/);
  });

  it('refuses a page whose sections exceed 100 KB of text', () => {
    const big = Array.from({ length: 4 }, (_, i) => ({ heading: `h${i}`, body: 'x'.repeat(29_000) }));
    expect(parsePackage({ articles: [article({ sections: big })] }).errors[0]!.message).toContain('limit per page');
  });
});
