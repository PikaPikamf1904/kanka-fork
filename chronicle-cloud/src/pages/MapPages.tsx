import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { VisibilityBadge } from '../components/Badges.tsx';
import { deleteFogArea, deleteMarker, getMap, listAllArticleRefs, listMaps, mediaUrls, saveFogArea, saveMarker, setMapFog } from '../lib/api.ts';
import { useIsDm } from '../lib/session.tsx';
import type { MapFogArea, MapMarker, Visibility, WikiMap } from '../lib/types.ts';
import { useLoad } from '../lib/useLoad.ts';
import { NotFound } from './NotFound.tsx';

export function MapsPage() {
  const isDm = useIsDm();
  const maps = useLoad(listMaps, [isDm]);
  const roots = (maps.data ?? []).filter((m) => !m.parent_map_id || !(maps.data ?? []).some((p) => p.id === m.parent_map_id));
  const children = (id: string) => (maps.data ?? []).filter((m) => m.parent_map_id === id);
  const renderTree = (list: WikiMap[]) => (
    <ul className="map-tree">
      {list.map((m) => (
        <li key={m.id}>
          <Link to={`/maps/${m.slug}`}>{m.title}</Link>
          {isDm && m.visibility === 'dm' && <VisibilityBadge visibility="dm" />}
          {m.description && <span className="muted"> · {m.description}</span>}
          {children(m.id).length > 0 && renderTree(children(m.id))}
        </li>
      ))}
    </ul>
  );
  return (
    <div>
      <div className="toolbar">
        <h1 className="page-title">Maps</h1>
        {isDm && <Link className="button" to="/dm/maps/new">New map</Link>}
      </div>
      {maps.error && <p className="form-error">{maps.error}</p>}
      {maps.data?.length === 0 && <p className="muted">No maps have been revealed yet.</p>}
      <section className="panel">{renderTree(roots)}</section>
    </div>
  );
}

type MarkerRow = MapMarker & { article: { slug: string; title: string } | null; submap?: { slug: string; title: string } | null };

// Markers are stored in image pixels from the top-left corner. Leaflet's simple CRS counts
// latitude upwards from the bottom, so y is flipped at this boundary only.
const toLatLng = (map: WikiMap, x: number, y: number): L.LatLngTuple => [map.height - y, x];
const fromLatLng = (map: WikiMap, latlng: L.LatLng) => ({ x: Math.round(latlng.lng), y: Math.round(map.height - latlng.lat) });

