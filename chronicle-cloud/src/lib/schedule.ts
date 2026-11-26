// Publication times for the Gazette. The DM picks a wall-clock time in the CAMPAIGN's time zone;
// this turns it into an exact instant, which is what the database stores and compares with its own
// clock. A reader's device clock or zone never decides what is published.

/** A real IANA zone name, else 'UTC'. */
export function safeZone(tz: string | null | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

const parts = (ms: number, tz: string) => {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
};

/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetAt(ms: number, tz: string): number {
  const p = parts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * "2026-11-27T09:00" read as wall-clock time in `tz` → the exact instant. Like the standard
 * "compatible" rule: a time that does not exist (spring-forward gap) moves forward by the gap's
 * length; an ambiguous time (autumn overlap) takes the earlier of the two.
 */
export function zonedToUtc(local: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(wall);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || check.getUTCDate() !== d || check.getUTCMonth() !== mo - 1) return null;
  const zone = safeZone(tz);
  const DAY = 86_400_000;
  const before = offsetAt(wall - DAY, zone);
  const after = offsetAt(wall + DAY, zone);
  const readsBack = (utc: number) => {
    const p = parts(utc, zone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall;
  };
  const valid = [...new Set([before, after])].map((o) => wall - o).filter(readsBack).sort((a, b) => a - b);
  if (valid.length > 0) return new Date(valid[0]!);
  // In the gap: apply the offset from before the transition, which lands after the gap.
  return new Date(wall - before);
}

/** An instant as "YYYY-MM-DDTHH:mm" wall-clock time in `tz` (for a datetime-local input). */
export function utcToZoned(iso: string, tz: string): string {
  const p = parts(new Date(iso).getTime(), safeZone(tz));
  const z = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${z(p.year, 4)}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`;
}

/** "Fri 27 Nov, 09:00" in the campaign zone, with the zone name. */
export function formatInZone(iso: string, tz: string): string {
  const zone = safeZone(tz);
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  return `${s} (${zone})`;
}

/** The campaign's calendar day, "YYYY-MM-DD". Changes at local midnight in the campaign zone. */
export function campaignDay(now: Date, tz: string): string {
  return utcToZoned(now.toISOString(), tz).slice(0, 10);
}
