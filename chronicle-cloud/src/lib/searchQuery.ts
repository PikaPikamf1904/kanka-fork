// Search operators on top of the database's web-search syntax ("quoted phrase", -word, or):
//   type:character (or the plural, "type:characters"), category:<name or address>
// The operators are taken out of the text sent to the database and applied to the results, which
// already passed Row Level Security.
import { slugify } from './slug.ts';
import { TEMPLATES, TYPE_ORDER } from './templates.ts';
import type { ArticleType } from './types.ts';

export interface ParsedSearch { text: string; types: ArticleType[]; categories: string[]; unknown: string[] }

const TYPE_WORDS = new Map<string, ArticleType>();
for (const t of TYPE_ORDER) {
  TYPE_WORDS.set(t, t);
  TYPE_WORDS.set(slugify(TEMPLATES[t].label), t);
  TYPE_WORDS.set(slugify(TEMPLATES[t].plural), t);
}
TYPE_WORDS.set('session', 'session');
TYPE_WORDS.set('sessions', 'session');

export function parseSearch(q: string): ParsedSearch {
  const types: ArticleType[] = [];
  const categories: string[] = [];
  const unknown: string[] = [];
  // Operators take one word or a quoted value: type:location, category:"Silver Quill".
  const text = q.replace(/(^|\s)(type|kind|category|cat):(?:"([^"]*)"|(\S+))/gi, (_m, pre: string, op: string, quoted?: string, word?: string) => {
    const value = (quoted ?? word ?? '').trim();
    if (/^(type|kind)$/i.test(op)) {
      const t = TYPE_WORDS.get(slugify(value));
      if (t) { if (!types.includes(t)) types.push(t); } else unknown.push(`${op}:${value}`);
    } else if (value) {
      const c = slugify(value);
      if (!categories.includes(c)) categories.push(c);
    }
    return pre;
  });
  return { text: text.replace(/\s+/g, ' ').trim(), types, categories, unknown };
}
