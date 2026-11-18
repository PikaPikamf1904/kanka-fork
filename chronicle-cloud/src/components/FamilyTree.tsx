import { useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { loadFamily, mediaUrls } from '../lib/api.ts';
import { layoutFamily, type FamilyLayout, type PlacedPerson } from '../lib/familyTree.ts';
import { useLoad } from '../lib/useLoad.ts';

const COL = 184;
const ROW = 120;
const NODE_W = 160;
const NODE_H = 60;
const PAD = 24;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;

const centre = (l: FamilyLayout, p: PlacedPerson) => ({
  x: PAD + p.x * COL + NODE_W / 2,
  y: PAD + (p.generation - l.minGeneration) * ROW + NODE_H / 2,
});

function initials(title: string) {
  return title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

/** Family tree of one character, drawn from stored family connections the reader may see. */
export function FamilyTree({ slug, compact = false }: { slug: string; compact?: boolean }) {
  const data = useLoad(() => loadFamily(slug), [slug]);
  const layout = useMemo(() => (data.data ? layoutFamily(data.data.rootId, data.data.people, data.data.edges) : null), [data.data]);
  const heroIds = useMemo(() => (layout?.people.map((p) => p.heroMediaId).filter((x): x is string => !!x) ?? []), [layout]);
  const portraits = useLoad(() => (heroIds.length ? mediaUrls(heroIds) : Promise.resolve(new Map<string, string>())), [heroIds.join(',')]);
  const navigate = useNavigate();
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; id: number } | null>(null);

  if (data.loading) return <p className="muted" role="status">Drawing the family tree…</p>;
  if (data.error) return <p className="form-error" role="alert">Could not load the family: {data.error}</p>;
  if (!layout || layout.people.length < 2) {
    return compact ? null : <p className="muted">No family is recorded for this character yet{' '}(connections “Parent of”, “Spouse of” or “Sibling of”).</p>;
  }

  const byId = new Map(layout.people.map((p) => [p.id, p]));
  const width = PAD * 2 + layout.columns * COL - (COL - NODE_W);
  const height = PAD * 2 + (layout.maxGeneration - layout.minGeneration) * ROW + NODE_H;
  const root = layout.people.find((p) => p.relation === 'this character')!;
  const zoom = (factor: number) => setView((v) => ({ ...v, k: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor)) }));

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest('a')) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const scale = width / e.currentTarget.getBoundingClientRect().width;
    setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x) * scale, y: d.vy + (e.clientY - d.y) * scale }));
  };
  const onPointerUp = () => { drag.current = null; };
  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    if (!e.ctrlKey && !e.metaKey && compact) return; // let a compact panel scroll the page
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };

  const groups = new Map<string, PlacedPerson[]>();
  for (const p of layout.people) if (p !== root) groups.set(p.relation, [...(groups.get(p.relation) ?? []), p]);

  return (
    <div className={compact ? 'family-tree family-tree-compact' : 'family-tree'}>
      <div className="family-controls" role="group" aria-label="Family tree view">
        <button type="button" className="button secondary small" onClick={() => zoom(1.25)} aria-label="Zoom in">+</button>
        <button type="button" className="button secondary small" onClick={() => zoom(0.8)} aria-label="Zoom out">−</button>
        <button type="button" className="button secondary small" onClick={() => setView({ k: 1, x: 0, y: 0 })}>Reset view</button>
        <span className="fine-print family-hint">Drag to move · {compact ? 'Ctrl + wheel' : 'wheel'} to zoom</span>
      </div>
      <svg
        className="family-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`Family tree of ${root.title}`}
        data-testid="family-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <g transform={`translate(${view.x} ${view.y}) translate(${width / 2} ${height / 2}) scale(${view.k}) translate(${-width / 2} ${-height / 2})`} data-testid="family-canvas">
          {layout.lines.map((l) => {
            const a = byId.get(l.from)!;
            const b = byId.get(l.to)!;
            const ca = centre(layout, a);
            const cb = centre(layout, b);
            if (l.kind === 'parent_of') {
              const y1 = ca.y + NODE_H / 2;
              const y2 = cb.y - NODE_H / 2;
              const mid = (y1 + y2) / 2;
              return <path key={`${l.kind}${l.from}${l.to}`} className="family-line" d={`M${ca.x} ${y1} V${mid} H${cb.x} V${y2}`} />;
            }
            const [left, right] = ca.x <= cb.x ? [ca, cb] : [cb, ca];
            return <line key={`${l.kind}${l.from}${l.to}`} className={`family-line family-${l.kind}`} x1={left.x + NODE_W / 2} y1={left.y} x2={right.x - NODE_W / 2} y2={right.y} />;
          })}
          {layout.people.map((p) => {
            const c = centre(layout, p);
            const url = p.heroMediaId ? portraits.data?.get(p.heroMediaId) : undefined;
            const isRoot = p === root;
            return (
              <a
                key={p.id}
                href={`/wiki/${p.slug}`}
                className={isRoot ? 'family-node family-root' : 'family-node'}
                aria-label={isRoot ? `${p.title} (this character)` : `${p.title}, ${p.relation} of ${root.title}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/wiki/${p.slug}`);
                }}
              >
                <rect x={c.x - NODE_W / 2} y={c.y - NODE_H / 2} width={NODE_W} height={NODE_H} rx="10" />
                {url ? (
                  <image href={url} x={c.x - NODE_W / 2 + 8} y={c.y - 20} width="40" height="40" preserveAspectRatio="xMidYMid slice" clipPath="inset(0 round 20px)" />
                ) : (
                  <>
                    <circle cx={c.x - NODE_W / 2 + 28} cy={c.y} r="20" className="family-initials-bg" />
                    <text x={c.x - NODE_W / 2 + 28} y={c.y + 5} textAnchor="middle" className="family-initials" aria-hidden="true">{initials(p.title)}</text>
                  </>
                )}
                <text x={c.x - NODE_W / 2 + 56} y={c.y - 4} className="family-name">{p.title.length > 15 ? `${p.title.slice(0, 14)}…` : p.title}</text>
                <text x={c.x - NODE_W / 2 + 56} y={c.y + 14} className="family-rel">{p.relation}{p.more ? ' · more' : ''}</text>
                <title>{p.title}</title>
              </a>
            );
          })}
        </g>
      </svg>
      {compact ? (
        <p><Link to={`/family/${root.slug}`}>Open the full family tree</Link></p>
      ) : (
        <section className="family-list" aria-labelledby="family-list-title">
          <h2 id="family-list-title">Family of {root.title}</h2>
          <dl className="connections">
            {[...groups.entries()].map(([rel, people]) => (
              <div key={rel}>
                <dt>{rel[0]!.toUpperCase() + rel.slice(1)}</dt>
                <dd>
                  {people.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ', '}
                      <Link to={`/wiki/${p.slug}`}>{p.title}</Link>
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
