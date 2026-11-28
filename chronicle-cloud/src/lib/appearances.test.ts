import { describe, expect, it } from 'vitest';
import { mergeAppearances } from './appearances.ts';

const ref = (slug: string, type = 'session') => ({ slug, title: slug.toUpperCase(), type }) as never;

describe('mergeAppearances', () => {
  it('keeps links first and adds each mentioning page once', () => {
    const out = mergeAppearances([ref('a'), ref('b')], [ref('b'), ref('c'), ref('c'), ref('a')]);
    expect(out.map((r: { slug: string }) => r.slug)).toEqual(['a', 'b', 'c']);
  });
  it('works with either list empty', () => {
    expect(mergeAppearances([], [ref('x')]).length).toBe(1);
    expect(mergeAppearances([ref('x')], []).length).toBe(1);
  });
});
