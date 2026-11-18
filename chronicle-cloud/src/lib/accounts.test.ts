import { beforeEach, describe, expect, it } from 'vitest';
import { forgetAccount, MAX_SAVED_ACCOUNTS, rememberAccount, savedAccounts } from './accounts.ts';
import { invitationStatus, type Invitation } from './inviteStatus.ts';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

describe('saved accounts on a shared device', () => {
  it('remembers, updates and forgets players, sorted by name', () => {
    rememberAccount({ userId: 'b', name: 'Sybil', refreshToken: 'r1' }, 1);
    rememberAccount({ userId: 'a', name: 'Eliza', refreshToken: 'r2' }, 2);
    rememberAccount({ userId: 'b', name: 'Sybil', refreshToken: 'r3' }, 3);
    expect(savedAccounts().map((a) => [a.name, a.refreshToken])).toEqual([['Eliza', 'r2'], ['Sybil', 'r3']]);
    forgetAccount('a');
    expect(savedAccounts().map((a) => a.userId)).toEqual(['b']);
  });

  it('keeps only the most recently used when full, and ignores damaged storage', () => {
    for (let i = 0; i < MAX_SAVED_ACCOUNTS + 2; i++) rememberAccount({ userId: `u${i}`, name: `P${i}`, refreshToken: 't' }, i);
    expect(savedAccounts()).toHaveLength(MAX_SAVED_ACCOUNTS);
    expect(savedAccounts().some((a) => a.userId === 'u0')).toBe(false);
    store.set('chronicle-accounts', '{not json');
    expect(savedAccounts()).toEqual([]);
    store.set('chronicle-accounts', JSON.stringify([{ userId: 1 }]));
    expect(savedAccounts()).toEqual([]);
  });
});

describe('invitation status', () => {
  const base: Invitation = { id: 'i', display_name: 'Eliza', member_user_id: null, created_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-08T00:00:00Z', used_at: null, revoked_at: null };
  const now = Date.parse('2026-01-02T00:00:00Z');
  it('is waiting, used, cancelled or expired', () => {
    expect(invitationStatus(base, now)).toBe('waiting');
    expect(invitationStatus({ ...base, used_at: '2026-01-01T01:00:00Z' }, now)).toBe('used');
    expect(invitationStatus({ ...base, revoked_at: '2026-01-01T01:00:00Z' }, now)).toBe('cancelled');
    expect(invitationStatus(base, Date.parse('2026-01-09T00:00:00Z'))).toBe('expired');
  });
});
