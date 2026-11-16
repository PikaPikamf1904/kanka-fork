import { describe, expect, it } from 'vitest';
import { findImages, imageMarkdown, insertImages, moveImage, replaceImage } from './mediaMarkdown.ts';
import { clampCrop } from './image.ts';

const P1 = 'media/aaaa.webp';
const P2 = 'media/bbbb.webp';

describe('pictures in Markdown', () => {
  it('writes safe Markdown whatever the DM types', () => {
    expect(imageMarkdown({ path: P1, alt: 'A [tall]\nship', caption: 'The "Sea Wolf" at dawn' }))
      .toBe('![A tall ship](media:media/aaaa.webp "The ”Sea Wolf” at dawn")');
    expect(() => imageMarkdown({ path: 'https://evil.example/x.png', alt: '' })).toThrow();
  });

  it('finds pictures with and without captions', () => {
    const text = `Intro\n\n![one](media:${P1} "First")\n![two](media:${P2})\n\nEnd`;
    expect(findImages(text).map((i) => [i.path, i.alt, i.caption])).toEqual([[P1, 'one', 'First'], [P2, 'two', '']]);
  });

  it('inserts a picture as its own paragraph at the end of the cursor line', () => {
    const text = 'First line\nSecond line';
    const r = insertImages(text, 3, [{ path: P1, alt: 'x' }], false);
    expect(r.text).toBe(`First line\n\n![x](media:${P1})\n\nSecond line`);
    expect(r.text.slice(0, r.cursor).endsWith(`(media:${P1})`)).toBe(true);
    expect(insertImages('', 0, [{ path: P1, alt: '' }], false).text).toBe(`![](media:${P1})\n`);
  });

  it('a gallery keeps its pictures on consecutive lines', () => {
    const r = insertImages('Text', 4, [{ path: P1, alt: 'a', caption: 'A' }, { path: P2, alt: 'b' }], true);
    expect(r.text).toBe(`Text\n\n![a](media:${P1} "A")\n![b](media:${P2})\n`);
  });

  it('edits and removes a picture without disturbing the text', () => {
    const text = `Before\n\n![a](media:${P1})\n\nAfter`;
    const [img] = findImages(text);
    expect(replaceImage(text, img!, { alt: 'New alt', caption: 'Cap' })).toBe(`Before\n\n![New alt](media:${P1} "Cap")\n\nAfter`);
    expect(replaceImage(text, img!, null)).toBe('Before\n\nAfter');
    const gallery = `![a](media:${P1})\n![b](media:${P2})`;
    expect(replaceImage(gallery, findImages(gallery)[0]!, null)).toBe(`![b](media:${P2})`);
    expect(replaceImage(`x ![a](media:${P1}) y`, findImages(`x ![a](media:${P1}) y`)[0]!, null)).toBe('x  y');
  });

  it('reorders pictures', () => {
    const text = `![a](media:${P1})\n![b](media:${P2})`;
    expect(moveImage(text, 0, 1)).toBe(`![b](media:${P2})\n![a](media:${P1})`);
    expect(moveImage(text, 0, -1)).toBe(text);
  });

  it('keeps a crop inside the picture', () => {
    expect(clampCrop({ x: -10, y: 50, width: 200, height: 80 }, 100, 100)).toEqual({ x: 0, y: 20, width: 100, height: 80 });
  });
});
