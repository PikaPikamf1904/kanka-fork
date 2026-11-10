import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { clearMediaUrlCache } from './api.ts';
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
}

const SessionContext = createContext<SessionContextValue | null>(null);

async function loadAccess(session: Session | null): Promise<AccessState> {
  if (!session) return { kind: 'signed-out' };
  // The role comes from the database (campaign_members), never from the token or user metadata.
  const { data, error } = await supabase
    .from('campaign_members')
    .select('role, display_name, revoked_at')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { kind: 'no-access', reason: 'not-member' };
  if (data.revoked_at) return { kind: 'no-access', reason: 'revoked' };
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
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'MFA_CHALLENGE_VERIFIED' || event === 'USER_UPDATED') {
        // Signed media URLs belong to the previous identity; never reuse them.
        clearMediaUrlCache();
        // Defer: calling Supabase inside the callback can deadlock the auth lock.
        setTimeout(() => void refresh(), 0);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setPlayerPreview(false);
    await refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ state, session, playerPreview, setPlayerPreview, refresh, signOut }),
    [state, session, playerPreview, refresh, signOut],
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
