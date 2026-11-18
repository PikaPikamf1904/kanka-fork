// Pure helpers for the A-Z index: which letter a title files under, which letters have entries,
// what the address (?letter=B&type=character&q=) means, and summary snippets.
import type { ArticleType } from './types.ts';

export const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

/** A-Z for titles starting with an English letter (any case); "#" for everything else (digits, accents, symbols). Matches the server filter, so no trimming. */
export function firstLetter(title: string): string {
  const c = title.charAt(0).toUpperCase();
  return /^[A-Z]$/.test(c) ? c : '#';
}

/** The letters that have at least one of the titles. */
export function lettersWithEntries(titles: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const t of titles) out.add(firstLetter(t));
  return out;
}

export interface IndexParams { letter: string | null; type: ArticleType | null; q: string }

/** Reads and validates the address; anything unknown is dropped rather than trusted. */
export function parseIndexParams(params: URLSearchParams, types: readonly string[]): IndexParams {
  const letter = (params.get('letter') ?? '').toUpperCase();
  const type = params.get('type') ?? '';
  return {
    letter: LETTERS.includes(letter) ? letter : null,
    type: types.includes(type) ? (type as ArticleType) : null,
    q: (params.get('q') ?? '').slice(0, 80),
  };
}

/** The address for a state; empty values are left out so the default view has a clean URL. */
export function indexSearch(p: Partial<IndexParams>): string {
  const out = new URLSearchParams();
  if (p.letter) out.set('letter', p.letter);
  if (p.type) out.set('type', p.type);
  if (p.q?.trim()) out.set('q', p.q.trim());
  const s = out.toString();
  return s ? `?${s}` : '';
}

/** Makes text safe inside an ilike pattern: the wildcards % and _ (and the escape character) stay literal. */
export function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** A short plain-text lead from a summary: wiki links and markdown marks removed, cut at a word. */
export function snippet(summary: string, max = 140): string {
  const plain = summary
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).trimEnd()}…`;
}

/** The letter to show when the address names none: the first letter that has entries. */
export function defaultLetter(available: Set<string>): string | null {
  return LETTERS.find((l) => available.has(l)) ?? null;
}
