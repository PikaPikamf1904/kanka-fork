// The Knowledge Graph: pages as nodes, connections and wiki links as edges. Built only from rows the
// reader received (Row Level Security already removed anything hidden), and a link is drawn only when
// its target resolves to a page the reader received, so a hidden page never becomes a node, an edge
// or a count. Pure functions, unit-tested.
import { slugify } from './slug.ts';
import { relationKindFrom, relationLabel } from './templates.ts';
import type { ArticleType } from './types.ts';

export interface GraphPage { id: string; slug: string; title: string; type: ArticleType }
export interface GraphInput {
  pages: GraphPage[];
  relations: { source_article_id: string; target_article_id: string; kind: string }[];
  /** Sections the reader can read: id and owning page (links are stored per section). */
  sections: { id: string; article_id: string }[];
  links: { source_section_id: string; target_slug: string }[];
  redirects: { from_slug: string; article_id: string }[];
}

export type EdgeKind = 'relation' | 'link';
export interface GraphEdge { source: string; target: string; kind: EdgeKind; label: string }
export interface GraphNode extends GraphPage { degree: number }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }

export function buildGraph(d: GraphInput): Graph {
  const byId = new Map(d.pages.filter((p) => p.type !== 'news').map((p) => [p.id, p]));
  const bySlug = new Map([...byId.values()].map((p) => [p.slug, p.id]));
  for (const r of d.redirects) if (byId.has(r.article_id) && !bySlug.has(r.from_slug)) bySlug.set(r.from_slug, r.article_id);
  const sectionPage = new Map(d.sections.map((s) => [s.id, s.article_id]));
  const edges = new Map<string, GraphEdge>();
  const add = (e: GraphEdge) => {
    if (e.source === e.target || !byId.has(e.source) || !byId.has(e.target)) return;
    const key = `${e.kind}|${e.source}|${e.target}|${e.label}`;
    if (!edges.has(key)) edges.set(key, e);
  };
  for (const r of d.relations) add({ source: r.source_article_id, target: r.target_article_id, kind: 'relation', label: relationLabel(relationKindFrom(r.kind, 'out')) });
  // A connection between two pages makes a plain link between them redundant.
  const related = new Set([...edges.values()].map((e) => [e.source, e.target].sort().join('|')));
  for (const l of d.links) {
    const from = sectionPage.get(l.source_section_id);
    const to = bySlug.get(slugify(l.target_slug));
    if (!from || !to || related.has([from, to].sort().join('|'))) continue;
    add({ source: from, target: to, kind: 'link', label: 'mentions' });
  }
  const degree = new Map<string, number>();
  for (const e of edges.values()) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  return {
    nodes: [...byId.values()].map((p) => ({ ...p, degree: degree.get(p.id) ?? 0 })),
    edges: [...edges.values()],
  };
}

/** The part of the graph within `depth` steps of a page (either direction). */
export function neighbourhood(g: Graph, centre: string, depth: number): Graph {
  if (!g.nodes.some((n) => n.id === centre)) return { nodes: [], edges: [] };
  const adj = new Map<string, string[]>();
  for (const e of g.edges) {
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
    adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]);
  }
  const keep = new Set([centre]);
  let frontier = [centre];
  for (let i = 0; i < depth; i++) {
    const next: string[] = [];
    for (const id of frontier) for (const o of adj.get(id) ?? []) if (!keep.has(o)) { keep.add(o); next.push(o); }
    frontier = next;
  }
  return { nodes: g.nodes.filter((n) => keep.has(n.id)), edges: g.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
}

/** Only pages of the chosen kinds (all when none chosen), and the edges between them. */
export function onlyTypes(g: Graph, types: ArticleType[]): Graph {
  if (types.length === 0) return g;
  const nodes = g.nodes.filter((n) => types.includes(n.type));
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

/** Optionally leave out pages without any edge (they clutter a large wiki). */
export function withoutLoners(g: Graph): Graph {
  const linked = new Set(g.edges.flatMap((e) => [e.source, e.target]));
  return { nodes: g.nodes.filter((n) => linked.has(n.id)), edges: g.edges };
}

/** Ids of pages whose title matches a search (case- and accent-insensitive, any word start). */
export function searchNodes(g: Graph, q: string): Set<string> {
  const norm = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const needle = norm(q.trim());
  if (!needle) return new Set();
  return new Set(g.nodes.filter((n) => norm(n.title).includes(needle)).map((n) => n.id));
}

/** Colour per kind of page, from the design tokens' palette (kept readable on both themes). */
export const TYPE_COLOURS: Record<ArticleType, string> = {
  character: '#c0643c', location: '#4f7a4a', faction: '#8a3b2e', item: '#b08a2e', quest: '#3b6a8a',
  session: '#6d5a8a', event: '#a0522d', lore: '#5b6b3a', dossier: '#555555', news: '#777777',
};
