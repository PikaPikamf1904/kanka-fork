import { describe, expect, it } from 'vitest';
import { layoutFamily, MAX_GENERATIONS, type FamilyEdge, type FamilyPerson } from './familyTree.ts';

const p = (id: string): FamilyPerson => ({ id, slug: id, title: id.toUpperCase(), heroMediaId: null });
const parent = (a: string, b: string): FamilyEdge => ({ kind: 'parent_of', source: a, target: b });
const spouse = (a: string, b: string): FamilyEdge => ({ kind: 'spouse_of', source: a, target: b });

describe('layoutFamily', () => {
  it('places ancestors above, descendants below and spouses beside, with relation words', () => {
    const people = ['root', 'mum', 'dad', 'gran', 'wife', 'kid', 'sis'].map(p);
    const edges = [parent('mum', 'root'), parent('dad', 'root'), parent('gran', 'mum'), spouse('root', 'wife'), parent('root', 'kid'), parent('mum', 'sis')];
    const l = layoutFamily('root', people, edges)!;
    const g = Object.fromEntries(l.people.map((x) => [x.id, x.generation]));
    expect(g).toEqual({ root: 0, mum: -1, dad: -1, gran: -2, wife: 0, kid: 1, sis: 0 });
    const r = Object.fromEntries(l.people.map((x) => [x.id, x.relation]));
    expect(r).toMatchObject({ root: 'this character', mum: 'parent', gran: 'grandparent', wife: 'spouse', kid: 'child', sis: 'sibling' });
    // Spouses sit next to each other.
    const row0 = l.people.filter((x) => x.generation === 0).sort((a, b) => a.x - b.x).map((x) => x.id);
    expect(Math.abs(row0.indexOf('root') - row0.indexOf('wife'))).toBe(1);
    expect(l.lines.filter((x) => x.kind === 'parent_of')).toHaveLength(5);
  });

  it('never invents people or relations: unknown ids and self-links are ignored', () => {
    const l = layoutFamily('a', [p('a'), p('b')], [parent('a', 'ghost'), parent('a', 'a'), spouse('a', 'b')])!;
    expect(l.people.map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(l.lines).toEqual([{ kind: 'spouse_of', from: 'a', to: 'b' }]);
  });

  it('tolerates cycles and caps the generations, marking people with more family', () => {
    const ids = Array.from({ length: MAX_GENERATIONS + 3 }, (_, i) => `g${i}`);
    const edges = ids.slice(1).map((id, i) => parent(id, ids[i]!)); // g1 is parent of g0, g2 of g1, …
    edges.push(parent('g0', 'g1')); // a cycle: g0 also recorded as a parent of its own parent
    const l = layoutFamily('g0', ids.map(p), edges)!;
    expect(Math.min(...l.people.map((x) => x.generation))).toBe(-MAX_GENERATIONS);
    expect(l.people.find((x) => x.generation === -MAX_GENERATIONS)!.more).toBe(true);
    // The cycle edge draws no line (it would point upwards).
    expect(l.lines.some((x) => x.from === 'g0' && x.to === 'g1')).toBe(false);
  });

  it('returns null when the root is not readable', () => {
    expect(layoutFamily('missing', [p('a')], [])).toBeNull();
  });
});
