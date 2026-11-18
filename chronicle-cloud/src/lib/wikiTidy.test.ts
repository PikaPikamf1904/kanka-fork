import { describe, expect, it } from 'vitest';
import { computeWikiTidy, isTodoNote, minLengthPattern, onlyPlayerVisible, onlyType, sortPages, tidyTotal, titleFromSlug, type TidyArticle, type TidyData } from './wikiTidy.ts';

const art = (slug: string, over: Partial<TidyArticle> = {}): TidyArticle => ({
  id: `id-${slug}`, slug, title: slug.replace(/-/g, ' '), type: 'lore', summary: 'A summary', hero_media_id: null,
  visibility: 'players', status: 'published', ...over,
});
// One section per article, named s-<slug>, with text unless told otherwise.
function data(articles: TidyArticle[], extra: Partial<TidyData> = {}): TidyData {
  return {
    articles,
    sections: articles.map((a) => ({ id: `s-${a.slug}`, article_id: a.id })),
    articlesWithText: articles.map((a) => a.id),
    links: [], redirects: [], relations: [],
    // Every page counts as having a long section unless a test says otherwise, so none is a stub.
    longTextArticles: articles.map((a) => a.id), mediumSections: [], notes: [],
    ...extra,
  };
}
const link = (from: string, target: string) => ({ source_section_id: `s-${from}`, target_slug: target });

describe('broken links', () => {
  it('reports a link whose target is neither a page nor a redirect', () => {
    const r = computeWikiTidy(data([art('a'), art('b')], { links: [link('a', 'b'), link('a', 'nowhere')] }));
    expect(r.brokenLinks.map((b) => [b.page.slug, b.target])).toEqual([['a', 'nowhere']]);
  });

  it('accepts a redirect as a target', () => {
    const r = computeWikiTidy(data([art('a'), art('b')], { links: [link('a', 'old-b')], redirects: [{ from_slug: 'old-b', article_id: 'id-b' }] }));
    expect(r.brokenLinks).toEqual([]);
  });

  it('normalises the target the way the wiki does (case and punctuation)', () => {
    const r = computeWikiTidy(data([art('north-gate'), art('a')], { links: [link('a', 'North Gate'), link('a', 'Lost  City!')] }));
    expect(r.brokenLinks.map((b) => b.target)).toEqual(['lost-city']);
  });

  it('lists a missing target once per source page and ignores links from unknown sections or news', () => {
    const news = art('story', { type: 'news' });
    const r = computeWikiTidy(data([art('a'), news], {
      links: [link('a', 'gone'), { source_section_id: 's-a', target_slug: 'Gone' }, link('story', 'gone'), { source_section_id: 'ghost', target_slug: 'gone' }],
    }));
    expect(r.brokenLinks).toHaveLength(1);
  });

  it('does not call a link to a news story broken', () => {
    const r = computeWikiTidy(data([art('a'), art('story', { type: 'news' })], { links: [link('a', 'story')] }));
    expect(r.brokenLinks).toEqual([]);
  });

  it('sorts by page title, then target', () => {
    const r = computeWikiTidy(data([art('zed'), art('amy')], { links: [link('zed', 'x'), link('amy', 'y'), link('amy', 'b')] }));
    expect(r.brokenLinks.map((b) => `${b.page.slug}:${b.target}`)).toEqual(['amy:b', 'amy:y', 'zed:x']);
  });
});

describe('pages nothing links to', () => {
  it('excludes sessions and news, and counts a link as linked', () => {
    const arts = [art('a'), art('b'), art('journal', { type: 'session' }), art('story', { type: 'news' })];
    const r = computeWikiTidy(data(arts, { links: [link('a', 'b')] }));
    expect(r.orphans.map((p) => p.slug)).toEqual(['a']);
  });

  it('counts a link through a redirect', () => {
    const r = computeWikiTidy(data([art('a'), art('b')], { links: [link('a', 'old-b')], redirects: [{ from_slug: 'old-b', article_id: 'id-b' }] }));
    expect(r.orphans.map((p) => p.slug)).toEqual(['a']);
  });

  it('counts a relation on either end', () => {
    const r = computeWikiTidy(data([art('a'), art('b'), art('c')], { relations: [{ source_article_id: 'id-a', target_article_id: 'id-b' }] }));
    expect(r.orphans.map((p) => p.slug)).toEqual(['c']);
  });

  it('does not count a page linking to itself, directly or by redirect', () => {
    const r = computeWikiTidy(data([art('a'), art('b')], {
      links: [link('a', 'a'), link('b', 'old-b')], redirects: [{ from_slug: 'old-b', article_id: 'id-b' }],
    }));
    expect(r.orphans.map((p) => p.slug)).toEqual(['a', 'b']);
  });
});

describe('summary, picture and empty pages', () => {
  it('treats a blank summary as missing', () => {
    const r = computeWikiTidy(data([art('a', { summary: '   ' }), art('b', { summary: '' }), art('c')]));
    expect(r.missingSummary.map((p) => p.slug)).toEqual(['a', 'b']);
  });

  it('wants pictures only for characters, locations and factions', () => {
    const arts = [art('c', { type: 'character' }), art('l', { type: 'location' }), art('f', { type: 'faction' }), art('i', { type: 'item' }), art('ok', { type: 'character', hero_media_id: 'm1' })];
    expect(computeWikiTidy(data(arts)).missingPicture.map((p) => p.slug)).toEqual(['c', 'f', 'l']);
  });

  it('finds pages with no section that has text, including pages with no sections', () => {
    const arts = [art('a'), art('b'), art('c')];
    const r = computeWikiTidy({ ...data(arts), sections: [{ id: 's-a', article_id: 'id-a' }, { id: 's-b', article_id: 'id-b' }], articlesWithText: ['id-a'] });
    expect(r.emptyPages.map((p) => p.slug)).toEqual(['b', 'c']);
  });
});

