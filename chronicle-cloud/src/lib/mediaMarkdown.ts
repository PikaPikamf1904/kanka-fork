// Pictures in article text are stored as Markdown, ![alt](media:<path> "caption"), so the text stays
// portable and the database can tell which files a page shows (see private.media_paths). The editor
// writes and edits these for the DM; nobody has to type them.

export interface InlineImage {
  path: string;
  alt: string;
  caption: string;
  start: number;
  end: number;
}

const IMAGE = /!\[([^\]\n]*)\]\(media:([a-z0-9][a-z0-9/_.-]*[a-z0-9])(?:[ \t]+"([^"\n]*)")?\)/g;

export function findImages(text: string): InlineImage[] {
  const out: InlineImage[] = [];
  for (const m of text.matchAll(IMAGE)) {
    out.push({ alt: unescape(m[1] ?? ''), path: m[2]!, caption: m[3] ?? '', start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

const unescape = (s: string) => s.replace(/\\([[\]\\])/g, '$1');
const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

export function imageMarkdown(img: { path: string; alt: string; caption?: string }): string {
  if (!/^[a-z0-9][a-z0-9/_.-]*[a-z0-9]$/.test(img.path)) throw new Error('Not a Chronicle media path.');
  const alt = clean(img.alt).replace(/[[\]\\]/g, '');
  const caption = clean(img.caption ?? '').replace(/"/g, '”');
  return `![${alt}](media:${img.path}${caption ? ` "${caption}"` : ''})`;
}

/**
 * Inserts pictures at the cursor as their own paragraph. A gallery is several pictures on
 * consecutive lines, which the page shows side by side; single pictures get a paragraph each.
 */
export function insertImages(
  text: string,
  cursor: number,
  images: { path: string; alt: string; caption?: string }[],
  gallery: boolean,
): { text: string; cursor: number } {
  if (images.length === 0) return { text, cursor };
  const at = Math.min(Math.max(0, cursor), text.length);
  // Never split a line: move to the end of the line the cursor is on.
  const lineEnd = text.indexOf('\n', at);
  const pos = at === 0 || text[at - 1] === '\n' ? at : lineEnd === -1 ? text.length : lineEnd;
  const block = images.map(imageMarkdown).join(gallery ? '\n' : '\n\n');
  const before = text.slice(0, pos).replace(/\s+$/, '');
  const after = text.slice(pos).replace(/^\s+/, '');
  const head = before ? `${before}\n\n` : '';
  const next = `${head}${block}${after ? `\n\n${after}` : '\n'}`;
  return { text: next, cursor: head.length + block.length };
}

/** Changes a picture's alt text and caption, or removes it (next = null), tidying blank lines. */
export function replaceImage(text: string, img: InlineImage, next: { alt: string; caption: string } | null): string {
  if (text.slice(img.start, img.end).indexOf(`media:${img.path}`) === -1) return text;
  if (next) return text.slice(0, img.start) + imageMarkdown({ path: img.path, ...next }) + text.slice(img.end);
  let before = text.slice(0, img.start);
  let after = text.slice(img.end);
  // Removing a picture that had its own line removes the line too.
  if ((before === '' || before.endsWith('\n')) && (after === '' || after.startsWith('\n'))) {
    after = after.replace(/^\n/, '');
    if (after === '' ) before = before.replace(/\n+$/, '');
  }
  return (before + after).replace(/\n{3,}/g, '\n\n');
}

/** Moves a picture one place earlier or later among the pictures of the same text. */
export function moveImage(text: string, index: number, delta: -1 | 1): string {
  const all = findImages(text);
  const a = all[index];
  const b = all[index + delta];
  if (!a || !b) return text;
  const [first, second] = a.start < b.start ? [a, b] : [b, a];
  const firstText = text.slice(first.start, first.end);
  const secondText = text.slice(second.start, second.end);
  return text.slice(0, first.start) + secondText + text.slice(first.end, second.start) + firstText + text.slice(second.end);
}
