// Pure helpers for invitation links (no Supabase import, so they can be unit-tested).

export interface Invitation {
  id: string;
  display_name: string;
  member_user_id: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

export type InvitationStatus = 'waiting' | 'used' | 'expired' | 'cancelled';

export function invitationStatus(inv: Invitation, now = Date.now()): InvitationStatus {
  if (inv.used_at) return 'used';
  if (inv.revoked_at) return 'cancelled';
  if (new Date(inv.expires_at).getTime() <= now) return 'expired';
  return 'waiting';
}

