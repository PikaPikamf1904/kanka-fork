import { describe, expect, it } from 'vitest';
import { paletteItems, score, type PaletteCommand } from './commands.ts';

const commands: PaletteCommand[] = [
  { id: 'graph', label: 'Knowledge graph', to: '/graph', keywords: 'connections map of pages' },
  { id: 'az', label: 'A–Z index', to: '/a-z', keywords: 'alphabet directory' },
  { id: 'tidy', label: 'Tidy up the wiki', to: '/dm/tidy', dmOnly: true },
];

describe('command palette', () => {
  it('scores starts, word starts and letters in order', () => {
    expect(score('Knowledge graph', 'know')).toBe(3);
    expect(score('Knowledge graph', 'gra')).toBe(2);
    expect(score('Knowledge graph', 'kgr')).toBe(1);
    expect(score('Knowledge graph', 'xyz')).toBe(0);
    expect(score('Élodie', 'elo')).toBe(3);
  });

  it('hides DM commands from players, puts pages first when searching, and drops duplicates', () => {
    expect(paletteItems('', commands, [], false).map((i) => i.to)).toEqual(['/a-z', '/graph']);
    expect(paletteItems('tidy', commands, [], true).map((i) => i.to)).toEqual(['/dm/tidy']);
    expect(paletteItems('tidy', commands, [], false)).toEqual([]);
    const items = paletteItems('alph', commands, [{ slug: 'alpha', title: 'Alpha Keep', typeLabel: 'Location' }], false);
    expect(items.map((i) => i.to)).toEqual(['/wiki/alpha', '/a-z']);
  });
});
