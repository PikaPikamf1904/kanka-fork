// Personal invitation links (DM side) and joining with one (player side).
import { supabase } from './supabase.ts';
import type { Invitation } from './inviteStatus.ts';

export { invitationStatus, type Invitation, type InvitationStatus } from './inviteStatus.ts';

export interface MemberDevice {
  id: string;
  user_id: string;
  label: string;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export const inviteLink = (token: string, origin = window.location.origin) => `${origin}/join#${token}`;

/** True when the database does not have the invitations migration yet (the feature hides itself). */
const missing = (error: { code?: string } | null) => error?.code === 'PGRST202' || error?.code === '42P01' || error?.code === 'PGRST205';

export async function listInvitations(): Promise<Invitation[] | null> {
  const { data, error } = await supabase
    .from('player_invitations')
    .select('id, display_name, member_user_id, created_at, expires_at, used_at, revoked_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (missing(error)) return null;
  if (error) throw new Error(error.message);
  return data as Invitation[];
}

export async function listDevices(): Promise<MemberDevice[]> {
  const { data, error } = await supabase
    .from('member_devices')
    .select('id, user_id, label, created_at, last_seen_at, revoked_at')
    .order('created_at', { ascending: true });
  if (missing(error)) return [];
  if (error) throw new Error(error.message);
  return data as MemberDevice[];
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export interface NewInvitation { id: string; token: string; display_name: string; expires_at: string }

export const createInvitation = (name: string, days: number) =>
  rpc<NewInvitation>('create_player_invitation', { p_display_name: name, p_member: null, p_valid_days: days });
export const inviteAnotherDevice = (memberId: string, days: number) =>
  rpc<NewInvitation>('create_player_invitation', { p_display_name: null, p_member: memberId, p_valid_days: days });
export const regenerateInvitation = (id: string, days: number) =>
  rpc<NewInvitation>('regenerate_player_invitation', { p_invitation: id, p_valid_days: days });
export const cancelInvitation = (id: string) => rpc<void>('revoke_player_invitation', { p_invitation: id });
export const signOutDevice = (id: string) => rpc<void>('revoke_member_device', { p_device: id });

/** This device's state as the database sees it; 'untracked' for devices that did not join by invitation. */
export async function deviceStatus(): Promise<'ok' | 'revoked' | 'untracked'> {
  const { data, error } = await supabase.rpc('touch_device');
  if (error) return 'untracked';
  return data === 'revoked' ? 'revoked' : data === 'ok' ? 'ok' : 'untracked';
}

interface JoinAnswer { displayName?: string; returning?: boolean; session?: { access_token: string; refresh_token: string }; error?: string }

async function postJoin(token: string, action: 'preview' | 'join'): Promise<JoinAnswer> {
  const res = await fetch('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, action }),
  });
  const body = (await res.json().catch(() => ({}))) as JoinAnswer;
  if (!res.ok) throw new Error(body.error ?? 'This invitation link cannot be used. Ask your DM for a new link.');
  return body;
}

export async function previewInvitation(token: string): Promise<{ displayName: string; returning: boolean }> {
  const body = await postJoin(token, 'preview');
  return { displayName: body.displayName ?? '', returning: !!body.returning };
}

export async function acceptInvitation(token: string): Promise<void> {
  const body = await postJoin(token, 'join');
  if (!body.session) throw new Error('Could not start your session. Please try again.');
  const { error } = await supabase.auth.setSession({ access_token: body.session.access_token, refresh_token: body.session.refresh_token });
  if (error) throw new Error('Could not start your session. Please try again.');
}
