import { useEffect, useState } from 'react';
import { mediaUrlForPath, mediaUrls } from '../lib/api.ts';

/** An image from the private bucket, by media id or storage path. Nothing renders if not allowed. */
export function MediaImage({ id, path, alt, className }: { id?: string | null; path?: string; alt: string; className?: string }) {
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
  const url = loaded.key === key ? loaded.url : null;
  if (!url) return null;
  return <img src={url} alt={alt} className={className} loading="lazy" decoding="async" referrerPolicy="no-referrer" />;
}