function markerIcon(label: string, hidden: boolean) {
  const safe = label.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return L.divIcon({
    className: hidden ? 'map-pin map-pin-dm' : 'map-pin',
    html: `<span class="map-pin-dot" aria-hidden="true">✦</span><span class="map-pin-label">${safe}</span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export function MapPage() {
  const { slug = '' } = useParams();
  const isDm = useIsDm();
  const navigate = useNavigate();
  const data = useLoad(async () => {
    const d = await getMap(slug);
    if (!d) return null;
    const urls = d.map.media_id ? await mediaUrls([d.map.media_id]) : new Map<string, string>();
    return { ...d, imageUrl: d.map.media_id ? urls.get(d.map.media_id) ?? null : null };
  }, [slug, isDm]);
  const articles = useLoad(() => (isDm ? listAllArticleRefs() : Promise.resolve([])), [isDm]);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Partial<MarkerRow> | null>(null);
  const [addMode, setAddMode] = useState(false);
  // Fog of war (DM): corners of the area being drawn, and the area being named/revealed.
  const [drawing, setDrawing] = useState<[number, number][] | null>(null);
  const [fogEditing, setFogEditing] = useState<Partial<MapFogArea> | null>(null);
  const fogLayerRef = useRef<L.Layer | null>(null);
  const draftLayerRef = useRef<L.Layer | null>(null);

  const markers = useMemo(() => data.data?.markers ?? [], [data.data]);
  const shown = markers.filter((m) => m.label.toLowerCase().includes(filter.toLowerCase()));

  // Create the Leaflet map once per map image.
  useEffect(() => {
    const d = data.data;
    if (!d || !container.current) return;
    const bounds: L.LatLngBoundsExpression = [[0, 0], [d.map.height, d.map.width]];
    const map = L.map(container.current, { crs: L.CRS.Simple, minZoom: -4, maxZoom: 3, zoomSnap: 0.25, attributionControl: false });
    if (d.imageUrl) L.imageOverlay(d.imageUrl, bounds).addTo(map);
    else L.rectangle(bounds, { color: '#8a6d3b', weight: 1, fillColor: '#efe2c2', fillOpacity: 1 }).addTo(map);
    map.fitBounds(bounds);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [data.data]);

  // Draw markers (only what the server returned; hidden markers never reach a player's browser).
  useEffect(() => {
    const layer = layerRef.current;
    const current = data.data?.map;
    if (!layer || !current) return;
    layer.clearLayers();
    for (const m of shown) {
      const marker = L.marker(toLatLng(current, m.x, m.y), { icon: markerIcon(m.label, isDm && m.visibility === 'dm'), title: m.label, keyboard: true });
      const popup = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = m.label;
      popup.append(title);
      if (m.description) {
        const p = document.createElement('p');
        p.textContent = m.description;
        popup.append(p);
      }
      if (m.article) {
        const a = document.createElement('a');
        a.href = `/wiki/${m.article.slug}`;
        a.textContent = `Read: ${m.article.title}`;
        popup.append(a);
      }
      if (m.submap) {
        const open = document.createElement('a');
        open.href = `/maps/${m.submap.slug}`;
        open.className = 'popup-map-link';
        open.textContent = `Open map: ${m.submap.title}`;
        open.addEventListener('click', (e) => {
          e.preventDefault();
          navigate(`/maps/${m.submap!.slug}`);
        });
        popup.append(open);
      }
      marker.bindPopup(popup);
      if (isDm) marker.on('dblclick', () => setEditing(m));
      marker.addTo(layer);
    }
  }, [shown, isDm, data.data, navigate]);

  // Fog: the whole map is covered except revealed areas (cut out with an SVG mask, so overlapping
  // areas stay clear). The DM sees through a lighter fog, with every area outlined.
  useEffect(() => {
    const map = mapRef.current;
    const d = data.data;
    fogLayerRef.current?.remove();
    fogLayerRef.current = null;
    if (!map || !d || !d.map.fog_enabled) return;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${d.map.width} ${d.map.height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('map-fog');
    if (isDm) svg.classList.add('map-fog-dm');
    const maskId = `fog-mask-${d.map.id}`;
    const pts = (a: MapFogArea) => a.points.map(([x, y]) => `${x},${y}`).join(' ');
    const mask = document.createElementNS(ns, 'mask');
    mask.setAttribute('id', maskId);
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    const all = document.createElementNS(ns, 'rect');
    for (const [k, v] of [['x', '0'], ['y', '0'], ['width', String(d.map.width)], ['height', String(d.map.height)], ['fill', 'white']] as [string, string][]) all.setAttribute(k, v);
    mask.append(all);
    for (const a of d.fog.filter((f) => f.visibility === 'players')) {
      const hole = document.createElementNS(ns, 'polygon');
      hole.setAttribute('points', pts(a));
      hole.setAttribute('fill', 'black');
      mask.append(hole);
    }
    const defs = document.createElementNS(ns, 'defs');
    defs.append(mask);
    const cover = document.createElementNS(ns, 'rect');
    for (const [k, v] of [['x', '0'], ['y', '0'], ['width', String(d.map.width)], ['height', String(d.map.height)], ['mask', `url(#${maskId})`], ['class', 'map-fog-cover']] as [string, string][]) cover.setAttribute(k, v);
    svg.append(defs, cover);
    if (isDm) {
      for (const a of d.fog) {
        const outline = document.createElementNS(ns, 'polygon');
        outline.setAttribute('points', pts(a));
        outline.setAttribute('class', a.visibility === 'players' ? 'map-fog-area revealed' : 'map-fog-area fogged');
        svg.append(outline);
      }
    }
    const layer = L.svgOverlay(svg, [[0, 0], [d.map.height, d.map.width]], { interactive: false });
    layer.addTo(map);
    fogLayerRef.current = layer;
    return () => {
      layer.remove();
    };
  }, [data.data, isDm]);

  // Fog (DM): each click adds a corner of the area being drawn.
  useEffect(() => {
    const map = mapRef.current;
    const d = data.data;
    draftLayerRef.current?.remove();
    draftLayerRef.current = null;
    if (!map || !d || !isDm || !drawing) return;
    if (drawing.length > 0) {
      const line = L.polyline(drawing.map(([x, y]) => toLatLng(d.map, x, y)), { color: '#e0b64d', weight: 2, dashArray: '4 4', interactive: false });
      line.addTo(map);
      draftLayerRef.current = line;
    }
    const onClick = (e: L.LeafletMouseEvent) => {
      const p = fromLatLng(d.map, e.latlng);
      setDrawing((cur) => (cur && cur.length < 200 ? [...cur, [p.x, p.y]] : cur));
    };
    map.on('click', onClick);
    map.getContainer().classList.add('adding-marker');
    return () => {
      map.off('click', onClick);
      map.getContainer().classList.remove('adding-marker');
      draftLayerRef.current?.remove();
      draftLayerRef.current = null;
    };
  }, [drawing, isDm, data.data]);

  async function submitFogArea(e: FormEvent) {
    e.preventDefault();
    if (!fogEditing?.map_id || !fogEditing.points) return;
    await saveFogArea({ id: fogEditing.id, map_id: fogEditing.map_id, label: fogEditing.label ?? '', points: fogEditing.points, visibility: (fogEditing.visibility ?? 'dm') as Visibility });
    setFogEditing(null);
    data.reload();
  }

  // DM: click the map to place a new marker.
  useEffect(() => {
    const map = mapRef.current;
    const d = data.data;
    if (!map || !d || !isDm || !addMode) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      setEditing({ map_id: d.map.id, ...fromLatLng(d.map, e.latlng), label: '', description: '', icon: 'pin', article_id: null, visibility: 'dm' });
      setAddMode(false);
    };
    map.on('click', onClick);
    map.getContainer().classList.add('adding-marker');
    return () => {
      map.off('click', onClick);
      map.getContainer().classList.remove('adding-marker');
    };
  }, [addMode, isDm, data.data]);

  async function submitMarker(e: FormEvent) {
    e.preventDefault();
    if (!editing?.map_id || !editing.label) return;
    await saveMarker({
      id: editing.id, map_id: editing.map_id, x: editing.x ?? 0, y: editing.y ?? 0, label: editing.label,
      description: editing.description ?? '', icon: editing.icon ?? 'pin', article_id: editing.article_id ?? null,
      visibility: (editing.visibility ?? 'dm') as Visibility,
    });
    setEditing(null);
    data.reload();
  }

  if (data.error) return <p className="form-error">{data.error}</p>;
  if (!data.loading && !data.data) return <NotFound what="map" />;
  const d = data.data;

  return (
    <div className="map-page">
      <nav className="breadcrumbs" aria-label="Breadcrumbs">
        <Link to="/maps">Maps</Link>
        {d?.parent && <> › <Link to={`/maps/${d.parent.slug}`}>{d.parent.title}</Link></>}
        {d && <> › <span>{d.map.title}</span></>}
      </nav>
      <div className="toolbar">
        <h1 className="page-title">{d?.map.title}</h1>
        {isDm && d && (
          <div className="toolbar-actions">
            {d.map.visibility === 'dm' && <VisibilityBadge visibility="dm" />}
            <button type="button" className={addMode ? 'button' : 'button secondary'} disabled={!!drawing} onClick={() => setAddMode((a) => !a)}>
              {addMode ? 'Click the map to place it…' : 'Add marker'}
            </button>
            <button
              type="button"
              className="button secondary"
              aria-pressed={d.map.fog_enabled}
              onClick={async () => {
                await setMapFog(d.map.id, !d.map.fog_enabled);
                data.reload();
              }}
            >
              {d.map.fog_enabled ? 'Fog of war: on' : 'Fog of war: off'}
            </button>
            {d.map.fog_enabled && !drawing && (
              <button type="button" className="button secondary" disabled={addMode} onClick={() => setDrawing([])}>Draw fog area</button>
            )}
            {drawing && (
              <>
                <span className="muted" role="status">{drawing.length < 3 ? `Click the map around the area (${drawing.length} of at least 3 corners)` : `${drawing.length} corners`}</span>
                <button type="button" className="button" disabled={drawing.length < 3} onClick={() => { setFogEditing({ map_id: d.map.id, points: drawing, label: '', visibility: 'players' }); setDrawing(null); }}>Finish area</button>
                <button type="button" className="button secondary" onClick={() => setDrawing(null)}>Cancel</button>
              </>
            )}
            <Link className="button secondary" to={`/dm/maps/${d.map.slug}`}>Map settings</Link>
          </div>
        )}
      </div>
      {d?.map.description && <p className="muted">{d.map.description}</p>}
      <div className="map-layout">
        <div ref={container} className="map-canvas" role="application" aria-label={`Map of ${d?.map.title ?? ''}`} />
        <aside className="map-side">
          <label className="filter">
            <span className="visually-hidden">Find a place on this map</span>
            <input type="search" placeholder="Find a place…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          <ul className="marker-list">
            {shown.map((m) => (
              <li key={m.id}>
                <button type="button" className="link-button" onClick={() => d && mapRef.current?.setView(toLatLng(d.map, m.x, m.y), 1)}>{m.label}</button>
                {isDm && m.visibility === 'dm' && <VisibilityBadge visibility="dm" />}
                {m.article && <> · <Link to={`/wiki/${m.article.slug}`}>article</Link></>}
                {m.submap && <> · <Link to={`/maps/${m.submap.slug}`}>map</Link></>}
                {isDm && <> · <button type="button" className="link-button" onClick={() => setEditing(m)}>edit</button></>}
              </li>
            ))}
          </ul>
          {isDm && d?.map.fog_enabled && (
            <>
              <h2>Fog areas</h2>
              {d.fog.length === 0 ? <p className="muted">None yet: players see this whole map covered. Use “Draw fog area”.</p> : (
                <ul className="fog-list">
                  {d.fog.map((a) => (
                    <li key={a.id}>
                      <span>{a.label || 'Unnamed area'}</span>{' '}
                      {a.visibility === 'players' ? <span className="badge">revealed</span> : <VisibilityBadge visibility="dm" />}
                      {' · '}
                      <button type="button" className="link-button" onClick={async () => { await saveFogArea({ ...a, visibility: a.visibility === 'players' ? 'dm' : 'players' }); data.reload(); }}>
                        {a.visibility === 'players' ? 'hide again' : 'reveal'}
                      </button>
                      {' · '}
                      <button type="button" className="link-button" onClick={() => setFogEditing(a)}>edit</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {(d?.children.length ?? 0) > 0 && (
            <>
              <h2>Detailed maps</h2>
              <ul>{d!.children.map((c) => <li key={c.id}><Link to={`/maps/${c.slug}`}>{c.title}</Link></li>)}</ul>
            </>
          )}
        </aside>
      </div>

      {isDm && fogEditing && (
        <dialog open className="dialog" aria-label="Fog area">
          <form onSubmit={submitFogArea} className="form-grid">
            <h2>{fogEditing.id ? 'Edit fog area' : 'New fog area'}</h2>
            <label>Name (only you see it)<input value={fogEditing.label ?? ''} onChange={(e) => setFogEditing({ ...fogEditing, label: e.target.value })} maxLength={120} /></label>
            <label className="checkbox">
              <input type="checkbox" checked={fogEditing.visibility === 'players'} onChange={(e) => setFogEditing({ ...fogEditing, visibility: e.target.checked ? 'players' : 'dm' })} />
              Revealed to players
            </label>
            <p className="fine-print">Players see a revealed area clearly and the rest of the map under fog. Markers keep their own visibility.</p>
            <div className="form-actions">
              <button type="submit" className="button">Save area</button>
              <button type="button" className="button secondary" onClick={() => setFogEditing(null)}>Cancel</button>
              {fogEditing.id && (
                <button
                  type="button"
                  className="button danger"
                  onClick={async () => {
                    if (fogEditing.id && window.confirm('Delete this fog area?')) {
                      await deleteFogArea(fogEditing.id);
                      setFogEditing(null);
                      data.reload();
                    }
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </form>
        </dialog>
      )}

      {isDm && editing && (
        <dialog open className="dialog" aria-label="Marker">
          <form onSubmit={submitMarker} className="form-grid">
            <h2>{editing.id ? 'Edit marker' : 'New marker'}</h2>
            <label>Label<input value={editing.label ?? ''} onChange={(e) => setEditing({ ...editing, label: e.target.value })} required maxLength={120} /></label>
            <label>Description<textarea value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={3} /></label>
            <label>
              Linked article
              <select value={editing.article_id ?? ''} onChange={(e) => setEditing({ ...editing, article_id: e.target.value || null })}>
                <option value="">None</option>
                {articles.data?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </label>
            <label>
              Who can see it
              <select value={editing.visibility ?? 'dm'} onChange={(e) => setEditing({ ...editing, visibility: e.target.value as Visibility })}>
                <option value="dm">DM only (hidden location)</option>
                <option value="players">Players (discovered)</option>
              </select>
            </label>
            <p className="fine-print">A marker linked to an article players cannot see stays hidden from players.</p>
            <div className="form-actions">
              <button type="submit" className="button">Save marker</button>
              <button type="button" className="button secondary" onClick={() => setEditing(null)}>Cancel</button>
              {editing.id && (
                <button
                  type="button"
                  className="button danger"
                  onClick={async () => {
                    if (editing.id && window.confirm(`Delete the marker “${editing.label}”?`)) {
                      await deleteMarker(editing.id);
                      setEditing(null);
                      data.reload();
                    }
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
