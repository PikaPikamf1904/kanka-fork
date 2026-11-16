import { describe, expect, it } from 'vitest';
import { buildGraph, neighbourhood, onlyTypes, searchNodes, withoutLoners, type GraphInput } from './knowledgeGraph.ts';

const page = (id: string, type: GraphInput['pages'][number]['type'] = 'character') => ({ id, slug: id, title: `Page ${id.toUpperCase()}`, type });
const base: GraphInput = {
  pages: [page('a'), page('b'), page('c', 'location'), page('d'), page('n', 'news')],
  relations: [{ source_article_id: 'a', target_article_id: 'b', kind: 'knows' }, { source_article_id: 'a', target_article_id: 'hidden', kind: 'knows' }],
  sections: [{ id: 's1', article_id: 'a' }, { id: 's2', article_id: 'b' }],
  links: [
    { source_section_id: 's1', target_slug: 'b' }, // already connected: no extra link edge
    { source_section_id: 's1', target_slug: 'old-c' }, // through a redirect
    { source_section_id: 's2', target_slug: 'secret-page' }, // a page the reader did not receive
    { source_section_id: 's-hidden', target_slug: 'd' }, // a section the reader did not receive
    { source_section_id: 's2', target_slug: 'n' }, // news pages are not in the graph
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
