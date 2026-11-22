import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { quadtree } from 'd3-quadtree';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { MediaImage } from '../components/MediaImage.tsx';
import { getPagePreview, loadGraphData } from '../lib/api.ts';
import {
  buildGraph, connectedCluster, connectionRows, easeView, legendEntries, nearestInDirection, neighbourhood, onlyTypes, relationshipSummary, ringPositions, searchNodes,
  summaryText, TYPE_COLOURS, withoutLoners, type Direction, type Graph, type GraphNode, type SummaryItem,
} from '../lib/knowledgeGraph.ts';
import { useSession } from '../lib/session.tsx';
import { TEMPLATES, TYPE_ORDER } from '../lib/templates.ts';
import type { ArticleType } from '../lib/types.ts';
import { useLoad } from '../lib/useLoad.ts';

type SimNode = GraphNode & SimulationNodeDatum;
type SimEdge = SimulationLinkDatum<SimNode> & { kind: 'relation' | 'link'; label: string };

const STORE = 'chronicle-graph-filters';
const radius = (n: GraphNode) => 4 + Math.min(10, Math.sqrt(n.degree) * 2);
const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Filters live in the address (shareable); the kinds and "show loners" also persist per browser. */
function useGraphParams() {
  const [params, setParams] = useSearchParams();
  const stored = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) ?? '{}') as { types?: string; loners?: string };
    } catch {
      return {};
    }
  })();
  const typesRaw = params.get('types') ?? stored.types ?? '';
  const types = typesRaw.split(',').filter((t): t is ArticleType => (TYPE_ORDER as string[]).includes(t));
  const loners = (params.get('loners') ?? stored.loners ?? '0') === '1';
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    try {
      localStorage.setItem(STORE, JSON.stringify({ types: next.get('types') ?? '', loners: next.get('loners') ?? '0' }));
    } catch {
      // Private mode: filters are just not remembered.
    }
    setParams(next, { replace: true });
  };
  return {
    focus: params.get('focus') ?? '',
    depth: Math.min(3, Math.max(1, Number(params.get('depth') ?? 2) || 2)),
    q: params.get('q') ?? '',
    view: params.get('view') === 'list' ? 'list' : 'graph',
    types, loners, set,
  };
}

