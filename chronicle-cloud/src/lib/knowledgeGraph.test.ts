import { describe, expect, it } from 'vitest';
import { buildGraph, neighbourhood, onlyTypes, searchNodes, withoutLoners, type GraphInput } from './knowledgeGraph.ts';

const page = (id: string, type: GraphInput['pages'][number]['type'] = 'character') => ({ id, slug: id, title: `Page ${id.toUpperCase()}`, type });
const base: GraphInput = {
  pages: [page('a'), page('b'), page('c', 'location'), page('d'), page('n', 'news')],
  relations: [{ source_article_id: 'a', target_article_id: 'b', kind: 'knows' }, { source_article_id: 'a', target_article_id: 'hidden', kind: 'knows' }],
  // Links in sections the reader cannot read never arrive: the database leaves them out (see
  // tests/db for the embedded query under Row Level Security).
  links: [
    { article_id: 'a', target_slug: 'b' }, // already connected: no extra link edge
    { article_id: 'a', target_slug: 'old-c' }, // through a redirect
    { article_id: 'b', target_slug: 'secret-page' }, // a page the reader did not receive
    { article_id: 'hidden', target_slug: 'd' }, // from a page the reader did not receive
    { article_id: 'b', target_slug: 'n' }, // news pages are not in the graph
  ],
  redirects: [{ from_slug: 'old-c', article_id: 'c' }],
};

describe('buildGraph', () => {
  it('uses only what the reader received and never invents a node, edge or count', () => {
    const g = buildGraph(base);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(g.edges.map((e) => `${e.kind}:${e.source}>${e.target}`).sort()).toEqual(['link:a>c', 'relation:a>b']);
    expect(g.nodes.find((n) => n.id === 'a')!.degree).toBe(2);
    expect(JSON.stringify(g)).not.toContain('secret-page');
  });
});

describe('graph views', () => {
  const g = buildGraph(base);
  it('takes a neighbourhood, filters kinds, drops loners and searches titles', () => {
    expect(neighbourhood(g, 'b', 1).nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(neighbourhood(g, 'b', 2).nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    expect(neighbourhood(g, 'missing', 2).nodes).toEqual([]);
    expect(onlyTypes(g, ['location']).nodes.map((n) => n.id)).toEqual(['c']);
    expect(onlyTypes(g, ['location']).edges).toEqual([]);
    expect(withoutLoners(g).nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    expect([...searchNodes(g, 'page c')]).toEqual(['c']);
    expect(searchNodes(g, '  ').size).toBe(0);
  });
});

import { connectedCluster, easeView, legendEntries, nearestInDirection, relationshipSummary, ringPositions, summaryText } from './knowledgeGraph.ts';

describe('legend, clusters and summaries', () => {
  const input: GraphInput = {
    pages: [page('a'), page('b'), page('c', 'location'), page('d'), page('e')],
    relations: [
      { source_article_id: 'a', target_article_id: 'b', kind: 'knows' },
      { source_article_id: 'a', target_article_id: 'c', kind: 'resides_in' },
      { source_article_id: 'd', target_article_id: 'a', kind: 'knows' },
    ],
    links: [{ article_id: 'a', target_slug: 'e' }, { article_id: 'e', target_slug: 'a' }, { article_id: 'a', target_slug: 'd-missing' }],
    redirects: [],
  };
  const g = buildGraph(input);
  it('lists each kind of line that is actually drawn, with counts', () => {
    const l = legendEntries(g);
    expect(l.map((x) => `${x.kind}:${x.label}:${x.count}`)).toEqual(['relation:Knows:2', 'relation:Resides in:1', 'link:Wiki link (mentions):2']);
    expect(legendEntries({ nodes: [], edges: [] })).toEqual([]);
  });
  it('keeps the page and its direct neighbours bright', () => {
    expect([...connectedCluster(g, 'b')].sort()).toEqual(['a', 'b']);
    expect([...connectedCluster(g, 'a')].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect([...connectedCluster(g, 'zzz')]).toEqual(['zzz']);
  });
  it('summarises a page from the received graph only', () => {
    expect(summaryText(relationshipSummary(g, 'a'))).toBe('Knows Page B, Resides in Page C, Page D (knows this), links to 1 page, mentioned by 1 page');
    expect(summaryText(relationshipSummary(g, 'b'))).toBe('Page A (knows this)');
    expect(relationshipSummary(g, 'zzz')).toEqual([]);
    const many = buildGraph({ ...input, relations: Array.from({ length: 9 }, (_, i) => ({ source_article_id: 'a', target_article_id: i < 1 ? 'b' : 'c', kind: `k${i}` })), links: [] });
    expect(summaryText(relationshipSummary(many, 'a', 3))).toMatch(/and 6 more$/);
  });
});

describe('ring layout for unconnected pages', () => {
  it('puts every page outside the inner radius and apart from the others', () => {
    const pts = ringPositions(40, 200, 34);
    expect(pts).toHaveLength(40);
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(199.9);
    let min = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) min = Math.min(min, Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y));
    expect(min).toBeGreaterThan(20);
    expect(ringPositions(0, 100)).toEqual([]);
  });
});

describe('arrow-key movement', () => {
  const pts = [{ id: 'c', x: 0, y: 0 }, { id: 'r1', x: 100, y: 10 }, { id: 'r2', x: 300, y: 0 }, { id: 'u', x: 5, y: -80 }, { id: 'd', x: -10, y: 120 }, { id: 'l', x: -90, y: -5 }];
  it('picks the nearest page in that direction', () => {
    expect(nearestInDirection(pts, 'c', 'right')).toBe('r1');
    expect(nearestInDirection(pts, 'r1', 'right')).toBe('r2');
    expect(nearestInDirection(pts, 'c', 'up')).toBe('u');
    expect(nearestInDirection(pts, 'c', 'down')).toBe('d');
    expect(nearestInDirection(pts, 'c', 'left')).toBe('l');
  });
  it('returns null when nothing lies that way, and starts near the middle', () => {
    expect(nearestInDirection(pts, 'r2', 'right')).toBeNull();
    expect(nearestInDirection(pts, null, 'right')).toBe('c');
    expect(nearestInDirection([], null, 'up')).toBeNull();
  });
});

describe('focus animation', () => {
  it('eases from one view to another and ends exactly there', () => {
    const a = { k: 1, x: 0, y: 0 };
    const b = { k: 2, x: 100, y: -50 };
    expect(easeView(a, b, 0)).toEqual(a);
    expect(easeView(a, b, 1)).toEqual(b);
    const mid = easeView(a, b, 0.5);
    expect(mid.k).toBeGreaterThan(1.5);
    expect(easeView(a, b, 2)).toEqual(b);
  });
});
