// Reads a Gazette package: one Markdown file holding several complete, already approved stories.
// Nothing here rewrites a story. The body is the text exactly as written, between the byline block and
// the next story (only the blank lines and the `---` rule around it are removed).
//
// Layout of each story (anything before the first story heading, such as instructions, is ignored):
//
//   ## 2026-11-26 05:45 MST — Headline
//   *Subtitle (optional)*
//   **By Name, Title**
//   **Reliability: Rumor**
//   **Section: War**            (optional; otherwise the DM chooses)
//   …body…
//   ---
//
// A top-level heading ("# Notes", "# Letters", …) ends the story before it: anything under it, up to
// the next story heading, is not part of any story. Story bodies may use 
import type { NewsReliability, NewsSection } from './gazette.ts';
import { SECTIONS, STAFF } from './gazette.ts';
import { zonedToUtc } from './schedule.ts';

export interface PackageStory {
  /** Position in the file, from 1. */
  index: number;
  headline: string;
  subtitle: string;
  byline: string;
  /** Staff key whose name and title match the byline exactly, or null. */
  reporter: string | null;
  reliability: NewsReliability | null;
  section: NewsSection | null;
  /** The suggested release instant (ISO), read in the campaign time zone, or null. */
  suggestedAt: string | null;
  body: string;
  /** Why this story cannot be imported as it stands. */
  problems: string[];
}

const HEADING = /^##\s+(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?(?:\s+([A-Za-z/_+-]+))?\s*[—–-]\s*(.+?)\s*$/;
const RELIABILITY: Record<string, NewsReliability> = {
  rumor: 'rumor', rumour: 'rumor', unconfirmed: 'rumor',
  satire: 'satire', editorial: 'satire', opinion: 'satire',
  confirmed: 'confirmed', reported: 'confirmed',
  correction: 'correction',
};
/** Zone labels that mean "Arizona time" alongside the campaign zone; anything else is read as written. */
const ZONE_LABELS: Record<string, string> = { MST: 'America/Phoenix', AZ: 'America/Phoenix', UTC: 'UTC', Z: 'UTC', GMT: 'UTC' };

const strong = (line: string) => /^\*\*(.+?)\*\*\s*$/.exec(line.trim().replace(/\s{2,}$/, ''))?.[1]?.trim() ?? null;
const italic = (line: string) => /^\*([^*].*?)\*\s*$/.exec(line.trim())?.[1]?.trim() ?? /^_([^_].*?)_\s*$/.exec(line.trim())?.[1]?.trim() ?? null;
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The staff key for "Name, Title" (both must match a roster entry exactly, ignoring case and spacing). */
export function reporterForByline(byline: string): string | null {
  const b = norm(byline.replace(/^by\s+/i, ''));
  return STAFF.find((r) => norm(`${r.name}, ${r.title}`) === b)?.key ?? null;
}

export function parseGazettePackage(markdown: string, campaignZone: string): { stories: PackageStory[]; notes: string[] } {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const starts = lines.map((l, i) => (HEADING.test(l) ? i : -1)).filter((i) => i >= 0);
  const notes: string[] = [];
  if (starts.length === 0) notes.push('No stories found. Each story starts with a heading like "## 2026-11-26 05:45 MST — Headline".');
  const stories = starts.map((start, n) => {
    const next = starts[n + 1] ?? lines.length;
    // A top-level "# " heading closes the story (notes or letters after the last story must not be printed).
    let end = next;
    for (let k = start + 1; k < next; k++) if (/^#\s/.test(lines[k]!)) { end = k; break; }
    const m = HEADING.exec(lines[start]!)!;
    const [, date, hh, mm, zoneLabel, headline] = m;
    const problems: string[] = [];
    let i = start + 1;
    const skipBlank = () => { while (i < end && lines[i]!.trim() === '') i++; };
    skipBlank();
    let subtitle = '';
    const sub = i < end ? italic(lines[i]!) : null;
    if (sub !== null) { subtitle = sub; i++; skipBlank(); }
    let byline = '';
    let reliability: NewsReliability | null = null;
    let section: NewsSection | null = null;
    // The block of bold label lines under the subtitle: byline, reliability, optional section.
    for (; i < end; i++) {
      const s = strong(lines[i]!);
      if (s === null) break;
      const label = /^(reliability|section)\s*:\s*(.+)$/i.exec(s);
      if (label?.[1]!.toLowerCase() === 'reliability') reliability = RELIABILITY[label[2]!.trim().toLowerCase()] ?? null;
      else if (label?.[1]!.toLowerCase() === 'section') {
        const want = norm(label[2]!);
        section = SECTIONS.find((x) => norm(x.key) === want || norm(x.label) === want || norm(x.short) === want)?.key ?? null;
        if (!section) problems.push(`Unknown section "${label[2]!.trim()}".`);
      } else if (/^by\s+/i.test(s) && !byline) byline = s.replace(/^by\s+/i, '').trim();
      else break;
    }
    // Body: the rest, verbatim, without the surrounding blank lines and the closing --- rule.
    const rest = lines.slice(i, end);
    while (rest.length && rest[0]!.trim() === '') rest.shift();
    while (rest.length && (rest.at(-1)!.trim() === '' || /^-{3,}\s*$/.test(rest.at(-1)!))) rest.pop();
    const body = rest.join('\n');

    const reporter = byline ? reporterForByline(byline) : null;
    if (!byline) problems.push('No byline ("**By Name, Title**").');
    else if (!reporter) problems.push(`The byline "${byline}" is not on the Gazette staff list.`);
    if (!reliability) problems.push('No reliability ("**Reliability: Rumor**", Satire, Confirmed or Correction).');
    if (!body.trim()) problems.push('The story has no text.');
    if (headline!.length > 200) problems.push('The headline is longer than 200 characters.');
    if (subtitle.length > 200) problems.push('The subtitle is longer than 200 characters.');
    if (body.length > 30000) problems.push('The story is longer than 30,000 characters.');

    let suggestedAt: string | null = null;
    if (hh !== undefined) {
      const zone = zoneLabel ? ZONE_LABELS[zoneLabel.toUpperCase()] ?? zoneLabel : campaignZone;
      const at = zonedToUtc(`${date}T${hh.padStart(2, '0')}:${mm}`, zone);
      if (at) suggestedAt = at.toISOString();
      else problems.push(`The date "${date} ${hh}:${mm}" is not valid.`);
    }
    return { index: n + 1, headline: headline!, subtitle, byline, reporter, reliability, section, suggestedAt, body, problems };
  });
  return { stories, notes };
}

/** Headlines repeated inside the package, or already on the desk or in the Gazette (case and spacing ignored). */
export function duplicateHeadlines(stories: PackageStory[], existing: string[]): Map<number, string> {
  const taken = new Set(existing.map(norm));
  const seen = new Map<string, number>();
  const dup = new Map<number, string>();
  for (const s of stories) {
    const k = norm(s.headline);
    if (taken.has(k)) dup.set(s.index, 'Already on the news desk or in the Gazette.');
    else if (seen.has(k)) dup.set(s.index, `Same headline as story ${seen.get(k)} in this file.`);
    else seen.set(k, s.index);
  }
  return dup;
}
