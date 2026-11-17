import { describe, expect, it } from 'vitest';
import { moveBefore, moveItem } from './savedPages.ts';

describe('moveItem', () => {
  it('moves up and down by one', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });
  it('stays put at the ends', () => {
    const list = ['a', 'b'];
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, 5, -1)).toBe(list);
  });
});

describe('moveBefore', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('drops an item onto another', () => {
    expect(moveBefore(list, 'c', 'a').map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(moveBefore(list, 'a', 'c').map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
  it('ignores unknown or identical ids', () => {
    expect(moveBefore(list, 'a', 'a')).toBe(list);
    expect(moveBefore(list, 'x', 'a')).toBe(list);
  });
});
