// The DM's website maintenance switch (20261117000700). The visitor text must match
// functions/_lib/status.ts NOTICE exactly (checked by a unit test).
import { supabase } from './supabase.ts';

export const MAINTENANCE_NOTICE =
  'Declan is currently performing maintenance on Chronicle. Some features may be temporarily unavailable or behave unexpectedly. Please save your work before refreshing.';

/** When the DM's switch is on, the time it turns itself off; otherwise null (also when not installed). */
export async function maintenanceUntil(): Promise<Date | null> {
  const { data, error } = await supabase.rpc('maintenance_switch');
  if (error || !data) return null;
  return new Date(data as string);
}

/** Fired on this page when the DM changes the switch, so the banner updates at once. */
export const MAINTENANCE_CHANGED = 'chronicle:maintenance-changed';

/** DM only: 0 turns it off; 15 to 480 minutes turns it on until then. */
export async function setMaintenance(minutes: number): Promise<Date | null> {
  const { data, error } = await supabase.rpc('set_maintenance', { p_minutes: minutes });
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(MAINTENANCE_CHANGED));
  return data ? new Date(data as string) : null;
}
