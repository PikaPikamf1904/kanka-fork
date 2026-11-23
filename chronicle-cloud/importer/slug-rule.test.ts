// Every place that turns a title into a page address must agree, or links written with a title
// point at an address no page has (as happened with "Jenna's" -> "jennas" vs "jenna-s").
import { describe, expect, it } from 'vitest';
import { slugify as site } from '../src/lib/slug.ts';
import { slugify as lore } from '../src/lib/loreImport.ts';
import { slugify as kanka } from './lib.ts';

const SAMPLES = ['Jenna’s Silver Pendant', "The Dragon Queen's Claim", 'Vogler', '  Harbour   Town!! ', 'A_b c', '--x--', 'Ünïcode & Co.'];

describe('one address rule', () => {
  it('the website, the lore importer and the Kanka importer give the same address', () => {
    for (const t of SAMPLES) {
      expect(lore(t), t).toBe(site(t));
      expect(kanka(t), t).toBe(site(t));
    }
  });
  it('apostrophes are dropped, so imported addresses stay as they are', () => {
    expect(site('Jenna’s Silver Pendant')).toBe('jennas-silver-pendant');
    expect(site("The Dragon Queen's Claim")).toBe('the-dragon-queens-claim');
    expect(site("Vogler's Boats Reach Kalaman")).toBe('voglers-boats-reach-kalaman');
  });
});
