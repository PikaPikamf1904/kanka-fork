/** A transcript reference such as "(01:42–05:15)" at the end of a heading: source material for the
 *  DM, noise for readers. Returns the heading without it, and the reference on its own. */
export function splitTimestamp(heading: string): { text: string; source: string | null } {
  const m = /\s*[([]\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[–—-]\s*\d{1,2}:\d{2}(?::\d{2})?)?)\s*[)\]]\s*$/.exec(heading);
  return m ? { text: heading.slice(0, m.index).trim(), source: m[1]! } : { text: heading, source: null };
}
