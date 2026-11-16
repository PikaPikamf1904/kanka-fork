import { describe, expect, it } from 'vitest';
import { computeAudit, leakCount, mentionMatcher, type AuditArticle, type AuditData } from './visibilityAudit.ts';

const art = (id: string, title: string, visibility: 'players' | 'dm', status: 'published' | 'draft' = 'published', extra: Partial<AuditArticle> = {}): AuditArticle => ({
  id, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, type: 'character', visibility, status, has_summary: true, ...extra,
});
const sec = (id: string, article_id: string, heading = 'History', visibility: 'players' | 'dm' = 'players', status: 'published' | 'draft' = 'published') =>
  ({ id, article_id, heading, visibility, status });
const base = (over: Partial<AuditData>): AuditData => ({
  articles: [], sections: [], visibleBodies: [], links: [], redirects: [], visibleFields: [], categories: [], articleCategories: [], ...over,
});

describe('mentionMatcher', () => {
  it('matches whole words, any case, longest title first, and ignores short titles', () => {
    const m = mentionMatcher(['The Red Hand', 'Red Hand', 'Ash', 'Velka']);
    expect(m('They fear THE RED HAND.').sort()).toEqual(['The Red Hand']);
    expect(m('Velkas is not Velka')).toEqual(['Velka']);
    expect(m('Ashen fields')).toEqual([]);
    expect(m("Velka's knife")).toEqual(['Velka']);
  });
});

describe('computeAudit', () => {
  const pub = art('p', 'Port Town', 'players');
  const secret = art('s', 'The Traitor King', 'dm');
  const draft = art('d', 'Coming Soon', 'players', 'draft');

  it('counts pages by what players can read, by kind and category, and skips news', () => {
    const a = computeAudit(base({
      articles: [pub, secret, draft, art('n', 'A Story', 'players', 'published', { type: 'news' })],
      categories: [{ id: 'c', name: 'Royals' }],
      articleCategories: [{ article_id: 's', category_id: 'c' }, { article_id: 'p', category_id: 'c' }],
    }));
    expect(a.overall).toEqual({ readable: 1, playersDraft: 1, dmOnly: 1 });
    expect(a.byCategory).toEqual([{ id: 'c', name: 'Royals', totals: { readable: 1, playersDraft: 0, dmOnly: 1 } }]);
  });

  it('flags links and mentions only in sections players can read', () => {
    const a = computeAudit(base({
      articles: [pub, secret],
      sections: [sec('v', 'p', 'Rumours'), sec('h', 'p', 'DM thoughts', 'dm'), sec('x', 'p', 'Later', 'players', 'draft')],
      visibleBodies: [{ id: 'v', article_id: 'p', body: 'Whispers of the traitor king abound.' }],
      links: [{ source_section_id: 'v', target_slug: 'the-traitor-king' }, { source_section_id: 'h', target_slug: 'the-traitor-king' }, { source_section_id: 'x', target_slug: 'the-traitor-king' }],
    }));
    expect(a.findings.link.map((f) => [f.page.id, f.where, f.hidden!.id])).toEqual([['p', 'Rumours', 's']]);
    // Already reported as a link from the same page: not repeated as a mention.
    expect(a.findings.mention).toEqual([]);
    expect(leakCount(a)).toBe(1);
  });

  it('follows redirects and checks infobox fields players can read', () => {
    const a = computeAudit(base({
      articles: [pub, secret],
      redirects: [{ from_slug: 'old-king', article_id: 's' }],
      visibleFields: [{ article_id: 'p', label: 'Ruler', value: '[[Old King|the old ruler]]' }, { article_id: 'p', label: 'Rumour', value: 'Serves The Traitor King' }],
    }));
    expect(a.findings.link.map((f) => f.where)).toEqual(['Ruler']);
    expect(a.findings.mention).toEqual([]); // same hidden page already linked from this page
  });

  it('does not flag a hidden page whose title a readable page shares, or a page mentioning itself', () => {
    const twin = art('t', 'The Traitor King', 'players');
    const a = computeAudit(base({
      articles: [pub, secret, twin],
      sections: [sec('v', 'p'), sec('w', 's', 'Self', 'players')],
      visibleBodies: [{ id: 'v', article_id: 'p', body: 'The Traitor King rides.' }, { id: 'w', article_id: 's', body: 'The Traitor King' }],
    }));
    expect(a.findings.mention).toEqual([]);
  });

  it('lists published player pages that show players nothing, and player pages still in draft', () => {
    const bare = art('b', 'Bare Page', 'players', 'published', { has_summary: false });
    const hiddenText = art('h', 'Hidden Text', 'players', 'published', { has_summary: false });
    const a = computeAudit(base({
      articles: [bare, hiddenText, draft, pub],
      sections: [sec('q', 'h', 'Secret', 'dm')],
      visibleBodies: [],
    }));
    expect(a.findings.empty.map((f) => f.page.id).sort()).toEqual(['b', 'h']);
    expect(a.findings.draft.map((f) => f.page.id)).toEqual(['d']);
  });

  it('checks summaries and subtitles, hidden pictures in visible text, and categories that only hold hidden pages', () => {
    const shown = art('p', 'Port Town', 'players', 'published', { summary: 'Rumour has it the traitor king lives.', subtitle: 'A quiet harbour' });
    const a = computeAudit(base({
      articles: [shown, secret],
      sections: [sec('v', 'p')],
      visibleBodies: [{ id: 'v', article_id: 'p', body: 'Look: ![](media:secret/traitor-portrait.jpg) and ![](media:public/harbour.jpg)' }],
      media: [{ path: 'secret/traitor-portrait.jpg', visibility: 'dm' }, { path: 'public/harbour.jpg', visibility: 'players' }],
      categories: [{ id: 'c1', name: 'Traitors', visibility: 'players' }, { id: 'c2', name: 'Secret cabal', visibility: 'dm' }, { id: 'c3', name: 'Ports', visibility: 'players' }],
      articleCategories: [{ article_id: 's', category_id: 'c1' }, { article_id: 's', category_id: 'c2' }, { article_id: 'p', category_id: 'c3' }, { article_id: 's', category_id: 'c3' }],
    }));
    expect(a.findings.mention.map((f) => [f.where, f.hidden!.id])).toEqual([['Summary', 's']]);
    expect(a.findings.media.map((f) => f.detail)).toEqual(['secret/traitor-portrait.jpg']);
    expect(a.findings.category.map((f) => f.detail)).toEqual(['Traitors']);
  });
});

