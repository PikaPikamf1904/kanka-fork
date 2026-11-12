// The Goblin Gazette: fixed, original staff and vocabulary. No campaign content lives here; the
// stories themselves are pages in the wiki (type 'news') with their newspaper details.

export type NewsSection = 'breaking' | 'war' | 'local' | 'rumors' | 'interviews' | 'corrections';
export type NewsReliability = 'confirmed' | 'rumor' | 'satire' | 'correction';
export type NewsReviewState = 'draft' | 'in_review' | 'approved';

export const GAZETTE = {
  name: 'The Goblin Gazette',
  tagline: 'All the news that’s fit to steal.',
  description: 'Krynn’s most questionable news source.',
  price: 'One copper, or a shiny button',
};

export const SECTIONS: { key: NewsSection; label: string; short: string }[] = [
  { key: 'breaking', label: 'Breaking News', short: 'Breaking' },
  { key: 'war', label: 'War Dispatches', short: 'War' },
  { key: 'local', label: 'Local News', short: 'Local' },
  { key: 'rumors', label: 'Rumors', short: 'Rumors' },
  { key: 'interviews', label: 'Interviews', short: 'Interviews' },
  { key: 'corrections', label: 'Corrections', short: 'Corrections' },
];
export const sectionLabel = (s: NewsSection | string | undefined) => SECTIONS.find((x) => x.key === s)?.label ?? 'Local News';

/** What kind of reporting a story is. Shown to readers on every story. */
export const RELIABILITY: Record<NewsReliability, { label: string; stamp: string | null; note: string }> = {
  confirmed: { label: 'Reported', stamp: null, note: 'In-world reporting of events the party has seen or heard of.' },
  rumor: { label: 'Rumor', stamp: 'Unconfirmed', note: 'Gossip the Gazette has not checked. Not established fact.' },
  satire: { label: 'Editorial', stamp: 'Opinion', note: 'The editor’s opinion. Rarely fact, never modest.' },
  correction: { label: 'Correction', stamp: 'Correction', note: 'The Gazette admits a mistake, eventually.' },
};

export interface Reporter {
  key: string;
  name: string;
  title: string;
  /** One line under the byline. */
  sign: string;
  /** For the DM writing in this voice. */
  voice: string;
}

/** The newsroom. Original characters; keep their voices consistent between stories. */
export const STAFF: Reporter[] = [
  {
    key: 'editor', name: 'Gristlewick Snoot', title: 'Editor-in-Chief',
    sign: 'Has never once been wrong, in his own estimation.',
    voice: 'Grand, certain and frequently mistaken. Short declarations. Treats every rumor as confirmed and every correction as a personal attack. Uses “the Gazette” instead of “I”.',
  },
  {
    key: 'nib', name: 'Nib Twelve-Fingers', title: 'Chief Investigator',
    sign: 'Counts everything twice. Trusts nothing once.',
    voice: 'Breathless, suspicious, full of lists and connected dots. Finds patterns that are sometimes real. Asks questions nobody answered.',
  },
  {
    key: 'mossbottom', name: 'Mossbottom Quill', title: 'War Correspondent',
    sign: 'Reporting from a safe distance, then a safer one.',
    voice: 'Plain, accurate and frightened. The facts are right; the reporter is hiding behind them. Takes the war seriously and himself not at all.',
  },
  {
    key: 'pinchcheek', name: 'Madame Pinchcheek', title: 'Society & Gossip',
    sign: 'Knows everyone’s business. Understands very little of it.',
    voice: 'Warm, nosy, confidently confused. Gets names nearly right. Notices outfits, feuds and who left early, rarely why.',
  },
  {
    key: 'corrections', name: 'The Corrections Desk', title: 'Under Protest',
    sign: 'Staffed by whoever lost the coin toss.',
    voice: 'Grudging and brief. Admits the error, then blames someone else.',
  },
];
export const reporter = (key: string | undefined): Reporter =>
  STAFF.find((r) => r.key === key) ?? { key: key ?? '', name: 'A Gazette correspondent', title: 'Staff', sign: '', voice: '' };

export const REVIEW_LABEL: Record<NewsReviewState, string> = { draft: 'Draft', in_review: 'In review', approved: 'Approved' };
