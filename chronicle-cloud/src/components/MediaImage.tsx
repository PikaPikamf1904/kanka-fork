import { useEffect, useState } from 'react';
import { forgetMediaUrl, mediaUrlForPath, mediaUrls } from '../lib/api.ts';

/**
 * A signed URL for a file in the private bucket, by media id or path; null while loading or if not
 * allowed. Signed links last ten minutes, so an image that fails to load (for example one scrolled
 * into view after its link expired) asks for a fresh link once through `onError`.
 */
export function useMediaUrl(id?: string | null, path?: string): { url: string | null; onError: () => void } {
  const key = id ? `id:${id}` : path ? `path:${path}` : '';
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; url: string | null }>({ key: '', url: null });
  const current = `${key}#${attempt}`;
  useEffect(() => {
    if (!key) return;
    let live = true;
    const load = id ? mediaUrls([id]).then((m) => m.get(id) ?? null) : mediaUrlForPath(path!);
    load.then((url) => live && setLoaded({ key: current, url })).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [current, key, id, path]);
  const url = loaded.key === current ? loaded.url : null;
  return {
    url,
    onError: () => {
      if (!url || attempt >= 1) return;
      forgetMediaUrl(url);
      setAttempt((a) => a + 1);
    },
  };
}

/** An image from the private bucket, by media id or storage path. Nothing renders if not allowed. */
export function MediaImage({ id, path, alt, className }: { id?: string | null; path?: string; alt: string; className?: string }) {
  const { url, onError } = useMediaUrl(id, path);
  if (!url) return null;
  return <img src={url} alt={alt} className={className} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={onError} />;
}

/** A picture with its caption. Renders nothing at all (caption included) when the reader may not see the file. */
export function MediaFigure({ path, alt, caption }: { path: string; alt: string; caption?: string }) {
  const { url, onError } = useMediaUrl(undefined, path);
  if (!url) return null;
  return (
    <figure className="prose-figure">
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open the picture${alt ? `: ${alt}` : ''} full size`}>
        <img src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={onError} />
      </a>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
