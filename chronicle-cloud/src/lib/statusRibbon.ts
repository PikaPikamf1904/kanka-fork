// A page's "Status" infobox field, read as a world-state ribbon (Deceased, Missing, …). Only the
// field's own text decides it, and the field is read under Row Level Security like any other, so a
// status the DM keeps hidden never shows. Unrecognised statuses stay plain text.

export type RibbonKind = 'deceased' | 'missing' | 'destroyed' | 'captured' | 'rumoured' | 'retired' | 'inactive' | 'unknown';

const WORDS: [RibbonKind, string, RegExp][] = [
  ['deceased', 'Deceased', /\b(dead|deceased|died|killed|slain|fallen in battle|late)\b/i],
  ['destroyed', 'Destroyed', /\b(destroyed|ruined|razed|sunk|lost to|fallen|abandoned|disbanded|dissolved)\b/i],
  ['missing', 'Missing', /\b(missing|lost|vanished|disappeared|whereabouts unknown)\b/i],
  ['captured', 'Captured', /\b(captured|imprisoned|jailed|prisoner|held captive)\b/i],
  ['rumoured', 'Rumoured', /\b(rumou?red|unconfirmed|legendary|mythical|disputed)\b/i],
  ['retired', 'Retired', /\b(retired|in hiding)\b/i],
  ['inactive', 'Inactive', /\b(inactive|dormant|disused)\b/i],
  ['unknown', 'Unknown', /^\s*(unknown|fate unknown|status unknown)\s*\.?\s*$/i],
];

export interface Ribbon { kind: RibbonKind; label: string; text: string }

/** The ribbon for a status text, or null when it is empty or not one of the known states. */
export function ribbonFor(status: string | null | undefined): Ribbon | null {
  const text = (status ?? '').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').trim();
  // Living / active states are not ribbons ("inactive" is, and is matched as a whole word below).
  if (!text || (/\b(alive|active|well)\b/i.test(text) && !/\b(not|no longer)\b/i.test(text))) return null;
  for (const [kind, label, re] of WORDS) if (re.test(text)) return { kind, label, text };
  return null;
}

/** The status field of a page's infobox (Status or Condition), if the reader can see one. */
export function statusFromInfobox(fields: { label: string; value: string }[]): string | null {
  const f = fields.find((x) => ['status', 'condition', 'state'].includes(x.label.trim().toLowerCase()) && x.value.trim());
  return f ? f.value : null;
}
