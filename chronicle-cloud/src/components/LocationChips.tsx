import { Link } from 'react-router';
import { getPlaceChips } from '../lib/api.ts';
import { mapChipHref } from '../lib/placeChips.ts';
import { relationLabel } from '../lib/templates.ts';
import { useIsDm } from '../lib/session.tsx';
import { useLoad } from '../lib/useLoad.ts';

/**
 * "Place" chips under an article's title: the locations it is connected to, and the maps that show
 * them (opening focused on the pin when there is one). Everything is read under the reader's own
 * access, so a hidden location, pin or map never appears. Renders nothing when there is nothing.
 */
export function LocationChips({ articleId, title }: { articleId: string; title: string }) {
  const isDm = useIsDm();
  const chips = useLoad(() => getPlaceChips(articleId, title), [articleId, title, isDm]);
  const data = chips.data;
  if (!data || (data.places.length === 0 && data.maps.length === 0)) return null;
  return (
    <nav className="place-chips" aria-label="Places and maps">
      {data.places.map((p) => (
        <Link key={p.id} to={`/wiki/${p.slug}`} className="place-chip" title={relationLabel(p.kind)}>
          <span aria-hidden="true">⚑ </span>
          {p.title}
        </Link>
      ))}
      {data.maps.map((m) => (
        <Link key={m.key} to={mapChipHref(m)} className="place-chip place-chip-map" title={m.placeTitle === title ? undefined : m.placeTitle}>
          <span aria-hidden="true">🗺 </span>
          On map: {m.mapTitle}
          {m.placeTitle !== title && <span className="visually-hidden"> ({m.placeTitle})</span>}
        </Link>
      ))}
    </nav>
  );
}
