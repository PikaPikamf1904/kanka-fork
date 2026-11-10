import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { VisibilityBadge } from '../components/Badges.tsx';
import { deleteMarker, getMap, listAllArticleRefs, listMaps, mediaUrls, saveMarker } from '../lib/api.ts';
import { useIsDm } from '../lib/session.tsx';
import type { MapMarker, Visibility, WikiMap } from '../lib/types.ts';
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

type MarkerRow = MapMarker & { article: { slug: string; title: string } | null };

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
      marker.bindPopup(popup);
      if (isDm) marker.on('dblclick', () => setEditing(m));
      marker.addTo(layer);
    }
  }, [shown, isDm, data.data]);

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
            <button type="button" className={addMode ? 'button' : 'button secondary'} onClick={() => setAddMode((a) => !a)}>
              {addMode ? 'Click the map to place it…' : 'Add marker'}
            </button>
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
                {isDm && <> · <button type="button" className="link-button" onClick={() => setEditing(m)}>edit</button></>}
              </li>
            ))}
          </ul>
          {(d?.children.length ?? 0) > 0 && (
            <>
              <h2>Detailed maps</h2>
              <ul>{d!.children.map((c) => <li key={c.id}><Link to={`/maps/${c.slug}`}>{c.title}</Link></li>)}</ul>
            </>
          )}
        </aside>
      </div>

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
