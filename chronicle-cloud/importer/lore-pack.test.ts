import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACT_LEVELS, factCounts, readPack, reviewMarkdown, validatePack, wikiLinkTargets, type LorePack } from './lore-pack.ts';

const packFile = path.resolve(import.meta.dirname, '../lore/dragonlance/pack.json');

function tiny(): LorePack {
  return {
    pack: 'test-pack', version: 1, title: 'Test', generated_from: 'synthetic',
    articles: [
      { ref: 'alpha', slug: 'alpha', type: 'character', title: 'Alpha', summary: 'A.', group: 'G',
        facts: [{ level: 'dm-reported', text: 'Alpha knows [[beta|Beta]].', source: 'synthetic' }],
        sections: [{ heading: 'Overview', body: 'See [[beta]].' }], infobox: [{ label: 'Role', value: 'x' }], questions: [] },
      { ref: 'beta', slug: 'beta', type: 'location', title: 'Beta', summary: 'B.', group: 'G',
        facts: [{ level: 'planned', text: 'Planned.', source: 'synthetic' }],
        sections: [{ heading: 'Overview', body: 'Text.' }], infobox: [], questions: ['Why?'] },
    ],
    relations: [{ source: 'alpha', target: 'beta', kind: 'located_in', label: 'Lives here', level: 'uncertain' }],
  };
}

describe('the committed Dragonlance pack', () => {
  const pack = readPack(packFile);

  it('is valid and every page says what supports it', () => {
    expect(pack.articles.length).toBeGreaterThanOrEqual(20);
    for (const a of pack.articles) expect(a.facts.length, a.ref).toBeGreaterThan(0);
  });

  it('claims nothing as confirmed, because no source file was available', () => {
    expect(factCounts(pack).confirmed).toBe(0);
  });

  it('marks every Operation Dragon Nest page as planned, never as something that happened', () => {
    const upcoming = pack.articles.filter((a) => a.group === 'Upcoming material');
    expect(upcoming.length).toBeGreaterThanOrEqual(5);
    for (const a of upcoming) {
      expect(a.facts.every((f) => f.level === 'planned' || f.level === 'uncertain'), a.ref).toBe(true);
      expect(a.sections[0]!.body, a.ref).toContain('Planned material. Not played.');
    }
  });

  it('contains no visibility or status fields at all', () => {
    expect(JSON.stringify(pack)).not.toMatch(/"(visibility|status)"\s*:/);
  });

  it('produces a review that lists every page as a DM-only draft', () => {
    const md = reviewMarkdown(pack);
    for (const a of pack.articles) expect(md).toContain(`#### ${a.title}`);
    expect(md.match(/Visibility: DM only · Status: draft/g)).toHaveLength(pack.articles.length);
  });
});

describe('validatePack', () => {
  it('accepts a well-formed pack', () => {
    expect(validatePack(tiny())).toEqual([]);
  });

  it('refuses player visibility or published status anywhere in the file', () => {
    const p = tiny() as unknown as { articles: Record<string, unknown>[] };
    p.articles[0]!.visibility = 'players';
    (p.articles[1]!.sections as Record<string, unknown>[])[0]!.status = 'published';
    const errors = validatePack(p);
    expect(errors.some((e) => e.includes('cannot set player visibility'))).toBe(true);
    expect(errors.some((e) => e.includes('cannot publish'))).toBe(true);
  });

  it('refuses pages with no provenance, bad levels, duplicates and dangling links', () => {
    const p = tiny();
    p.articles[0]!.facts = [];
    p.articles[1]!.facts[0]!.level = 'canon' as never;
    p.articles[1]!.sections[0]!.body = 'See [[gamma]].';
    p.articles.push({ ...p.articles[0]!, facts: [{ level: 'uncertain', text: 'x', source: 's' }] });
    p.relations.push({ source: 'alpha', target: 'missing', kind: 'Bad Kind', label: '', level: 'uncertain' });
    const errors = validatePack(p).join('\n');
    expect(errors).toContain('must say what supports it');
    expect(errors).toContain(`must be one of ${FACT_LEVELS.join(', ')}`);
    expect(errors).toContain('link to "gamma"');
    expect(errors).toContain('duplicate "alpha"');
    expect(errors).toContain('"missing" is not in this pack');
    expect(errors).toContain('not a valid kind');
  });

  it('refuses things that are not packs, without throwing', () => {
    expect(validatePack(null)).toEqual(['pack: not a JSON object']);
    expect(validatePack([]).length).toBe(1);
    expect(validatePack({ pack: 'x y', articles: 'no' }).length).toBeGreaterThan(1);
  });

  it('readPack reports unreadable JSON clearly', () => {
    expect(() => readPack(path.resolve(import.meta.dirname, 'lib.ts'))).toThrow(/Could not read/);
  });

  it('finds wiki link targets with and without labels', () => {
    expect(wikiLinkTargets('a [[one]] b [[two|Two]] c')).toEqual(['one', 'two']);
  });
});
