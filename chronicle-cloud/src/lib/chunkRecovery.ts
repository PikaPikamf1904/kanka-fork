// Recovery from an out-of-date copy of the app.
//
// Every release replaces the files under /assets (their names contain a hash of their content). A
// browser tab opened before a release still asks for the OLD names when the reader opens a page
// loaded on demand (the Knowledge Graph, a map, the editor). Cloudflare Pages answers a name it no
// longer has with the home page (status 200, text/html), so the browser reports "Failed to fetch
// dynamically imported module". Some old files linger in an edge cache and others do not, which is
// why it looks random.
//
// The cure is to load the current copy of the app. That is safe to do on our own only when the
// current copy really is different (a release happened) and only once, so a broken release or a
// dropped connection can never become a reload loop.

const KEY = 'chronicle-stale-build-reload';
/** One automatic reload per tab in this window; a second failure shows the friendly screen instead. */
export const RELOAD_WINDOW_MS = 5 * 60 * 1000;

const CHUNK_ERROR = [
  /Failed to fetch dynamically imported module/i, // Chrome, Edge
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Failed to load module script/i, // the page answered with HTML instead of JavaScript
  /Unable to preload CSS/i, // Vite's stylesheet preload
  /Loading (CSS )?chunk [\w-]+ failed/i, // webpack-style names, kept for tooling that uses them
  /ChunkLoadError/i,
];

/** True for the error the browser raises when a page's JavaScript file cannot be loaded. */
export function isChunkLoadError(err: unknown): boolean {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : typeof err === 'string' ? err : '';
  return CHUNK_ERROR.some((re) => re.test(text));
}

/** The address of the app's entry script in a page's HTML (its hash changes with every release). */
export function entryScriptOf(html: string): string | null {
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype\s*=\s*["']?module/i.test(tag)) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (src && src.includes('/assets/')) return src;
  }
  return null;
}

export interface Marker { at: number; entry: string }

/**
 * Whether to reload on our own. `running` is the entry script this tab is using and `latest` the one
 * the server serves now (null when it could not be read, for example while offline).
 */
export function shouldReload(opts: { running: string | null; latest: string | null; marker: Marker | null; now: number }): boolean {
  const { running, latest, marker, now } = opts;
  if (!running || !latest) return false; // cannot tell (offline, or a development server)
  if (running === latest) return false; // no release happened: reloading would change nothing
  // Already reloaded for this release a moment ago and still out of date: stop, do not loop.
  if (marker && now - marker.at < RELOAD_WINDOW_MS) return false;
  return true;
}

function runningEntry(): string | null {
  for (const el of Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))) {
    const src = el.getAttribute('src');
    if (src && src.includes('/assets/')) return src;
  }
  return null;
}

async function latestEntry(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch('/', { cache: 'no-store', credentials: 'omit', signal: controller.signal });
    if (!res.ok) return null;
    return entryScriptOf(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readMarker(): Marker | null | 'unavailable' {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Marker;
    return typeof m.at === 'number' && typeof m.entry === 'string' ? m : null;
  } catch {
    return 'unavailable';
  }
}

export type Recovery = 'reloading' | 'gave-up';

let inFlight: Promise<Recovery> | null = null;

/**
 * Called when a page's JavaScript could not be loaded. Reloads once when a newer release exists;
 * otherwise reports 'gave-up' so the caller shows the friendly screen. Safe to call twice at once
 * (React strict mode does): both callers share one check.
 */
export function recoverFromStaleBuild(reload: () => void = () => window.location.reload()): Promise<Recovery> {
  inFlight ??= (async (): Promise<Recovery> => {
    const marker = readMarker();
    // Without working tab storage the one-reload limit cannot be kept, so never reload on our own.
    if (marker === 'unavailable') return 'gave-up';
    const latest = await latestEntry();
    if (!latest || !shouldReload({ running: runningEntry(), latest, marker, now: Date.now() })) return 'gave-up';
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), entry: latest } satisfies Marker));
    } catch {
      return 'gave-up';
    }
    reload();
    return 'reloading';
  })().finally(() => { inFlight = null; });
  return inFlight;
}

/** The reader's own "Reload" button: always allowed, and it never counts against the automatic one. */
export function reloadNow() {
  window.location.reload();
}
