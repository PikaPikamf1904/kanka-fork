import { describe, expect, it } from 'vitest';
import { d20, describe as describeRoll, roll } from './dice.ts';
import { fuzzyScore, rank } from './fuzzy.ts';
import { layout } from './graphLayout.ts';
import { add, changeHp, EMPTY, next, ordered, parseSaved, previous, remove, type Combatant } from './initiative.ts';

const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]!; };
const c = (id: string, init: number, extra: Partial<Combatant> = {}): Combatant => ({ id, name: id, init, hp: null, maxHp: null, note: '', player: false, ...extra });

describe('fuzzy matching', () => {
  it('matches characters in order, ignoring case and accents', () => {
    expect(fuzzyScore('cmv', 'Captain Merrin Vael')).not.toBeNull();
    expect(fuzzyScore('éla', 'Elara')).not.toBeNull();
    expect(fuzzyScore('xyz', 'Captain Merrin Vael')).toBeNull();
  });
  it('ranks prefixes and word starts above scattered matches', () => {
    const titles = ['Harbour Ledger', 'The Ashen Hand', 'Port Vellmoor', 'Captain Merrin Vael'];
    expect(rank('port', titles, (t) => t)[0]).toBe('Port Vellmoor');
    expect(rank('ah', titles, (t) => t)[0]).toBe('The Ashen Hand');
    expect(rank('', titles, (t) => t)).toHaveLength(4);
  });
});

describe('dice', () => {
  it('rolls sums, modifiers and keep-highest with the given random source', () => {
    // random() = (v - 0.5) / sides gives the face v.
    const r = roll('2d6+3', seq(0.1, 0.9));
    expect(r.terms[0]).toMatchObject({ rolls: [1, 6] });
    expect(r.total).toBe(10);
    const adv = roll(d20('advantage', 5), seq(0.2, 0.8));
    expect(adv.total).toBe(17 + 5);
    expect(describeRoll(adv)).toBe('2d20kh1 [5, 17] + 5');
    expect(roll(d20('disadvantage', -1), seq(0.2, 0.8)).total).toBe(5 - 1);
    expect(roll('4d6kh3', seq(0, 0.99, 0.5, 0.2)).total).toBe(6 + 4 + 2);
    expect(roll('d20', seq(0.999)).total).toBe(20);
    expect(roll('-2', seq(0)).total).toBe(-2);
  });
  it('refuses nonsense with a plain message', () => {
    expect(() => roll('')).toThrow(/2d6/);
    expect(() => roll('2x6')).toThrow(/Could not read/);
    expect(() => roll('500d6')).toThrow(/between 1 and 100/);
    expect(() => roll('2d1')).toThrow(/sides/);
    expect(() => roll('2d6kh3')).toThrow(/Keep between/);
  });
  it('uses the full range of each die', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(roll('d6').total);
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('initiative', () => {
  it('orders by initiative, keeps the active turn when someone joins, and counts rounds', () => {
    let e = add(add(add(EMPTY, c('a', 12)), c('b', 18)), c('c', 5));
    expect(ordered(e.combatants).map((x) => x.id)).toEqual(['b', 'a', 'c']);
    e = next(e); // a's turn
    e = add(e, c('d', 20)); // d goes first, but it is still a's turn
    expect(ordered(e.combatants)[e.active]!.id).toBe('a');
    e = next(next(e));
    expect(e.round).toBe(2);
    expect(ordered(e.combatants)[e.active]!.id).toBe('d');
    e = previous(e);
    expect(e.round).toBe(1);
  });
  it('removes combatants without skipping a turn and clamps hit points', () => {
    let e = add(add(add(EMPTY, c('a', 10)), c('b', 8, { hp: 7, maxHp: 10 })), c('c', 6));
    e = next(e); // b
    e = remove(e, 'a');
    expect(ordered(e.combatants)[e.active]!.id).toBe('b');
    e = changeHp(e, 'b', -20);
    expect(e.combatants.find((x) => x.id === 'b')!.hp).toBe(0);
    e = changeHp(e, 'b', 50);
    expect(e.combatants.find((x) => x.id === 'b')!.hp).toBe(10);
  });
  it('ignores damaged saved data', () => {
    expect(parseSaved('nope')).toEqual(EMPTY);
    expect(parseSaved({ combatants: [{ id: 'x', name: 'X', init: 'a' }], active: 9, round: -1 })).toEqual({
      combatants: [{ id: 'x', name: 'X', init: 0, hp: null, maxHp: null, note: '', player: false }], active: 0, round: 1,
    });
  });
});

describe('connections web layout', () => {
  it('is deterministic, inside the box and keeps linked nodes closer than unlinked ones', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'd', target: 'e' }];
    const one = layout(ids, edges);
    expect(layout(ids, edges)).toEqual(one);
    for (const p of one.values()) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1000);
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(700);
    }
    const dist = (p: string, q: string) => Math.hypot(one.get(p)!.x - one.get(q)!.x, one.get(p)!.y - one.get(q)!.y);
    expect(dist('a', 'b')).toBeLessThan(dist('a', 'f'));
  });
});