export function GraphPage() {
  const { playerPreview } = useSession();
  const data = useLoad(() => loadGraphData(playerPreview), [playerPreview]);
  const p = useGraphParams();
  const full = useMemo(() => (data.data ? buildGraph(data.data) : null), [data.data]);
  const savedConnections = useMemo(() => (full ? connectionRows(full) : []), [full]);
  const [browseConnections, setBrowseConnections] = useState(false);
  const centre = useMemo(() => full?.nodes.find((n) => n.slug === p.focus) ?? null, [full, p.focus]);
  const shown: Graph | null = useMemo(() => {
    if (!full) return null;
    let g = onlyTypes(full, p.types);
    if (centre) g = neighbourhood(onlyTypes(full, p.types.length && !p.types.includes(centre.type) ? [...p.types, centre.type] : p.types), centre.id, p.depth);
    else if (!p.loners) g = withoutLoners(g);
    return g;
  }, [full, p.types, p.loners, p.depth, centre]);
  const matches = useMemo(() => (shown ? searchNodes(shown, p.q) : new Set<string>()), [shown, p.q]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [cluster, setCluster] = useState(false);
  const toggleType = (t: ArticleType) => {
    const next = p.types.includes(t) ? p.types.filter((x) => x !== t) : [...p.types, t];
    p.set({ types: next.join(',') || null });
  };

  return (
    <div className="graph-page">
      <h1 className="page-title">Knowledge graph</h1>
      <p className="muted">
        Every page you can read, joined by its connections (solid lines, with arrows) and wiki links (dashed).
        {centre ? <> Showing pages within {p.depth} {p.depth === 1 ? 'step' : 'steps'} of <Link to={`/wiki/${centre.slug}`}>{centre.title}</Link>.</> : null}
      </p>
      <div className="graph-toolbar">
        <label className="graph-search">
          <span className="visually-hidden">Find a page in the graph</span>
          <input
            type="search"
            placeholder="Find a page…"
            value={p.q}
            onChange={(e) => p.set({ q: e.target.value || null })}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !shown) return;
              const first = shown.nodes.find((n) => matches.has(n.id));
              if (first) setSelected(first);
            }}
          />
        </label>
        {centre ? (
          <>
            <label className="tidy-type">
              <span>Steps out</span>
              <select value={p.depth} onChange={(e) => p.set({ depth: e.target.value })}>
                {[1, 2, 3].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <button type="button" className="button secondary small" onClick={() => p.set({ focus: null, depth: null })}>Show the whole graph</button>
          </>
        ) : (
          <button type="button" className={p.loners ? 'chip chip-on' : 'chip'} aria-pressed={p.loners} onClick={() => p.set({ loners: p.loners ? null : '1' })}>
            Include unconnected pages
          </button>
        )}
        <button type="button" className="button secondary small" aria-expanded={browseConnections} aria-controls="graph-connections-directory" onClick={() => setBrowseConnections(!browseConnections)}>
          {browseConnections ? 'Hide saved connections' : `Browse saved connections (${savedConnections.length})`}
        </button>
        <button type="button" className="button secondary small" onClick={() => p.set({ view: p.view === 'list' ? null : 'list' })}>
          {p.view === 'list' ? 'Show as a graph' : 'Show as a list'}
        </button>
        {p.view !== 'list' && (
          <button type="button" className={cluster ? 'chip chip-on' : 'chip'} aria-pressed={cluster} onClick={() => setCluster(!cluster)} title="Dim everything except the selected page and the pages it is connected to">
            Highlight connected
          </button>
        )}
      </div>

      {browseConnections && (
        <section className="panel graph-connections-directory" id="graph-connections-directory" aria-label="Saved connections" data-testid="graph-connections-directory">
          <h2>Saved connections ({savedConnections.length})</h2>
          <p className="fine-print">
            These are the same saved relationships shown in each article's Connections section.
            Every line shown here also appears in the graph. DM-only connections appear only in the DM view.
            Select “Focus in graph” to zoom into that page's connections.
          </p>
          {savedConnections.length === 0
            ? <p>No saved connections are visible to this reader.</p>
            : <ol className="connections">
              {savedConnections.map((r, i) => (
                <li key={`${r.from.id}|${r.to.id}|${r.label}|${r.detail ?? ''}|${i}`}>
                  <Link to={`/wiki/${r.from.slug}`}>{r.from.title}</Link>
                  {' — '}{r.label.toLowerCase()}{' → '}
                  <Link to={`/wiki/${r.to.slug}`}>{r.to.title}</Link>
                  {r.detail && <> <span className="muted">({r.detail})</span></>}
                  {' '}
                  <button type="button" className="link-button" onClick={() => {
                    p.set({ focus: r.from.slug, depth: '1', view: null, types: null });
                    setSelected(null);
                    setBrowseConnections(false);
                  }}>Focus in graph</button>
                </li>
              ))}
            </ol>
          }
        </section>
      )}
      <div className="graph-legend" role="group" aria-label="Kinds of page shown">
        <button type="button" className="graph-kind" aria-pressed={p.types.length === 0} onClick={() => p.set({ types: null })}>
          All kinds
        </button>
        {TYPE_ORDER.map((t) => (
          <button key={t} type="button" className={p.types.length > 0 && !p.types.includes(t) ? 'graph-kind off' : 'graph-kind'} aria-pressed={p.types.includes(t)} onClick={() => toggleType(t)}>
            <span className="graph-dot" style={{ background: TYPE_COLOURS[t] }} aria-hidden="true" />
            {TEMPLATES[t].plural}
          </button>
        ))}
      </div>
      {shown && shown.edges.length > 0 && <GraphKey graph={shown} />}
      {data.loading && <p className="muted" role="status">Gathering the pages…</p>}
      {data.error && (
        <div className="notice" role="alert">
          <p>Could not load the graph: {data.error}</p>
          <button type="button" className="button secondary small" onClick={data.reload}>Try again</button>
        </div>
      )}
      {p.focus && full && !centre && <p className="notice">That page is not in the graph. <button type="button" className="link-button" onClick={() => p.set({ focus: null })}>Show the whole graph</button></p>}
      {shown && shown.nodes.length === 0 && !p.focus && <p className="panel">No connected pages to show yet{p.types.length ? ' for these kinds' : ''}.</p>}
      {shown && shown.nodes.length > 0 && (
        p.view === 'list'
          ? <GraphList graph={shown} centre={centre} onFocus={(slug) => p.set({ focus: slug, view: null })} />
          : <GraphCanvas graph={shown} centre={centre} matches={matches} selected={selected} onSelect={setSelected} cluster={cluster} />
      )}
      {selected && shown?.nodes.some((n) => n.id === selected.id) && (
        <Preview node={selected} summary={summaryText(relationshipSummary(shown, selected.id))} onClose={() => setSelected(null)} onFocus={() => { p.set({ focus: selected.slug }); setSelected(null); }} />
      )}
      {shown && <p className="fine-print" data-testid="graph-count">{shown.nodes.length} {shown.nodes.length === 1 ? 'page' : 'pages'}, {shown.edges.length} {shown.edges.length === 1 ? 'line' : 'lines'} shown.</p>}
    </div>
  );
}

