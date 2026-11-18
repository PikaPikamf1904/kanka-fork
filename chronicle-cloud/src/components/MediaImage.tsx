import { useEffect, useId, useRef, useState } from 'react';
import { useLightbox } from './Lightbox.tsx';
import { forgetMediaUrl, mediaUrlForPath, mediaUrls } from '../lib/api.ts';

/**
 * A signed URL for a file in the private bucket, by media id or path; null while loading or if not
 * allowed. Signed links last ten minutes, so an image that fails to load (for example one scrolled
 * into view, or opened in the picture viewer, after its link expired) asks for a fresh link through
 * `onError`. Each distinct URL is retried at most once and a figure at most three times, so a file
 * that is really gone cannot loop. The old link stays in place until the new one arrives.
 */
export function useMediaUrl(id?: string | null, path?: string): { url: string | null; onError: (failed?: string) => void } {
  const key = id ? `id:${id}` : path ? `path:${path}` : '';
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; url: string | null }>({ key: '', url: null });
  const retried = useRef(new Set<string>());
  useEffect(() => {
    if (!key) return;
    let live = true;
    const load = id ? mediaUrls([id]).then((m) => m.get(id) ?? null) : mediaUrlForPath(path!);
    load.then((url) => live && setLoaded({ key, url })).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key, attempt, id, path]);
  const url = loaded.key === key ? loaded.url : null;
  return {
    url,
    onError: (failed) => {
      // A late error for a link that was already replaced is not about the current one.
      if (!url || (failed !== undefined && failed !== url)) return;
      if (retried.current.has(url) || retried.current.size >= 3) return;
      retried.current.add(url);
      forgetMediaUrl(url);
      setAttempt((a) => a + 1);
    },
  };
}

/** An image from the private bucket, by media id or storage path. Nothing renders if not allowed. */
export function MediaImage({ id, path, alt, className }: { id?: string | null; path?: string; alt: string; className?: string }) {
  const { url, onError } = useMediaUrl(id, path);
  if (!url) return null;
  return <img src={url} alt={alt} className={className} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => onError()} />;
}

/**
 * A picture with its caption. Renders nothing at all (caption included) when the reader may not see
 * the file. Inside a LightboxProvider it opens the shared viewer; elsewhere it links to the file.
 */
export function MediaFigure({ path, alt, caption }: { path: string; alt: string; caption?: string }) {
  const { url, onError } = useMediaUrl(undefined, path);
  const lightbox = useLightbox();
  const id = useId();
  const figure = useRef<HTMLElement>(null);
  const register = lightbox?.register;
  // The viewer calls this long after render, so it always reaches the newest handler.
  const latestOnError = useRef(onError);
  useEffect(() => {
    latestOnError.current = onError;
  });
  useEffect(() => {
    if (!register || !url || !figure.current) return;
    return register({ id, el: figure.current, url, alt, caption: caption ?? '', refresh: (failed) => latestOnError.current(failed) });
  }, [register, id, url, alt, caption]);
  if (!url) return null;
  const img = <img src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => onError()} />;
  return (
    <figure className="prose-figure" ref={figure}>
      {lightbox ? (
        <button type="button" className="prose-figure-open" aria-label={`View picture${alt ? `: ${alt}` : ''}`} onClick={(e) => lightbox.open(id, e.currentTarget)}>
          {img}
        </button>
      ) : (
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open the picture${alt ? `: ${alt}` : ''} full size`}>
          {img}
        </a>
      )}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
