// Must match private.slugify() in supabase/migrations (tests/db/functions.test.ts checks this).
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const WIKI_LINK = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

/**
 * Turn [[Slug]] and [[slug|Label]] into Markdown links to /wiki/<slug>. Only the slug is used for
 * the URL, so a link can never point outside the wiki.
 */
export function expandWikiLinks(markdown: string): string {
  return markdown.replace(WIKI_LINK, (_match, target: string, label?: string) => {
    const slug = slugify(target);
    if (!slug) return label ?? target;
    const text = (label ?? target).trim().replace(/[[\]]/g, '');
    return `[${text}](/wiki/${slug})`;
  });
}

export function wikiLinkTargets(markdown: string): string[] {
  const out = new Set<string>();
  for (const match of markdown.matchAll(WIKI_LINK)) {
    const slug = slugify(match[1] ?? '');
    if (slug) out.add(slug);
  }
  return [...out];
}
