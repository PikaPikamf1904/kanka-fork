import { describe, expect, it } from 'vitest';
import { orderByDocument, positionLabel, stepIndex, swipeDelta } from './lightbox.ts';

describe('picture viewer helpers', () => {
  it('orders entries by the comparator, regardless of registration order', () => {
    // Stand-ins for DOM nodes: the comparator reads a position the way compareDocumentPosition would.
    const node = (pos: number) => ({ pos }) as unknown as Node;
    const compare = (a: Node, b: Node) => (a as unknown as { pos: number }).pos - (b as unknown as { pos: number }).pos;
    const registered = [
      { id: 'c', el: node(30) },
      { id: 'a', el: node(10) },
      { id: 'd', el: node(40) },
      { id: 'b', el: node(20) },
    ];
    expect(orderByDocument(registered, compare).map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(registered.map((e) => e.id)).toEqual(['c', 'a', 'd', 'b']); // input is not mutated
  });

  it('cycles in both directions', () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });

  it('reads swipes with a 40px threshold and ignores vertical drags', () => {
    expect(swipeDelta(-60, 5)).toBe(1);
    expect(swipeDelta(60, -5)).toBe(-1);
    expect(swipeDelta(-39, 0)).toBe(0);
    expect(swipeDelta(-40, 0)).toBe(1);
    expect(swipeDelta(50, 80)).toBe(0);
    expect(swipeDelta(0, 0)).toBe(0);
  });

  it('labels the position', () => {
    expect(positionLabel(2, 7)).toBe('3 of 7');
  });
});
