// How a quest's free-text Status field reads on the home page. Tolerant on purpose: the DM writes
// phrases such as "Open / unresolved", "In progress — first infiltration played" or "Completed: party escaped".
export type QuestState = 'open' | 'done' | 'unknown';

export function questState(status: string | null | undefined): QuestState {
  const s = (status ?? '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (/^(completed?|closed|resolved|done|finished|failed|abandoned)\b/.test(s)) return 'done';
  if (/\b(open|unresolved|in progress|ongoing|active|underway|pending)\b/.test(s)) return 'open';
  if (/\b(completed?|closed|resolved|done|finished)\b/.test(s)) return 'done';
  return 'unknown';
}
