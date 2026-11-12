import { describe, expect, it } from 'vitest';
import { latestDatedSession } from './home.ts';

describe('latestDatedSession', () => {
  it('uses played dates, not import order or unknown dates', () => {
    const sessions = [
      { id: 'newer', session_date: '2024-04-20' },
      { id: 'older-imported-later', session_date: '2024-02-02' },
      { id: 'unknown', session_date: null },
    ];
    expect(latestDatedSession(sessions)?.id).toBe('newer');
  });
  it('does not guess when all session dates are unknown', () => {
    expect(latestDatedSession([{ id: 'unknown', session_date: null }])).toBeNull();
    expect(latestDatedSession([])).toBeNull();
  });
});
