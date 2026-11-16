// Pure logic behind the "place" chips on an article: which locations it is connected to and which
// maps show them. The rows come from queries under the reader's Row Level Security, so a hidden
// location, marker or map is simply not in the input and can never produce a chip.
import type { ArticleType } from './types.ts';

export interface PlaceRelationRow {
  kind: string;
  source_article_id: string;
  target_article_id: string;
  source: { id: string; slug: string; title: string; type: ArticleType } | null;
  target: { id: string; slug: string; title: string; type: ArticleType } | null;
}
export interface PlaceMarkerRow { id: string; article_id: string | null; map: { slug: string; title: string } | null }
export interface PlaceMapRow { slug: string; title: string; article_id: string | null }

export interface PlaceChip { id: string; slug: string; title: string; kind: string }
export interface MapChip {
  key: string;
  mapSlug: string;
  mapTitle: string;
  markerId: string | null;
  /** The page whose marker or map this is: the article itself or one of its places. */
  placeTitle: string;
}

export const MAX_PLACE_CHIPS = 8;
export const MAX_MAP_CHIPS = 6;

/** Locations on the other end of a relation, either direction, one chip each, in title order. */
export function placeChips(selfId: string, relations: PlaceRelationRow[]): PlaceChip[] {
  const seen = new Map<string, PlaceChip>();
  for (const r of relations) {
    const other = r.source_article_id === selfId ? r.target : r.target_article_id === selfId ? r.source : null;
    if (!other || other.type !== 'location' || other.id === selfId || seen.has(other.id)) continue;
    seen.set(other.id, { id: other.id, slug: other.slug, title: other.title, kind: r.kind });
  }
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title)).slice(0, MAX_PLACE_CHIPS);
}

/**
 * "On map" chips for the article and its places. A marker links straight to the pin; a map that
 * merely depicts the page links to the map. One chip per map and page (a marker wins over the
 * bare map), the article's own first.
 */
export function mapChips(selfId: string, selfTitle: string, places: PlaceChip[], markers: PlaceMarkerRow[], maps: PlaceMapRow[]): MapChip[] {
  const titles = new Map<string, string>([[selfId, selfTitle], ...places.map((p): [string, string] => [p.id, p.title])]);
  const rank = (id: string) => (id === selfId ? 0 : 1);
  const out = new Map<string, MapChip & { page: string }>();
  for (const m of markers) {
    if (!m.article_id || !m.map || !titles.has(m.article_id)) continue;
    const key = `${m.map.slug}|${m.article_id}`;
    if (!out.has(key)) out.set(key, { key, mapSlug: m.map.slug, mapTitle: m.map.title, markerId: m.id, placeTitle: titles.get(m.article_id)!, page: m.article_id });
  }
  for (const m of maps) {
    if (!m.article_id || !titles.has(m.article_id)) continue;
    const key = `${m.slug}|${m.article_id}`;
    if (!out.has(key)) out.set(key, { key, mapSlug: m.slug, mapTitle: m.title, markerId: null, placeTitle: titles.get(m.article_id)!, page: m.article_id });
  }
  return [...out.values()]
    .sort((a, b) => rank(a.page) - rank(b.page) || a.mapTitle.localeCompare(b.mapTitle) || a.placeTitle.localeCompare(b.placeTitle))
    .slice(0, MAX_MAP_CHIPS)
    .map((c) => ({ key: c.key, mapSlug: c.mapSlug, mapTitle: c.mapTitle, markerId: c.markerId, placeTitle: c.placeTitle }));
}

/** The address a map chip opens: the map, focused on the pin when there is one. */
export function mapChipHref(chip: Pick<MapChip, 'mapSlug' | 'markerId'>): string {
  return chip.markerId ? `/maps/${chip.mapSlug}?marker=${encodeURIComponent(chip.markerId)}` : `/maps/${chip.mapSlug}`;
}

/** The pin to focus from a map's address: by marker id first, else the first pin for a page address. */
export function focusMarker<T extends { id: string; article: { slug: string } | null }>(markers: T[], params: { marker?: string | null; focus?: string | null }): T | null {
  if (params.marker) return markers.find((m) => m.id === params.marker) ?? null;
  if (params.focus) return markers.find((m) => m.article?.slug === params.focus) ?? null;
  return null;
}
