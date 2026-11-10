import { useEffect, useRef, useState } from 'react';

export interface Loaded<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload(): void;
}

/**
 * Load async data for a page. `deps` identify the request (they must be JSON-serialisable);
 * results that arrive for an older request are ignored, and data from another request is never
 * shown while the new one loads.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const key = JSON.stringify(deps);
  const [tick, setTick] = useState(0);
  const requestKey = `${key}#${tick}`;
  const [result, setResult] = useState<{ key: string; data?: T; error: string | null }>({ key: '', error: null });
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let live = true;
    loadRef.current().then(
      (data) => live && setResult({ key: requestKey, data, error: null }),
      (err: unknown) => live && setResult({ key: requestKey, error: err instanceof Error ? err.message : 'Could not load this page.' }),
    );
    return () => {
      live = false;
    };
  }, [requestKey]);

  const sameRequest = result.key.startsWith(`${key}#`);
  return {
    // Keep showing the previous data during a reload of the same request; never across requests.
    data: sameRequest ? result.data : undefined,
    error: result.key === requestKey ? result.error : null,
    loading: result.key !== requestKey,
    reload: () => setTick((t) => t + 1),
  };
}
