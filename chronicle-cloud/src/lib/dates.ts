/** "17 October 2026" in the reader's own language; an empty string for a missing or bad date. */
export function longDate(value: string | null | undefined): string {
  if (!value) return '';
  // A plain date (session dates) must not shift a day in time zones west of UTC.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}