/** What the lines mean: solid with an arrow is a connection (named), dashed is a wiki link. */
function GraphKey({ graph }: { graph: Graph }) {
  const entries = legendEntries(graph);
  return (
    <section className="graph-key" aria-label="What the lines mean" data-testid="graph-key">
      <ul>
        {entries.map((e) => (
          <li key={`${e.kind}-${e.label}`}>
            <svg width="34" height="10" aria-hidden="true"><line x1="1" y1="5" x2={e.kind === 'relation' ? 26 : 33} y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={e.kind === 'link' ? '4 3' : undefined} />{e.kind === 'relation' && <path d="M24 1 L33 5 L24 9 Z" fill="currentColor" />}</svg>
            {e.label} <span className="muted">({e.count})</span>
          </li>
        ))}
      </ul>
      <p className="fine-print">Solid line with an arrow: a connection. Dashed line: one page mentions the other.</p>
    </section>
  );
}

function SummaryLine({ items }: { items: SummaryItem[] }) {
  return (
    <>
      {items.map((it, i) => (
        <span key={i}>{it.lead}{it.other && <Link to={`/wiki/${it.other.slug}`}>{it.other.title}</Link>}{it.tail}{i < items.length - 1 ? ', ' : ''}</span>
      ))}
    </>
  );
}

