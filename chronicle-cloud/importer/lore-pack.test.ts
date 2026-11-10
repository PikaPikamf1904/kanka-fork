import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePackageText } from '../src/lib/lorePackage.ts';
import { FACT_LEVELS, factCounts, readPack, reviewMarkdown, validatePack, wikiLinkTargets, type LorePack } from './lore-pack.ts';

const packFile = path.resolve(import.meta.dirname, '../lore/dragonlance/pack.json');

function tiny(): LorePack {
  return {
    pack: 'test-pack', version: 1, title: 'Test', generated_from: 'synthetic',
    articles: [
      { ref: 'alpha', slug: 'alpha', type: 'character', title: 'Alpha', summary: 'A.', group: 'G',
        facts: [{ level: 'transcript-derived', text: 'Alpha knows [[beta|Beta]].', source: 'synthetic' }],
        sections: [{ heading: 'Overview', body: 'See [[beta]].' }], infobox: [{ label: 'Role', value: 'x' }], questions: [] },
      { ref: 'beta', slug: 'beta', type: 'location', title: 'Beta', summary: 'B.', group: 'G',
        facts: [{ level: 'planned', text: 'Planned.', source: 'synthetic' }],
        sections: [{ heading: 'Overview', body: 'Text.' }], infobox: [], questions: ['Why?'] },
    ],
    relations: [{ source: 'alpha', target: 'beta', kind: 'located_in', label: 'Lives here', level: 'speculative' }],
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

  it('marks every Operation Dragon Nest page as not played, and never as something that happened', () => {
    const upcoming = pack.articles.filter((a) => a.group.startsWith('Operation Dragon Nest'));
    expect(upcoming.length).toBeGreaterThanOrEqual(5);
    for (const a of upcoming) {
      expect(a.sections[0]!.body, a.ref).toContain('**Not played.**');
      expect(a.facts.some((f) => f.level === 'planned' || f.level === 'dm-secret'), a.ref).toBe(true);
      expect(a.facts.some((f) => f.level === 'confirmed' || f.level === 'player-known'), a.ref).toBe(false);
    }
  });

  it('keeps the dragon eggs out of every page that is not planning material', () => {
    const played = pack.articles.filter((a) => !a.group.startsWith('Operation Dragon Nest'));
    for (const a of played) {
      const text = JSON.stringify([a.title, a.summary, a.sections, a.infobox]).toLowerCase();
      expect(text, a.ref).not.toMatch(/\begg|bonding|experimental/);
      expect(text, a.ref).not.toContain('metallic-dragon-eggs');
      expect(text, a.ref).not.toContain('dragon-nest-dm-dossier');
    }
  });

  it('avoids the stock phrases the DM asked to keep out', () => {
    const banned = ['nestled', 'steeped in', 'testament to', 'tapestry', 'delve', 'little did they know', 'only time will tell', 'haunting reminder', 'pivotal', 'in the heart of', 'more than just', 'shrouded in', 'realm of'];
    const prose = pack.articles.flatMap((a) => [a.summary, ...a.sections.map((s) => s.body)]).join('\n').toLowerCase();
    for (const phrase of banned) expect(prose, phrase).not.toContain(phrase);
    expect(prose).not.toContain('—');
  });

  it('contains no visibility or status fields at all', () => {
    expect(JSON.stringify(pack)).not.toMatch(/"(visibility|status)"\s*:/);
  });

  it('is accepted by the browser importer, with facts and questions as private notes', () => {
    const p = parsePackageText(fs.readFileSync(packFile, 'utf8'));
    expect(p.errors).toEqual([]);
    expect(p.warnings).toEqual([]);
    expect(p.articles).toHaveLength(pack.articles.length);
    expect(p.articles.every((a) => a.notes.some((n) => n.title === 'Provenance'))).toBe(true);
    expect(p.relations).toHaveLength(pack.relations.length);
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
    p.articles.push({ ...p.articles[0]!, facts: [{ level: 'speculative', text: 'x', source: 's' }] });
    p.relations.push({ source: 'alpha', target: 'missing', kind: 'Bad Kind', label: '', level: 'speculative' });
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
