import { describe, expect, it } from 'vitest';
import { ribbonFor, statusFromInfobox } from './statusRibbon.ts';

describe('ribbonFor', () => {
  it('recognises world states in free text, including links', () => {
    expect(ribbonFor('Dead')?.kind).toBe('deceased');
    expect(ribbonFor('Slain at [[the-ford|the Ford]]')?.text).toBe('Slain at the Ford');
    expect(ribbonFor('Missing since the flood')?.label).toBe('Missing');
    expect(ribbonFor('Razed by dragonfire')?.kind).toBe('destroyed');
    expect(ribbonFor('Imprisoned in Vellmoor')?.kind).toBe('captured');
    expect(ribbonFor('Rumored')?.kind).toBe('rumoured');
  });
  it('shows nothing for empty, living or unrecognised statuses', () => {
    for (const s of ['', '   ', 'Alive', 'Active', 'Mayor of the port', 'Unknown origin', null, undefined]) expect(ribbonFor(s)).toBeNull();
    expect(ribbonFor('Unknown')?.label).toBe('Unknown');
    expect(ribbonFor('Fate unknown')?.kind).toBe('unknown');
    expect(ribbonFor('Inactive')?.label).toBe('Inactive');
    expect(ribbonFor('Dormant volcano')?.kind).toBe('inactive');
    expect(ribbonFor('Retired adventurer')?.kind).toBe('retired');
  });
  it('still marks "no longer active" style statuses', () => {
    expect(ribbonFor('No longer active, disbanded')?.kind).toBe('destroyed');
  });
  it('reads Status or Condition from the infobox', () => {
    expect(statusFromInfobox([{ label: 'Race', value: 'Elf' }, { label: ' condition ', value: 'Missing' }])).toBe('Missing');
    expect(statusFromInfobox([{ label: 'Status', value: '' }])).toBeNull();
  });
});