describe('player filter and helpers', () => {
  it('keeps only published, player-visible pages', () => {
    const arts = [art('live', { summary: '' }), art('draft', { summary: '', status: 'draft' }), art('secret', { summary: '', visibility: 'dm' })];
    const full = computeWikiTidy(data(arts));
    expect(full.missingSummary).toHaveLength(3);
    expect(onlyPlayerVisible(full).missingSummary.map((p) => p.slug)).toEqual(['live']);
  });

  it('makes a title from a slug', () => expect(titleFromSlug('north-gate')).toBe('North Gate'));
});

describe('stubs', () => {
  const arts = [art('long'), art('short'), art('spread'), art('almost'), art('blank')];
  const base = (): TidyData => ({
    ...data(arts),
    articlesWithText: ['id-long', 'id-short', 'id-spread', 'id-almost'],
    longTextArticles: ['id-long'],
    mediumSections: [
      ...['id-spread', 'id-spread', 'id-spread'].map((article_id) => ({ article_id })),
      ...['id-almost', 'id-almost'].map((article_id) => ({ article_id })),
    ],
  });
  it('flags pages with some text but no long section and fewer than three medium ones', () => {
    const r = computeWikiTidy(base());
    expect(r.stubs.map((p) => p.slug)).toEqual(['almost', 'short']);
  });
  it('leaves empty pages to the empty-pages section and skips news', () => {
    const r = computeWikiTidy(base());
    expect(r.emptyPages.map((p) => p.slug)).toEqual(['blank']);
    expect(r.stubs.map((p) => p.slug)).not.toContain('blank');
    const news = art('story', { type: 'news' });
    expect(computeWikiTidy({ ...data([news]), longTextArticles: [] }).stubs).toEqual([]);
  });
  it('counts toward the total and follows the player filter', () => {
    const d = base();
    d.articles[1] = { ...d.articles[1]!, visibility: 'dm' };
    const full = computeWikiTidy(d);
    expect(onlyPlayerVisible(full).stubs.map((p) => p.slug)).toEqual(['almost']);
    expect(tidyTotal(full)).toBeGreaterThanOrEqual(full.stubs.length);
  });
});

describe('type filter and sorting', () => {
  const arts = [art('b-item', { type: 'item', summary: '' }), art('a-char', { type: 'character', summary: '' }), art('c-loc', { type: 'location', summary: '', visibility: 'dm', status: 'draft' }), art('d-loc', { type: 'location', summary: '' })];
  const r = computeWikiTidy(data(arts));
  it('narrows every section to one type', () => {
    const only = onlyType(computeWikiTidy(data(arts, { links: [{ source_section_id: 's-c-loc', target_slug: 'gone' }, { source_section_id: 's-a-char', target_slug: 'gone' }] })), 'location');
    expect(only.missingSummary.map((p) => p.slug)).toEqual(['c-loc', 'd-loc']);
    expect(only.brokenLinks.map((b) => b.page.slug)).toEqual(['c-loc']);
    expect(onlyType(r, null)).toBe(r);
  });
  it('sorts by title, by type order, and by attention (DM-only and drafts first)', () => {
    expect(sortPages(r.missingSummary, 'title').map((p) => p.slug)).toEqual(['a-char', 'b-item', 'c-loc', 'd-loc']);
    expect(sortPages(r.missingSummary, 'type').map((p) => p.slug)).toEqual(['a-char', 'c-loc', 'd-loc', 'b-item']);
    expect(sortPages(r.missingSummary, 'visibility').map((p) => p.slug)).toEqual(['c-loc', 'a-char', 'b-item', 'd-loc']);
  });
  it('sorts broken links by their page and does not change the input', () => {
    const rows = [{ page: r.missingSummary[2]!, target: 'x' }, { page: r.missingSummary[0]!, target: 'y' }];
    expect(sortPages(rows, 'title').map((b) => b.target)).toEqual(['y', 'x']);
    expect(rows[0]!.target).toBe('x');
  });
});

describe('DM notes', () => {
  it('counts notes per page and flags "To do" titles', () => {
    const r = computeWikiTidy(data([art('a', { summary: '' }), art('b', { summary: '' }), art('c', { summary: '' })], {
      notes: [{ article_id: 'id-a', title: 'To do: add a map' }, { article_id: 'id-a', title: 'Ideas' }, { article_id: 'id-b', title: 'Backstory' }],
    }));
    const by = Object.fromEntries(r.missingSummary.map((p) => [p.slug, p.notes]));
    expect(by).toEqual({ a: { count: 2, todo: true }, b: { count: 1, todo: false }, c: { count: 0, todo: false } });
  });
  it('recognises to-do titles', () => {
    for (const t of ['To do', 'TODO: x', 'to-do list', '  Todo']) expect(isTodoNote(t)).toBe(true);
    for (const t of ['Todos later', 'Tomato', 'Things to do']) expect(isTodoNote(t)).toBe(false);
  });
});

describe('minLengthPattern', () => {
  it('keeps each repetition within the 255 limit and means "at least n characters"', () => {
    expect(minLengthPattern(100)).toBe('.{100}');
    expect(minLengthPattern(300)).toBe('(.{100}){3}');
    expect(minLengthPattern(350)).toBe('(.{100}){3}.{50}');
    const re = new RegExp(`^${minLengthPattern(350)}`, 's');
    expect(re.test('x'.repeat(349))).toBe(false);
    expect(re.test(`${'x\n'.repeat(175)}`)).toBe(true);
  });
});
