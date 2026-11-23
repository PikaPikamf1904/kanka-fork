// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entryScriptOf, fullLoadTarget, isChunkLoadError, RELOAD_WINDOW_MS, recoverFromStaleBuild, shouldReload } from './chunkRecovery.ts';

describe('isChunkLoadError', () => {
  it.each([
    ['Chrome / Edge', new TypeError('Failed to fetch dynamically imported module: https://x.test/assets/GraphPage-abc.js')],
    ['Firefox', new TypeError('error loading dynamically imported module: https://x.test/assets/GraphPage-abc.js')],
    ['Safari', new TypeError('Importing a module script failed.')],
    ['HTML served for a script', new TypeError('Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".')],
    ['Vite stylesheet preload', new Error('Unable to preload CSS for /assets/GraphPage-abc.css')],
    ['webpack style', Object.assign(new Error('Loading chunk 7 failed.'), { name: 'ChunkLoadError' })],
  ])('recognises %s', (_name, err) => {
    expect(isChunkLoadError(err)).toBe(true);
  });
  it('does not treat ordinary errors as chunk errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false); // an API call, not a script
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError({ message: 'Failed to fetch dynamically imported module' })).toBe(false);
  });
});

describe('entryScriptOf', () => {
  it('finds the entry script whatever the attribute order', () => {
    expect(entryScriptOf('<head><script type="module" crossorigin src="/assets/index-AbC123.js"></script></head>')).toBe('/assets/index-AbC123.js');
    expect(entryScriptOf('<script src="/assets/index-Zz9.js" crossorigin type="module"></script>')).toBe('/assets/index-Zz9.js');
  });
  it('ignores other scripts and a development page', () => {
    expect(entryScriptOf('<script src="https://challenges.cloudflare.com/x.js"></script>')).toBeNull();
    expect(entryScriptOf('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
    expect(entryScriptOf('<p>no scripts</p>')).toBeNull();
  });
});

describe('shouldReload', () => {
  const now = 1_000_000;
  const base = { running: '/assets/index-OLD.js', latest: '/assets/index-NEW.js', marker: null, now };
  it('reloads once when a newer release exists', () => {
    expect(shouldReload(base)).toBe(true);
  });
  it('never reloads when this tab already runs the current release (a dropped connection or a broken release)', () => {
    expect(shouldReload({ ...base, latest: base.running })).toBe(false);
  });
  it('never reloads when the current release cannot be read (offline) or the tab has no entry script (development)', () => {
    expect(shouldReload({ ...base, latest: null })).toBe(false);
    expect(shouldReload({ ...base, running: null })).toBe(false);
  });
  it('does not reload a second time inside the window, which stops a loop', () => {
    expect(shouldReload({ ...base, marker: { at: now - 1000, entry: base.latest } })).toBe(false);
    expect(shouldReload({ ...base, marker: { at: now - RELOAD_WINDOW_MS + 1, entry: base.latest } })).toBe(false);
  });
  it('allows another automatic reload for a later release, once the window has passed', () => {
    expect(shouldReload({ ...base, marker: { at: now - RELOAD_WINDOW_MS - 1, entry: '/assets/index-OLDER.js' } })).toBe(true);
  });
});

// The browser pieces, with a stand-in page and server.
describe('recoverFromStaleBuild', () => {
  const store = new Map<string, string>();
  let page: string;
  let running: string | null;

  beforeEach(() => {
    store.clear();
    running = '/assets/index-OLD.js';
    page = '<script type="module" crossorigin src="/assets/index-NEW.js"></script>';
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.stubGlobal('document', {
      querySelectorAll: () => (running ? [{ getAttribute: () => running }] : []),
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => page })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reloads once for a newer release and remembers it', async () => {
    const reload = vi.fn();
    expect(await recoverFromStaleBuild(reload)).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.get('chronicle-stale-build-reload')!).entry).toBe('/assets/index-NEW.js');
  });
  it('asks the server for a fresh copy, not a cached one', async () => {
    await recoverFromStaleBuild(vi.fn());
    expect(fetch).toHaveBeenCalledWith('/', expect.objectContaining({ cache: 'no-store', credentials: 'omit' }));
  });
  it('gives up instead of looping when the reload did not help', async () => {
    const reload = vi.fn();
    expect(await recoverFromStaleBuild(reload)).toBe('reloading');
    // The tab came back still out of date (for example an intermediary served an old home page).
    expect(await recoverFromStaleBuild(reload)).toBe('gave-up');
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('gives up when there is no newer release', async () => {
    running = '/assets/index-NEW.js';
    const reload = vi.fn();
    expect(await recoverFromStaleBuild(reload)).toBe('gave-up');
    expect(reload).not.toHaveBeenCalled();
  });
  it('gives up when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const reload = vi.fn();
    expect(await recoverFromStaleBuild(reload)).toBe('gave-up');
    expect(reload).not.toHaveBeenCalled();
  });
  it('never reloads on its own when tab storage is unavailable, because the limit could not be kept', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    const reload = vi.fn();
    expect(await recoverFromStaleBuild(reload)).toBe('gave-up');
    expect(reload).not.toHaveBeenCalled();
  });
  it('shares one check when called twice at once (React strict mode)', async () => {
    const reload = vi.fn();
    const [a, b] = await Promise.all([recoverFromStaleBuild(reload), recoverFromStaleBuild(reload)]);
    expect([a, b]).toEqual(['reloading', 'reloading']);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('fullLoadTarget (after a release, links load the new copy in full)', () => {
  const here = new URL('https://chronicle.test/wiki/kaela?x=1');
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  const link = (href: string, extra: Partial<{ target: string; hasDownload: boolean }> = {}) => ({ href, target: '', hasDownload: false, ...extra });
  it('loads an internal page in full', () => {
    expect(fullLoadTarget(click, link('/graph'), here)).toBe('https://chronicle.test/graph');
    expect(fullLoadTarget(click, link('https://chronicle.test/wiki/kaela?x=2'), here)).toBe('https://chronicle.test/wiki/kaela?x=2');
  });
  it('leaves new-tab, modified, downloaded, external, API and same-page links alone', () => {
    expect(fullLoadTarget({ ...click, metaKey: true }, link('/graph'), here)).toBeNull();
    expect(fullLoadTarget({ ...click, ctrlKey: true }, link('/graph'), here)).toBeNull();
    expect(fullLoadTarget({ ...click, button: 1 }, link('/graph'), here)).toBeNull();
    expect(fullLoadTarget({ ...click, defaultPrevented: true }, link('/graph'), here)).toBeNull();
    expect(fullLoadTarget(click, link('/graph', { target: '_blank' }), here)).toBeNull();
    expect(fullLoadTarget(click, link('/export.md', { hasDownload: true }), here)).toBeNull();
    expect(fullLoadTarget(click, link('https://example.org/page'), here)).toBeNull();
    expect(fullLoadTarget(click, link('/api/status'), here)).toBeNull();
    expect(fullLoadTarget(click, link('/wiki/kaela?x=1#history'), here)).toBeNull();
  });
});
