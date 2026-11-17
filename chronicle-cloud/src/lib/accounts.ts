// Players who have joined on this device, so a shared tablet or laptop can switch between them.
// Each entry keeps that player's own refresh token (the same secret supabase-js already keeps for
// the active player in this browser). Only accounts that really joined here, with their own
// invitation, are listed: picking a name is never enough to become someone.

export interface SavedAccount {
  userId: string;
  name: string;
  refreshToken: string;
  savedAt: number;
}

const KEY = 'chronicle-accounts';
export const MAX_SAVED_ACCOUNTS = 6;

function read(): SavedAccount[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((a): a is SavedAccount =>
      !!a && typeof a === 'object' && typeof (a as SavedAccount).userId === 'string' && typeof (a as SavedAccount).name === 'string'
      && typeof (a as SavedAccount).refreshToken === 'string' && typeof (a as SavedAccount).savedAt === 'number');
  } catch {
    return [];
  }
}

function write(list: SavedAccount[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Private mode or storage full: switching just is not offered.
  }
}

export function savedAccounts(): SavedAccount[] {
  return read().sort((a, b) => a.name.localeCompare(b.name));
}

/** Add or update an account; the most recently used ones are kept when the list is full. */
export function rememberAccount(account: Omit<SavedAccount, 'savedAt'>, now = Date.now()): void {
  const rest = read().filter((a) => a.userId !== account.userId);
  const next = [{ ...account, savedAt: now }, ...rest].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_SAVED_ACCOUNTS);
  write(next);
}

export function forgetAccount(userId: string): void {
  write(read().filter((a) => a.userId !== userId));
}
