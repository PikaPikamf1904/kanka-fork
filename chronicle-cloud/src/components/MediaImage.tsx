import { useEffect, useState } from 'react';
import { mediaUrlForPath, mediaUrls } from '../lib/api.ts';

/** A signed URL for a file in the private bucket, by media id or path; null while loading or if not allowed. */
export function useMediaUrl(id?: string | null, path?: string): string | null {
  const key = id ? `id:${id}` : path ? `path:${path}` : '';
  const [loaded, setLoaded] = useState<{ key: string; url: string | null }>({ key: '', url: null });
  useEffect(() => {
    if (!key) return;
    let live = true;
    const load = id ? mediaUrls([id]).then((m) => m.get(id) ?? null) : mediaUrlForPath(path!);
    load.then((url) => live && setLoaded({ key, url })).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key, id, path]);
  return loaded.key === key ? loaded.url : null;
}

/** An image from the private bucket, by media id or storage path. Nothing renders if not allowed. */
export function MediaImage({ id, path, alt, className }: { id?: string | null; path?: string; alt: string; className?: string }) {
  const url = useMediaUrl(id, path);
  if (!url) return null;
  return <img src={url} alt={alt} className={className} loading="lazy" decoding="async" referrerPolicy="no-referrer" />;
}

/** A picture with its caption. Renders nothing at all (caption included) when the reader may not see the file. */
export function MediaFigure({ path, alt, caption }: { path: string; alt: string; caption?: string }) {
  const url = useMediaUrl(undefined, path);
  if (!url) return null;
  return (
    <figure className="prose-figure">
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open the picture${alt ? `: ${alt}` : ''} full size`}>
        <img src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      </a>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
