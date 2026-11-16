import { describe, expect, it } from 'vitest';
import { browsableValue, factsHref, valueCounts } from './facts.ts';

describe('facts', () => {
  it('only short plain values are browsable', () => {
    for (const v of ['Elf', 'The Crown', 'Half-orc']) expect(browsableValue(v)).toBe(true);
    for (const v of ['', '[[port-vellmoor]]', '12', '3rd of Frost, 1021', 'https://example.com', 'A very long sentence that goes on and on and on.']) {
      expect(browsableValue(v), v).toBe(false);
    }
  });
  it('builds a stable address and counts values case-insensitively', () => {
    expect(factsHref(' Race ', 'Elf')).toBe('/facts?label=Race&value=Elf');
    expect(valueCounts(['Elf', 'elf', 'Dwarf', '[[x]]', 'Human', 'Human', 'Human'])).toEqual([
      { value: 'Human', count: 3 }, { value: 'Elf', count: 2 }, { value: 'Dwarf', count: 1 },
    ]);
  });
});
