import { describe, expect, it } from 'vitest';
import { reportMarkdown } from './kanka-import.ts';
import { buildPlan, type KankaRecord } from './lib.ts';
const cases: Record<string, unknown> = {
  nullModel: null, numberModel: 5, arrayModel: [1], entityString: { entity: 'x' }, entityNoId: { entity: { name: 'No id' } },
  idString: { entity: { id: '77', name: 'String id' } }, nameNumber: { entity: { id: 1, name: 42 } },
  postsObject: { entity: { id: 2, name: 'P', posts: { a: 1 } } }, postNull: { entity: { id: 3, name: 'P2', posts: [null] } },
  entryNumber: { entity: { id: 4, name: 'E', entry: 12 } }, tagsString: { entity: { id: 5, name: 'T', tags: 'x' } },
  relationsNull: { entity: { id: 6, name: 'R', relationships: [null, { target_id: 'x' }] } },
  unicode: { entity: { id: 7, name: '龍の巣 🐉' } }, emptyName: { entity: { id: 8, name: '   ' } },
  dupA: { entity: { id: 9, name: 'Dup' } }, dupB: { entity: { id: 9, name: 'Dup again' } },
  attrsWeird: { entity: { id: 10, name: 'A', attributes: [null, { name: 5, value: {} }] } },
  longName: { entity: { id: 11, name: 'x'.repeat(500) } },
};
// Synthetic malformed input: every case used to throw before input hardening was added.
describe('malformed and unusual export files', () => {
  for (const [name, model] of Object.entries(cases)) {
    it(name, () => {
      const records = [{ module: 'characters', file: `${name}.json`, model }] as unknown as KankaRecord[];
      expect(() => buildPlan(records, { trustPublicEntities: false })).not.toThrow();
    });
  }
  it('all together: unique source refs and slugs', () => {
    const records = Object.entries(cases).map(([name, model]) => ({ module: 'characters', file: `${name}.json`, model })) as unknown as KankaRecord[];
    const plan = buildPlan(records, { trustPublicEntities: false });
    const refs = plan.articles.map((a) => a.sourceRef); const slugs = plan.articles.map((a) => a.slug);
    expect(new Set(refs).size).toBe(refs.length); expect(new Set(slugs).size).toBe(slugs.length);
    for (const a of plan.articles) { expect(a.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/); expect(a.title.length).toBeGreaterThan(0); expect(a.visibility).toBe('dm'); }
  });

  it('reports what it skipped, and keeps the usable part of a damaged entry', () => {
    const records = Object.entries(cases).map(([name, model]) => ({ module: 'characters', file: `${name}.json`, model })) as unknown as KankaRecord[];
    const plan = buildPlan(records, { trustPublicEntities: true });
    expect(plan.report.malformedFiles).toEqual(['characters/nullModel.json', 'characters/numberModel.json', 'characters/arrayModel.json', 'characters/entityString.json', 'characters/entityNoId.json']);
    expect(plan.report.duplicateEntityFiles).toEqual(['characters/dupB.json']);
    expect(plan.report.droppedParts).toBeGreaterThanOrEqual(5);
    expect(plan.articles.find((a) => a.kankaEntityId === 77)?.title).toBe('String id');
    expect(plan.articles.find((a) => a.kankaEntityId === 1)?.title).toBe('42');
    expect(plan.articles.find((a) => a.kankaEntityId === 7)?.slug).toBe('entry-7');
    const md = reportMarkdown(plan, { source: 'synthetic', checksum: 'x', files: records.length, unreadable: [], trust: true });
    expect(md).toContain('Files skipped as malformed (not a usable Kanka record): characters/nullModel.json');
    expect(md).toContain('same entity id was already read: characters/dupB.json');
  });

  it('a damaged entry never becomes player-visible by accident', () => {
    const records = [{ module: 'characters', file: 'x.json', model: { entity: { id: 50, name: 'Odd', is_private: 'yes', posts: [{ id: 1, name: 'Secret', entry: 'HIDDENTEXT', visibility_id: 'weird' }] } } }] as unknown as KankaRecord[];
    const plan = buildPlan(records, { trustPublicEntities: true });
    expect(plan.articles[0]!.visibility).toBe('dm');
    expect(plan.articles[0]!.sections.every((s) => s.visibility === 'dm')).toBe(true);
  });

  it('unrecognised privacy flags on posts and attributes fail closed', () => {
    const records = [{ module: 'characters', file: 'y.json', model: { entity: {
      id: 51, name: 'Public person', is_private: 0, entry: '<p>Hello</p>',
      posts: [{ id: 1, name: 'Odd flag', entry: 'POSTSECRET', visibility_id: 1, is_private: 'true' }],
      attributes: [{ id: 1, name: 'Odd hidden', value: 'ATTRSECRET', is_hidden: 'yes' }, { id: 2, name: 'Plain', value: 'ok', is_private: 0 }],
    } } }] as unknown as KankaRecord[];
    const a = buildPlan(records, { trustPublicEntities: true }).articles[0]!;
    expect(a.visibility).toBe('players');
    expect(a.sections.find((s) => s.heading === 'Odd flag')?.visibility).toBe('dm');
    expect(a.infobox.find((f) => f.label === 'Odd hidden')?.visibility).toBe('dm');
    expect(a.infobox.find((f) => f.label === 'Plain')?.visibility).toBe('players');
    expect(a.summary).not.toContain('SECRET');
  });
});