function Preview({ node, summary, onClose, onFocus }: { node: GraphNode; summary: string; onClose: () => void; onFocus: () => void }) {
  const info = useLoad(() => getPagePreview(node.id), [node.id]);
  return (
    <aside className="panel graph-preview" aria-label={`About ${node.title}`} data-testid="graph-preview">
      <div className="graph-preview-head">
        {info.data?.hero_media_id && <MediaImage id={info.data.hero_media_id} alt="" className="graph-preview-img" />}
        <div>
          <div className="card-kind">{TEMPLATES[node.type].label}</div>
          <h2>{node.title}</h2>
        </div>
      </div>
      <p className="graph-summary" data-testid="graph-summary">{summary || 'Not connected to any other page.'}</p>
      {info.data?.summary && <p>{info.data.summary.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').slice(0, 280)}</p>}
      <p className="button-row">
        <Link className="button small" to={`/wiki/${node.slug}`}>Open the page</Link>
        <button type="button" className="button secondary small" onClick={onFocus}>Centre the graph here</button>
        <button type="button" className="button secondary small" onClick={onClose}>Close</button>
      </p>
    </aside>
  );
}

function GraphList({ graph, centre, onFocus }: { graph: Graph; centre: GraphNode | null; onFocus: (slug: string) => void }) {
  const nodes = [...graph.nodes].sort((a, b) => (centre && a.id === centre.id ? -1 : centre && b.id === centre.id ? 1 : a.title.localeCompare(b.title)));
  return (
    <ul className="graph-list" data-testid="graph-list">
      {nodes.map((n) => {
        const summary = relationshipSummary(graph, n.id);
        return (
          <li key={n.id}>
            <div className="graph-list-head">
              <span className="graph-dot" style={{ background: TYPE_COLOURS[n.type] }} aria-hidden="true" />
              <Link to={`/wiki/${n.slug}`}>{n.title}</Link>
              <span className="muted">{TEMPLATES[n.type].label}</span>
              <button type="button" className="link-button" onClick={() => onFocus(n.slug)} aria-label={`Centre the graph on ${n.title}`}>Centre here</button>
            </div>
            {summary.length > 0 && <p className="graph-list-edges graph-list-summary"><SummaryLine items={summary} /></p>}
          </li>
        );
      })}
    </ul>
  );
}

function GraphCanvas({ graph, centre, matches, selected, onSelect, cluster }: {
  graph: Graph; centre: GraphNode | null; matches: Set<string>; selected: GraphNode | null; onSelect: (n: GraphNode | null) => void; cluster: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const view = useRef({ k: 1, x: 0, y: 0 });
  const sim = useRef<Simulation<SimNode, SimEdge> | null>(null);
  const nodes = useRef<SimNode[]>([]);
  const edges = useRef<SimEdge[]>([]);
  const hover = useRef<SimNode | null>(null);
  const highlight = useRef<{ matches: Set<string>; selected: string | null; centre: string | null; cluster: Set<string> | null }>({ matches, selected: selected?.id ?? null, centre: centre?.id ?? null, cluster: null });
  // Keyboard focus on a page (arrow keys), announced to screen readers.
  const kb = useRef<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const anim = useRef(0);
  const placeLoners = useRef<() => void>(() => undefined);
  const draw = useRef<() => void>(() => undefined);
  // Once the reader pans or zooms, the view is theirs: no more automatic fitting.
  const userMoved = useRef(false);
  const fit = useRef<() => void>(() => undefined);
  // Declared before the simulation effect below, so it is ready when the layout settles.
  useEffect(() => {
    fit.current = () => {
    placeLoners.current();
    const c = canvasRef.current;
    const placed = nodes.current.filter((n) => n.x !== undefined);
    if (!c || placed.length === 0) return;
    const xs = placed.map((n) => n.x!);
    const ys = placed.map((n) => n.y!);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = 60;
    const k = Math.min(2.5, Math.max(0.1, Math.min(c.clientWidth / (maxX - minX + pad * 2), c.clientHeight / (maxY - minY + pad * 2))));
    view.current = { k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k };
    draw.current();
    };
  }, []);
  const [ready, setReady] = useState(false);

  // Build the simulation whenever the shown graph changes. Positions of pages that stay are kept.
  useEffect(() => {
    const old = new Map(nodes.current.map((n) => [n.id, n]));
    nodes.current = graph.nodes.map((n) => {
      const o = old.get(n.id);
      return { ...n, x: o?.x, y: o?.y };
    });
    edges.current = graph.edges.map((e) => ({ ...e, source: e.source, target: e.target }));
    // Pages with no line in this view wait in a neat ring around the edge instead of drifting in the force layout.
    const linked = new Set(graph.edges.flatMap((e) => [e.source, e.target]));
    const connected = nodes.current.filter((n) => linked.has(n.id));
    const loners = nodes.current.filter((n) => !linked.has(n.id));
    placeLoners.current = () => {
      if (loners.length === 0) return;
      const placed = connected.filter((n) => n.x !== undefined);
      const inner = (placed.length ? Math.max(...placed.map((n) => Math.hypot(n.x!, n.y!))) : 0) + 70;
      ringPositions(loners.length, inner).forEach((p, i) => { loners[i]!.x = p.x; loners[i]!.y = p.y; });
    };
    const big = nodes.current.length > 600;
    if (big) {
      // Large wikis: lay out in a worker (about 1.5 s for 3,000 pages), then draw once.
      const worker = new Worker(new URL('../lib/graphLayout.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<[string, number, number][]>) => {
        const pos = new Map(ev.data.map(([id, x, y]) => [id, { x, y }]));
        for (const n of connected) {
          const q = pos.get(n.id);
          if (q) { n.x = q.x; n.y = q.y; }
        }
        // Resolve edge ends to the node objects for drawing.
        const byId = new Map(nodes.current.map((n) => [n.id, n]));
        for (const e of edges.current) {
          e.source = byId.get(e.source as string) ?? e.source;
          e.target = byId.get(e.target as string) ?? e.target;
        }
        sim.current = null;
        placeLoners.current();
        if (!userMoved.current) fit.current();
        draw.current();
        setReady(true);
        worker.terminate();
      };
      worker.postMessage({ nodes: connected.map((n) => ({ id: n.id, x: n.x, y: n.y })), edges: graph.edges.map((e) => ({ source: e.source, target: e.target })) });
      return () => worker.terminate();
    }
    const s = forceSimulation<SimNode, SimEdge>(connected)
      .force('link', forceLink<SimNode, SimEdge>(edges.current).id((d) => d.id).distance((e) => (e.kind === 'relation' ? 70 : 90)).strength(0.4))
      .force('charge', forceManyBody<SimNode>().strength(-160).theta(0.9))
      .force('centre', forceCenter(0, 0))
      .force('collide', forceCollide<SimNode>((n) => radius(n) + 3));
    sim.current = s;
    placeLoners.current();
    if (prefersReducedMotion()) {
      // Settle without animation: a fixed number of steps, then draw once.
      s.stop();
      const steps = Math.min(300, Math.ceil(Math.log(s.alphaMin()) / Math.log(1 - s.alphaDecay())));
      for (let i = 0; i < steps; i++) s.tick();
      placeLoners.current();
      if (!userMoved.current) fit.current();
      draw.current();
      requestAnimationFrame(() => setReady(true));
    } else {
      let ticks = 0;
      s.on('tick', () => {
        ticks++;
        placeLoners.current();
        if (!userMoved.current && ticks % 20 === 0) fit.current();
        draw.current();
      });
      s.on('end', () => {
        placeLoners.current();
        if (!userMoved.current) fit.current();
        setReady(true);
      });
    }
    return () => {
      s.stop();
    };
  }, [graph]);

  // Drawing.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    draw.current = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const { k, x, y } = view.current;
      const text = cssVar('--text', '#2b2118');
      const bg = cssVar('--surface-2', '#efe2c2');
      const line = cssVar('--muted', '#6b5d48');
      const hl = highlight.current;
      const searching = hl.matches.size > 0;
      const cl = hl.cluster;
      const edgeLabels: { x: number; y: number; text: string }[] = [];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 + x, h / 2 + y);
      ctx.scale(k, k);
      // Lines.
      for (const e of edges.current) {
        const s = e.source as SimNode;
        const t = e.target as SimNode;
        if (s.x === undefined || t.x === undefined) continue;
        const lit = hl.selected && (s.id === hl.selected || t.id === hl.selected);
        ctx.globalAlpha = cl && !(cl.has(s.id) && cl.has(t.id)) ? 0.06 : searching && !(hl.matches.has(s.id) || hl.matches.has(t.id)) ? 0.12 : lit ? 0.95 : 0.45;
        ctx.strokeStyle = lit ? cssVar('--gold', '#b08a2e') : line;
        ctx.lineWidth = (lit ? 2.2 : 1.1) / Math.sqrt(k);
        ctx.setLineDash(e.kind === 'link' ? [4 / k, 4 / k] : []);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y!);
        ctx.lineTo(t.x, t.y!);
        ctx.stroke();
        if (lit && k > 0.3) edgeLabels.push({ x: (s.x + t.x) / 2, y: (s.y! + t.y!) / 2, text: e.kind === 'link' ? 'mentions' : (e.detail ?? e.label) });
        if (e.kind === 'relation' && k > 0.5) {
          // Arrow head at the target's edge.
          const dx = t.x - s.x;
          const dy = t.y! - s.y!;
          const len = Math.hypot(dx, dy) || 1;
          const r = radius(t) + 2;
          const ax = t.x - (dx / len) * r;
          const ay = t.y! - (dy / len) * r;
          const size = 6 / Math.sqrt(k);
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax - (dx / len) * size - (dy / len) * size * 0.6, ay - (dy / len) * size + (dx / len) * size * 0.6);
          ctx.lineTo(ax - (dx / len) * size + (dy / len) * size * 0.6, ay - (dy / len) * size - (dx / len) * size * 0.6);
          ctx.closePath();
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fill();
        }
      }
      ctx.setLineDash([]);
      // Pages.
      for (const n of nodes.current) {
        if (n.x === undefined) continue;
        const dim = (searching && !hl.matches.has(n.id)) || (cl !== null && !cl.has(n.id));
        const special = n.id === hl.selected || n.id === hl.centre || hl.matches.has(n.id) || n === hover.current || n.id === kb.current;
        ctx.globalAlpha = dim ? 0.2 : 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y!, radius(n) * (special ? 1.35 : 1), 0, Math.PI * 2);
        ctx.fillStyle = TYPE_COLOURS[n.type];
        ctx.fill();
        ctx.lineWidth = (special ? 3 : 1.2) / Math.sqrt(k);
        ctx.strokeStyle = special ? cssVar('--gold', '#b08a2e') : bg;
        ctx.stroke();
        // Labels when zoomed in, for well-connected pages, and for anything highlighted.
        if (!dim && (special || k > 1.4 || (k > 0.8 && n.degree >= 3) || nodes.current.length < 40)) {
          ctx.font = `${special ? 700 : 500} ${12 / Math.sqrt(k)}px ${cssVar('--font-ui', 'sans-serif')}`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 3 / Math.sqrt(k);
          ctx.strokeStyle = bg;
          ctx.strokeText(n.title, n.x, n.y! + radius(n) + 13 / Math.sqrt(k));
          ctx.fillStyle = text;
          ctx.fillText(n.title, n.x, n.y! + radius(n) + 13 / Math.sqrt(k));
        }
      }
      // The names of the lines touching the selected page, on top of everything.
      ctx.globalAlpha = 1;
      ctx.font = `600 ${12 / Math.sqrt(k)}px ${cssVar('--font-ui', 'sans-serif')}`;
      ctx.textAlign = 'center';
      for (const l of edgeLabels) {
        ctx.lineWidth = 4 / Math.sqrt(k);
        ctx.strokeStyle = bg;
        ctx.strokeText(l.text, l.x, l.y - 4 / Math.sqrt(k));
        ctx.fillStyle = text;
        ctx.fillText(l.text, l.x, l.y - 4 / Math.sqrt(k));
      }
    };
    const ro = new ResizeObserver(() => draw.current());
    ro.observe(canvas);
    draw.current();
    return () => ro.disconnect();
  }, []);

  // Move the view to a page: a short ease, or at once when the reader prefers reduced motion.
  const animateTo = (to: { k: number; x: number; y: number }) => {
    cancelAnimationFrame(anim.current);
    userMoved.current = true;
    const from = { ...view.current };
    if (prefersReducedMotion()) {
      view.current = to;
      draw.current();
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / 350;
      view.current = easeView(from, to, t);
      draw.current();
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  // Redraw when the highlight changes; bring a newly selected page (for example a search match) into view.
  useEffect(() => {
    highlight.current = { matches, selected: selected?.id ?? null, centre: centre?.id ?? null, cluster: cluster && selected ? connectedCluster(graph, selected.id) : null };
    if (selected) {
      const n = nodes.current.find((x) => x.id === selected.id);
      if (n?.x !== undefined) {
        const k = Math.max(view.current.k, 1.2);
        animateTo({ k, x: -n.x * k, y: -n.y! * k });
        return;
      }
    }
    draw.current();
    // animateTo only touches refs.
  }, [matches, selected, centre, cluster, graph]);

  // ---- pointer handling: pan, drag a page, pinch, tap ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'pan' | 'node' | 'pinch'; node?: SimNode; startDist?: number; startK?: number; moved: boolean; sx: number; sy: number; vx: number; vy: number } | null>(null);
  const toWorld = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const { k, x, y } = view.current;
    return { x: (clientX - r.left - r.width / 2 - x) / k, y: (clientY - r.top - r.height / 2 - y) / k };
  };
  const nodeAt = (clientX: number, clientY: number) => {
    const w = toWorld(clientX, clientY);
    const tree = quadtree<SimNode>().x((n) => n.x ?? 0).y((n) => n.y ?? 0).addAll(nodes.current.filter((n) => n.x !== undefined));
    const hit = tree.find(w.x, w.y, 24 / view.current.k);
    return hit && Math.hypot((hit.x ?? 0) - w.x, (hit.y ?? 0) - w.y) <= radius(hit) + 10 / view.current.k ? hit : null;
  };
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const v = view.current;
    const k = Math.min(6, Math.max(0.1, v.k * factor));
    const px = clientX - r.left - r.width / 2;
    const py = clientY - r.top - r.height / 2;
    view.current = { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    userMoved.current = true;
    draw.current();
  };
  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', startDist: Math.hypot(a!.x - b!.x, a!.y - b!.y), startK: view.current.k, moved: true, sx: 0, sy: 0, vx: view.current.x, vy: view.current.y };
      return;
    }
    const n = nodeAt(e.clientX, e.clientY);
    gesture.current = { kind: n ? 'node' : 'pan', node: n ?? undefined, moved: false, sx: e.clientX, sy: e.clientY, vx: view.current.x, vy: view.current.y };
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!pointers.current.has(e.pointerId)) {
      const n = nodeAt(e.clientX, e.clientY);
      if (n !== hover.current) {
        hover.current = n;
        canvasRef.current!.style.cursor = n ? 'pointer' : 'grab';
        draw.current();
      }
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!g) return;
    if (g.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      zoomAt(mid.x, mid.y, (g.startK! * Math.hypot(a.x - b.x, a.y - b.y)) / g.startDist! / view.current.k);
      return;
    }
    if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 4) g.moved = true;
    if (!g.moved) return;
    if (g.kind === 'pan') {
      userMoved.current = true;
      view.current = { ...view.current, x: g.vx + (e.clientX - g.sx), y: g.vy + (e.clientY - g.sy) };
      draw.current();
    } else if (g.node) {
      const w = toWorld(e.clientX, e.clientY);
      g.node.fx = w.x;
      g.node.fy = w.y;
      sim.current?.alphaTarget(0.2).restart();
    }
  };
  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'node' && g.node) {
      g.node.fx = null;
      g.node.fy = null;
      sim.current?.alphaTarget(0);
      if (!g.moved) onSelect(graph.nodes.find((n) => n.id === g.node!.id) ?? null);
    } else if (g.kind === 'pan' && !g.moved) {
      onSelect(null);
    }
  };
  const onWheel = (e: WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };
  // React's wheel listener is passive; register a non-passive one so the page does not scroll.
  useEffect(() => {
    const c = canvasRef.current!;
    const stop = (e: globalThis.WheelEvent) => e.preventDefault();
    c.addEventListener('wheel', stop, { passive: false });
    return () => c.removeEventListener('wheel', stop);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const dirs: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    const dir = dirs[e.key];
    if (dir) {
      e.preventDefault();
      const pts = nodes.current.filter((n) => n.x !== undefined).map((n) => ({ id: n.id, x: n.x!, y: n.y! }));
      const next = nearestInDirection(pts, kb.current ?? selected?.id ?? null, dir);
      const n = next ? nodes.current.find((x) => x.id === next) : undefined;
      if (!n) return;
      kb.current = n.id;
      setAnnounce(`${n.title}, ${TEMPLATES[n.type].label}, ${n.degree === 1 ? '1 connection' : `${n.degree} connections`}. Press Enter for details.`);
      // Bring it into view if it lies near or beyond an edge.
      const c = canvasRef.current!;
      const { k, x, y } = view.current;
      const sx = c.clientWidth / 2 + x + n.x! * k;
      const sy = c.clientHeight / 2 + y + n.y! * k;
      if (sx < 40 || sy < 40 || sx > c.clientWidth - 40 || sy > c.clientHeight - 40) animateTo({ k, x: -n.x! * k, y: -n.y! * k });
      else draw.current();
    } else if (e.key === 'Enter' && kb.current) {
      e.preventDefault();
      onSelect(graph.nodes.find((n) => n.id === kb.current) ?? null);
    } else if (e.key === 'Escape') {
      kb.current = null;
      onSelect(null);
      draw.current();
    }
  };

  return (
    <div className="graph-wrap" ref={wrapRef}>
      <div className="family-controls graph-controls" role="group" aria-label="Graph view">
        <button type="button" className="button secondary small" aria-label="Zoom in" onClick={() => { userMoved.current = true; view.current.k = Math.min(6, view.current.k * 1.25); draw.current(); }}>+</button>
        <button type="button" className="button secondary small" aria-label="Zoom out" onClick={() => { userMoved.current = true; view.current.k = Math.max(0.1, view.current.k * 0.8); draw.current(); }}>−</button>
        <button type="button" className="button secondary small" onClick={() => { userMoved.current = false; fit.current(); }}>Reset view</button>
        <span className="fine-print family-hint">Drag to move · wheel or pinch to zoom · tap a page for details{ready ? '' : ' · arranging…'}</span>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">{announce}</p>
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        data-testid="graph-canvas"
        role="application"
        tabIndex={0}
        aria-label={`Graph of ${graph.nodes.length} pages. Use the arrow keys to move between pages and Enter to open details, or “Show as a list” for a text version.`}
        onKeyDown={onKeyDown}
        onBlur={() => { if (kb.current) { kb.current = null; draw.current(); } }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => { if (!gesture.current && hover.current) { hover.current = null; draw.current(); } }}
        onWheel={onWheel}
        onDoubleClick={(e) => {
          const n = nodeAt(e.clientX, e.clientY);
          if (n) navigate(`/wiki/${n.slug}`);
        }}
      />
    </div>
  );
}
