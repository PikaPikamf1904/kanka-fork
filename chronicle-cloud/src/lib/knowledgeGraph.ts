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
  relations: { id?: string; source_article_id: string; target_article_id: string; kind: string; label?: string | null }[];
  /** Wiki links in sections the reader can read, by the page that holds the section. */
  links: { article_id: string; target_slug: string }[];
  redirects: { from_slug: string; article_id: string }[];
}

export type EdgeKind = 'relation' | 'link';
/** `lane` spreads several lines between the same two pages apart (0 when there is only one). */
export interface GraphEdge { source: string; target: string; kind: EdgeKind; label: string; detail?: string; lane?: number }
export interface GraphNode extends GraphPage { degree: number }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }

export function buildGraph(d: GraphInput): Graph {
  // Gazette stories are not drawn for their wiki links, only when a saved connection names one.
  const byId = new Map(d.pages.map((p) => [p.id, p]));
  const linkable = new Map([...byId.values()].filter((p) => p.type !== 'news').map((p) => [p.slug, p.id]));
  for (const r of d.redirects) if (byId.has(r.article_id) && byId.get(r.article_id)!.type !== 'news' && !linkable.has(r.from_slug)) linkable.set(r.from_slug, r.article_id);
  const edges = new Map<string, GraphEdge>();
  const add = (key: string, e: GraphEdge) => {
    if (e.source === e.target || !byId.has(e.source) || !byId.has(e.target)) return;
    if (!edges.has(key)) edges.set(key, e);
  };
  // One line per saved connection row, as on the Connections page: two rows are two lines even
  // when they read the same.
  d.relations.forEach((r, i) => add(`relation|${r.id ?? i}`, {
    source: r.source_article_id, target: r.target_article_id, kind: 'relation',
    label: relationLabel(relationKindFrom(r.kind, 'out')),
    detail: r.label?.trim() || undefined,
  }));
  // A connection between two pages makes a plain link between them redundant.
  const related = new Set([...edges.values()].map((e) => [e.source, e.target].sort().join('|')));
  for (const l of d.links) {
    const from = l.article_id;
    const to = linkable.get(slugify(l.target_slug));
    if (!from || !to || byId.get(from)?.type === 'news' || related.has([from, to].sort().join('|'))) continue;
    add(`link|${from}|${to}`, { source: from, target: to, kind: 'link', label: 'mentions' });
  }
  // Saved connections sharing two pages get lanes -n..n so they are drawn as separate curves, not on
  // top of each other. (Wiki links never share a pair with a connection; see `related` above.)
  const pairs = new Map<string, GraphEdge[]>();
  for (const e of edges.values()) {
    if (e.kind !== 'relation') continue;
    const k = [e.source, e.target].sort().join('|');
    pairs.set(k, [...(pairs.get(k) ?? []), e]);
  }
  for (const list of pairs.values()) list.forEach((e, i) => { e.lane = list.length > 1 ? i - (list.length - 1) / 2 : 0; });
  const degree = new Map<string, number>();
  for (const e of edges.values()) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  return {
    nodes: [...byId.values()].filter((p) => p.type !== 'news' || degree.has(p.id)).map((p) => ({ ...p, degree: degree.get(p.id) ?? 0 })),
    edges: [...edges.values()],
  };
}


/** Every saved connection in the current reader's graph, including custom descriptions.
 * The caller supplies only RLS-authorized pages and relations, so missing/hidden
 * endpoints can never appear in this directory. */
export function connectionRows(g: Graph): { from: GraphNode; to: GraphNode; label: string; detail?: string }[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  return g.edges.filter((e) => e.kind === 'relation').flatMap((e) => {
    const from = byId.get(e.source);
    const to = byId.get(e.target);
    return from && to ? [{ from, to, label: e.label, detail: e.detail }] : [];
  }).sort((a, b) =>
    a.from.title.localeCompare(b.from.title) ||
    a.to.title.localeCompare(b.to.title) ||
    a.label.localeCompare(b.label) ||
    (a.detail ?? '').localeCompare(b.detail ?? '')
  );
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

// ---------- reading the graph: legend, summaries, clusters ----------

export interface LegendEntry { label: string; kind: EdgeKind; count: number }

/** The kinds of line actually on the graph: each connection label, then plain wiki links. */
export function legendEntries(g: Graph): LegendEntry[] {
  const m = new Map<string, LegendEntry>();
  for (const e of g.edges) {
    const key = `${e.kind}|${e.kind === 'link' ? 'mentions' : e.label}`;
    const cur = m.get(key);
    if (cur) cur.count++;
    else m.set(key, { label: e.kind === 'link' ? 'Wiki link (mentions)' : e.label, kind: e.kind, count: 1 });
  }
  return [...m.values()].sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'relation' ? -1 : 1));
}

