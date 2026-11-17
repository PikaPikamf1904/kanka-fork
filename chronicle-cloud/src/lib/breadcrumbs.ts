import { TEMPLATES } from './templates.ts';
import type { ArticleType } from './types.ts';

export interface Crumb { label: string; to?: string }

/** Main page › kind › category (when the page has one players can see) › title. The last crumb has no link. */
export function breadcrumbTrail(page: { type: ArticleType; title: string; categories: { slug: string; name: string; kind: string; visibility?: string }[] }, isDm: boolean): Crumb[] {
  const trail: Crumb[] = [{ label: 'Main page', to: '/' }];
  if (page.type !== 'news') trail.push({ label: TEMPLATES[page.type].plural, to: `/browse/${page.type}` });
  // A DM-only category is not shown to a player, and not offered as the path for a page players read.
  const usable = page.categories.filter((c) => c.visibility !== 'dm' || isDm);
  const cat = [...usable].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'category' ? -1 : 1))[0];
  if (cat) trail.push({ label: cat.name, to: `/category/${cat.slug}` });
  trail.push({ label: page.title });
  return trail;
}
