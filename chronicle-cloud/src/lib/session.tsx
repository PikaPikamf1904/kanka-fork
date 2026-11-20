import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { forgetAccount, rememberAccount, savedAccounts } from './accounts.ts';
import { clearMediaUrlCache, clearSettingsRequest } from './api.ts';
import { lockDmGate } from './dmGate.ts';
import { deviceStatus } from './invitations.ts';
import { clearWanderHistory } from './wander.ts';
import { supabase } from './supabase.ts';

export type AccessState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  /** Access could not be checked (network or server error). Not the same as having no access. */
  | { kind: 'error' }
  /** Signed in, but not (or no longer) an active member. */
  | { kind: 'no-access'; reason: 'revoked' | 'not-member' }
  /** DM account that has MFA and has not completed the second step this session. */
  | { kind: 'needs-mfa' }
  | { kind: 'member'; role: 'player' | 'dm'; displayName: string; userId: string };

interface SessionContextValue {
  state: AccessState;
  session: Session | null;
  /** DM-only UI toggle: show pages through the player preview where available. */
  playerPreview: boolean;
  setPlayerPreview(value: boolean): void;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
  /** Switch to another player who joined on this device. Throws if that sign-in has ended. */
  switchAccount(userId: string): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

async function loadAccess(session: Session | null): Promise<AccessState> {
  if (!session) return { kind: 'signed-out' };
  // The role comes from the database (campaign_members), never from the token or user metadata.
  // Asked together: the device check only reads this session's own device row, so it is safe for
  // every role, and starting it at once saves a round trip on every visit.
  const [{ data, error }, device] = await Promise.all([
    supabase.from('campaign_members').select('role, display_name, revoked_at').eq('user_id', session.user.id).maybeSingle(),
    deviceStatus(),
  ]);
  if (error) throw new Error(error.message);
  if (!data) return { kind: 'no-access', reason: 'not-member' };
  if (data.revoked_at) return { kind: 'no-access', reason: 'revoked' };
  // A device the DM signed out keeps a valid Auth session, but the database refuses it everything.
  if (data.role === 'player' && device === 'revoked') return { kind: 'no-access', reason: 'revoked' };
  if (data.role === 'dm') {
    const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.data && aal.data.nextLevel === 'aal2' && aal.data.currentLevel !== 'aal2') return { kind: 'needs-mfa' };
  }
  // Query builders only run when awaited or then()-ed.
  void supabase.rpc('touch_member').then(() => undefined);
  return { kind: 'member', role: data.role, displayName: data.display_name, userId: session.user.id };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<AccessState>({ kind: 'loading' });
  const [playerPreview, setPlayerPreview] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    try {
      setState(await loadAccess(data.session));
    } catch {
      // A failed check says nothing about membership; offer a retry, never a sign-out.
      setState({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    // refresh() only sets state after awaiting Supabase, and this effect subscribes to an
    // external system (auth events), which is what effects are for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      // Keep this player's saved sign-in current, so switching back later still works.
      if (next && savedAccounts().some((a) => a.userId === next.user.id)) {
        const known = savedAccounts().find((a) => a.userId === next.user.id)!;
        rememberAccount({ userId: next.user.id, name: known.name, refreshToken: next.refresh_token });
      }
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'MFA_CHALLENGE_VERIFIED' || event === 'USER_UPDATED') {
        // Signed media URLs belong to the previous identity; never reuse them.
        clearMediaUrlCache();
        clearSettingsRequest();
        clearWanderHistory();
        // Defer: calling Supabase inside the callback can deadlock the auth lock.
        setTimeout(() => void refresh(), 0);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  // Players who joined on this device are remembered, so a shared device can switch between them.
  useEffect(() => {
    // session and state update in two steps; only pair a name with a token when both are the same user.
    if (state.kind === 'member' && state.role === 'player' && session && session.user.id === state.userId) {
      rememberAccount({ userId: state.userId, name: state.displayName, refreshToken: session.refresh_token });
    }
    if (state.kind === 'no-access' && state.reason === 'revoked' && session) forgetAccount(session.user.id);
  }, [state, session]);

  const signOut = useCallback(async () => {
    const current = (await supabase.auth.getSession()).data.session;
    const isPlayer = state.kind !== 'member' || state.role === 'player';
    // A player leaves only this device; their other devices stay signed in.
    await supabase.auth.signOut({ scope: isPlayer ? 'local' : 'global' });
    if (!isPlayer) await lockDmGate();
    if (current) forgetAccount(current.user.id);
    setPlayerPreview(false);
    await refresh();
  }, [refresh, state]);

  const switchAccount = useCallback(async (userId: string) => {
    const target = savedAccounts().find((a) => a.userId === userId);
    // Handing the device to a player closes the DM screen on it.
    if (state.kind === 'member' && state.role === 'dm') await lockDmGate();
    if (!target) throw new Error('That player is not signed in on this device.');
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: target.refreshToken });
    // Never show one player's name over another player's session.
    if (!error && data.session && data.session.user.id !== userId) {
      forgetAccount(userId);
      await refresh();
      throw new Error('That saved sign-in was not valid and has been removed.');
    }
    if (error || !data.session) {
      forgetAccount(userId);
      await refresh();
      throw new Error(`${target.name} is no longer signed in on this device. Use their invitation link again.`);
    }
    rememberAccount({ userId, name: target.name, refreshToken: data.session.refresh_token });
    clearMediaUrlCache();
    clearSettingsRequest();
    clearWanderHistory();
    setPlayerPreview(false);
    await refresh();
  }, [refresh, state]);

  const value = useMemo(
    () => ({ state, session, playerPreview, setPlayerPreview, refresh, signOut, switchAccount }),
    [state, session, playerPreview, refresh, signOut, switchAccount],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export function useIsDm(): boolean {
  const { state, playerPreview } = useSession();
  return state.kind === 'member' && state.role === 'dm' && !playerPreview;
}

/** Enroll this device with the shared player code via the server function. */
export async function enrollWithCode(code: string, displayName: string, turnstileToken?: string): Promise<void> {
  const res = await fetch('/api/enroll', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, displayName, turnstileToken }),
  });
  const body = (await res.json().catch(() => ({}))) as { session?: { access_token: string; refresh_token: string }; error?: string };
  if (!res.ok || !body.session) throw new Error(body.error ?? 'That access code was not accepted.');
  const { error } = await supabase.auth.setSession({
    access_token: body.session.access_token,
    refresh_token: body.session.refresh_token,
  });
  if (error) throw new Error('Could not start your session. Please try again.');
}
