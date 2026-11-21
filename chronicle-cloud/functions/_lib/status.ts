// Maintenance status for the website notice: on while MAINTENANCE_MODE=on in the Pages
// environment (a manual switch that works even if the database is down). The DM's own switch in
// Wiki settings is the everyday one and lives in the database (public.maintenance_switch()).
// Visitors only learn whether to show the notice; nothing else.

export interface StatusEnv {
  MAINTENANCE_MODE?: string;
}

export const NOTICE =
  'Declan is currently performing maintenance on Chronicle. Some features may be temporarily unavailable or behave unexpectedly. Please save your work before refreshing.';

export function readStatus(env: StatusEnv): { notice: boolean; message: string | null } {
  const on = (env.MAINTENANCE_MODE ?? '').toLowerCase() === 'on';
  return { notice: on, message: on ? NOTICE : null };
}