/** The page itself and every page one line away: what "Highlight connected" keeps bright. */
export function connectedCluster(g: Graph, id: string): Set<string> {
  const keep = new Set<string>([id]);
  for (const e of g.edges) {
    if (e.source === id) keep.add(e.target);
    if (e.target === id) keep.add(e.source);
  }
  return keep;
}

export interface SummaryItem { lead: string; other: GraphNode | null; tail: string }
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Ally of X, Member of Y, links to 3 pages", from the received graph only. */
export function relationshipSummary(g: Graph, id: string, maxRelations = 6): SummaryItem[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const rel: SummaryItem[] = [];
  let linksOut = 0;
  let linksIn = 0;
  for (const e of g.edges) {
    if (e.kind === 'link') {
      if (e.source === id) linksOut++;
      else if (e.target === id) linksIn++;
    } else if (e.source === id) {
      const o = byId.get(e.target);
      if (o) rel.push({ lead: `${e.label} `, other: o, tail: '' });
    } else if (e.target === id) {
      const o = byId.get(e.source);
      if (o) rel.push({ lead: '', other: o, tail: ` (${e.label.toLowerCase()} this)` });
    }
  }
  const out = rel.slice(0, maxRelations);
  if (rel.length > maxRelations) out.push({ lead: `and ${rel.length - maxRelations} more`, other: null, tail: '' });
  if (linksOut) out.push({ lead: `links to ${plural(linksOut, 'page', 'pages')}`, other: null, tail: '' });
  if (linksIn) out.push({ lead: `mentioned by ${plural(linksIn, 'page', 'pages')}`, other: null, tail: '' });
  return out;
}
export const summaryText = (items: SummaryItem[]) => items.map((i) => `${i.lead}${i.other?.title ?? ''}${i.tail}`).join(', ');

// ---------- layout and movement ----------

/** Points on concentric rings at least `inner` from the centre, `gap` apart, for pages with no connections. */
export function ringPositions(count: number, inner: number, gap = 34): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let ring = 0; out.length < count; ring++) {
    const r = inner + ring * gap;
    const fit = Math.max(1, Math.floor((2 * Math.PI * r) / gap));
    const n = Math.min(fit, count - out.length);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.5;
      out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
  }
  return out;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/** The page nearest in a direction, for arrow-key movement. Null when nothing lies that way. */
export function nearestInDirection(nodes: { id: string; x: number; y: number }[], from: string | null, dir: Direction): string | null {
  if (nodes.length === 0) return null;
  const cur = from ? nodes.find((n) => n.id === from) : undefined;
  if (!cur) {
    // Nothing focused yet: start at the page nearest the middle.
    return [...nodes].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || a.id.localeCompare(b.id))[0]!.id;
  }
  const v = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
  let best: { id: string; score: number } | null = null;
  for (const n of nodes) {
    if (n.id === cur.id) continue;
    const dx = n.x - cur.x;
    const dy = n.y - cur.y;
    const along = dx * v[0]! + dy * v[1]!;
    if (along <= 0) continue;
    const across = Math.abs(dx * v[1]! - dy * v[0]!);
    if (across > along * 1.75) continue; // outside a wide cone around the direction
    const score = along + across * 2;
    if (!best || score < best.score || (score === best.score && n.id < best.id)) best = { id: n.id, score };
  }
  return best?.id ?? null;
}

export interface ViewState { k: number; x: number; y: number }
const ease = (t: number) => 1 - (1 - t) ** 3;
/** A view part-way (0 to 1) between two, easing out. Used for the short focus animation. */
export function easeView(from: ViewState, to: ViewState, t: number): ViewState {
  const e = ease(Math.min(1, Math.max(0, t)));
  return { k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
}
