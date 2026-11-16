import { describe, expect, it } from 'vitest';
import { computeWikiTidy, onlyPlayerVisible, titleFromSlug, type TidyArticle, type TidyData } from './wikiTidy.ts';

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
