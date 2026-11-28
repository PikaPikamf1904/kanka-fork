import { describe, expect, it } from 'vitest';
import { questState } from './questState.ts';

describe('questState', () => {
  it('reads the live status phrases', () => {
    expect(questState('Open / unresolved')).toBe('open');
    expect(questState('In progress — first infiltration played')).toBe('open');
    expect(questState('Completed: party escaped with refugees')).toBe('done');
  });
  it('treats missing or unfamiliar text as unknown', () => {
    expect(questState(undefined)).toBe('unknown');
    expect(questState('  ')).toBe('unknown');
    expect(questState('Rumoured')).toBe('unknown');
  });
  it('is case-insensitive and tolerant', () => {
    expect(questState('ONGOING')).toBe('open');
    expect(questState('Closed')).toBe('done');
    expect(questState('Quest is resolved')).toBe('done');
  });
});
