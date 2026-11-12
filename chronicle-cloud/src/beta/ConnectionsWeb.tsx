import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router';
import { relationLabel, TEMPLATES } from '../lib/templates.ts';
import type { ArticleRef, Relation } from '../lib/types.ts';
import { layout } from './graphLayout.ts';

type Rel = Relation & { source: ArticleRef; target: ArticleRef };
const W = 1000;
const H = 700;
const pageLink = (a: ArticleRef) => (a.type === 'news' ? `/news/${a.slug}` : `/wiki/${a.slug}`);

/**
 * The connections drawn as a web. Click (or Tab to and press Enter on) a page to light up who it
 * is connected to; drag to move around; zoom with the buttons, the mouse wheel or a pinch.
 */
export function ConnectionsWeb({ relations }: { relations: Rel[] }) {
  const { nodes, edges, pos } = useMemo(() => {
    const map = new Map<string, ArticleRef & { degree: number }>();
    for (const r of relations) {
      for (const a of [r.source, r.target]) {
        const n = map.get(a.slug) ?? { ...a, degree: 0 };
        n.degree += 1;
        map.set(a.slug, n);
      }
    }
    const nodes = [...map.values()].sort((a, b) => a.slug.localeCompare(b.slug));
    const edges = relations.map((r) => ({ id: r.id, source: r.source.slug, target: r.target.slug, kind: r.kind, label: r.label }));
    return { nodes, edges, pos: layout(nodes.map((n) => n.slug), edges, { width: W, height: H }) };
  }, [relations]);

  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: typeof view; x: number; y: number; dist: number } | null>(null);

  // A non-passive wheel listener, so zooming the web does not also scroll the page.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => zoomAt(v, e.deltaY < 0 ? 1.15 : 1 / 1.15, toSvg(el, e.clientX, e.clientY)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const neighbours = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set(edges.flatMap((e) => (e.source === selected ? [e.target] : e.target === selected ? [e.source] : [])));
  }, [selected, edges]);
  const sel = nodes.find((n) => n.slug === selected) ?? null;
  const selEdges = selected ? relations.filter((r) => r.source.slug === selected || r.target.slug === selected) : [];
  const showAllLabels = nodes.length <= 40 || view.k >= 1.6;

  function down(e: PointerEvent<SVGSVGElement>) {
    if ((e.target as Element).closest('.web-node')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current = { view, ...centre() };
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(e.pointerId) || !gesture.current || !svg.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const now = centre();
    const scale = W / svg.current.getBoundingClientRect().width;
    let v = { ...g.view, x: g.view.x + (now.x - g.x) * scale, y: g.view.y + (now.y - g.y) * scale };
    if (g.dist > 0 && now.dist > 0) v = zoomAt(v, now.dist / g.dist, toSvg(svg.current, now.x, now.y));
    setView(v);
  }
  function up(e: PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    gesture.current = pointers.current.size ? { view, ...centre() } : null;
  }
  function centre() {
    const pts = [...pointers.current.values()];
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
      dist: pts.length > 1 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0,
    };
  }

  if (nodes.length === 0) return <p className="muted">No connections to draw yet.</p>;
  return (
    <div className="web">
      <div className="web-tools row-wrap">
        <button type="button" className="button secondary small" onClick={() => setView((v) => zoomAt(v, 1.3, { x: W / 2, y: H / 2 }))}>Zoom in</button>
        <button type="button" className="button secondary small" onClick={() => setView((v) => zoomAt(v, 1 / 1.3, { x: W / 2, y: H / 2 }))}>Zoom out</button>
        <button type="button" className="button secondary small" onClick={() => { setView({ k: 1, x: 0, y: 0 }); setSelected(null); }}>Reset</button>
        <span className="fine-print">{nodes.length} pages · {edges.length} connections. Click a page to see its connections.</span>
      </div>
      <div className="web-stage">
        <svg
          ref={svg}
          className="web-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="group"
          aria-label="Connections web"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onClick={(e) => { if (!(e.target as Element).closest('.web-node')) setSelected(null); }}
          data-testid="connections-web"
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {edges.map((e) => {
              const a = pos.get(e.source)!;
              const b = pos.get(e.target)!;
              const lit = selected !== null && (e.source === selected || e.target === selected);
              return (
                <g key={e.id} className={lit ? 'web-edge lit' : selected ? 'web-edge dim' : 'web-edge'}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                  {lit && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} className="web-edge-label">{relationLabel(e.kind)}</text>}
                </g>
              );
            })}
            {nodes.map((n) => {
              const p = pos.get(n.slug)!;
              const isSel = n.slug === selected;
              const lit = isSel || neighbours.has(n.slug);
              const r = 7 + Math.min(n.degree, 8) * 1.5;
              return (
                <g
                  key={n.slug}
                  className={`web-node web-type-${n.type}${isSel ? ' selected' : ''}${selected && !lit ? ' dim' : ''}`}
                  transform={`translate(${p.x} ${p.y})`}
                  tabIndex={0}
                  role="button"
                  aria-pressed={isSel}
                  aria-label={`${n.title}, ${TEMPLATES[n.type]?.label ?? n.type}, ${n.degree} connection${n.degree === 1 ? '' : 's'}`}
                  onClick={() => setSelected(isSel ? null : n.slug)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(isSel ? null : n.slug); } }}
                >
                  <circle r={r} />
                  {(showAllLabels || lit || n.degree >= 3) && <text y={r + 13}>{n.title}</text>}
                </g>
              );
            })}
          </g>
        </svg>
        {sel && (
          <aside className="web-panel" aria-label={`Connections of ${sel.title}`}>
            <p className="web-panel-type">{TEMPLATES[sel.type]?.glyph} {TEMPLATES[sel.type]?.label ?? sel.type}</p>
            <h2><Link to={pageLink(sel)}>{sel.title}</Link></h2>
            <ul>
              {selEdges.map((r) => {
                const out = r.source.slug === sel.slug;
                const other = out ? r.target : r.source;
                return (
                  <li key={r.id}>
                    <span className="muted">{out ? relationLabel(r.kind) : `${relationLabel(r.kind)} (from)`}</span>{' '}
                    <button type="button" className="link-button" onClick={() => setSelected(other.slug)}>{other.title}</button>
                    {r.label && <span className="muted"> · {r.label}</span>}
                  </li>
                );
              })}
            </ul>
            <Link className="button small" to={pageLink(sel)}>Open page</Link>
          </aside>
        )}
      </div>
      <p className="web-legend" aria-hidden="true">
        {[...new Set(nodes.map((n) => n.type))].map((t) => (
          <span key={t} className={`web-legend-item web-type-${t}`}><svg width="12" height="12"><circle cx="6" cy="6" r="5" /></svg> {TEMPLATES[t]?.plural ?? t}</span>
        ))}
      </p>
    </div>
  );
}

function toSvg(el: SVGSVGElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect();
  return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
}

function zoomAt(v: { k: number; x: number; y: number }, factor: number, at: { x: number; y: number }) {
  const k = Math.min(4, Math.max(0.4, v.k * factor));
  const f = k / v.k;
  return { k, x: at.x - (at.x - v.x) * f, y: at.y - (at.y - v.y) * f };
}
