// Performance measurement (not a pass/fail test). Run against the LOCAL build and stack:
//   bash scripts/e2e-local.sh --config playwright.perf.config.ts
// Writes test-results/perf-<PERF_LABEL>.json: for each page, the Supabase API requests the
// browser made (count, duplicates, bytes) and the bytes of each asset type transferred, plus cold
// load timings on an Android-like profile (4x CPU slowdown, "Slow 4G" network).
import fs from 'node:fs';
import path from 'node:path';
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { enrollAsPlayer, signInAsDm } from '../e2e/support.ts';

interface Req { url: string; method: string; type: string; bytes: number; body: string }
interface Sample {
  page: string; who: string; profile: string;
  api: { count: number; duplicates: number; bytes: number; urls: string[] };
  assets: Record<string, { count: number; bytes: number }>;
  ms: { mainVisible: number; lcp: number | null };
}

const results: Sample[] = [];
const label = process.env.PERF_LABEL ?? 'run';
const out = path.resolve(import.meta.dirname, '../../test-results', `perf-${label}.json`);

async function track(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  const pending = new Map<string, Req>();
  const done: Req[] = [];
  cdp.on('Network.requestWillBeSent', (e) => {
    pending.set(e.requestId, { url: e.request.url, method: e.request.method, type: e.type ?? 'Other', bytes: 0, body: e.request.postData ?? '' });
  });
  cdp.on('Network.loadingFinished', (e) => {
    const r = pending.get(e.requestId);
    if (r) { r.bytes = e.encodedDataLength; done.push(r); pending.delete(e.requestId); }
  });
  return { cdp, done, reset: () => done.splice(0, done.length) };
}

function summarize(done: Req[]) {
  const api = done.filter((r) => r.url.includes(':54321/'));
  const keys = api.map((r) => `${r.method} ${r.url} ${r.body}`);
  const assets: Record<string, { count: number; bytes: number }> = {};
  for (const r of done.filter((x) => x.url.includes(':8788/'))) {
    const kind = /\.js(\?|$)/.test(r.url) ? 'js' : /\.css(\?|$)/.test(r.url) ? 'css' : /\.woff2?(\?|$)/.test(r.url) ? 'font' : /\/api\//.test(r.url) ? 'function' : r.type === 'Document' ? 'html' : 'other';
    assets[kind] = assets[kind] ?? { count: 0, bytes: 0 };
    assets[kind]!.count += 1;
    assets[kind]!.bytes += r.bytes;
  }
  return {
    api: {
      count: api.length,
      duplicates: keys.length - new Set(keys).size,
      bytes: api.reduce((n, r) => n + r.bytes, 0),
      urls: api.map((r) => `${r.method} ${r.url.replace(/^.*?:54321/, '').slice(0, 160)}`),
    },
    assets,
  };
}

async function lcpOf(page: Page): Promise<number | null> {
  return page.evaluate(() => new Promise<number | null>((resolve) => {
    let last: number | null = null;
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) last = e.startTime; })
        .observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { resolve(null); return; }
    setTimeout(() => resolve(last), 300);
  }));
}

async function measure(browser: Browser, state: string, who: string, url: string, profile: 'fast' | 'android') {
  const context = await browser.newContext({ storageState: state, viewport: profile === 'android' ? { width: 412, height: 915 } : { width: 1366, height: 900 } });
  const page = await context.newPage();
  const t = await track(context, page);
  if (profile === 'android') {
    await t.cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await t.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  }
  const start = Date.now();
  await page.goto(url);
  await page.locator('main#main').waitFor({ state: 'visible', timeout: 120_000 });
  await page.locator('.prose-loading, .loading, [aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 60_000 }).catch(() => undefined);
  const mainVisible = Date.now() - start;
  await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => undefined);
  const lcp = await lcpOf(page);
  results.push({ page: url, who, profile, ...summarize(t.done), ms: { mainVisible, lcp } });
  await context.close();
}

test('measure', async ({ browser }) => {
  test.setTimeout(900_000);
  const dir = path.resolve(import.meta.dirname, '../../test-results');
  fs.mkdirSync(dir, { recursive: true });
  const playerState = path.join(dir, 'perf-player.json');
  const dmState = path.join(dir, 'perf-dm.json');
  {
    const c = await browser.newContext();
    const p = await c.newPage();
    await enrollAsPlayer(p, 'Perf Player');
    await c.storageState({ path: playerState });
    await c.close();
  }
  {
    const c = await browser.newContext();
    const p = await c.newPage();
    await signInAsDm(p);
    await c.storageState({ path: dmState });
    await c.close();
  }
  const playerPages = ['/', '/wiki/kaela-brightwind', '/wiki/port-vellmoor', '/search?q=dragon', '/browse/character', '/a-z', '/graph', '/news', '/timeline', '/connections', '/recent', '/maps'];
  for (const url of playerPages) await measure(browser, playerState, 'player', url, 'fast');
  for (const url of ['/', '/wiki/kaela-brightwind', '/dm', '/dm/edit/kaela-brightwind', '/graph', '/search?q=dragon']) await measure(browser, dmState, 'dm', url, 'fast');
  for (const url of ['/', '/wiki/kaela-brightwind']) await measure(browser, playerState, 'player', url, 'android');

  // In-app navigation: home, then a page link, then back to home (warm cache, one context).
  {
    const context = await browser.newContext({ storageState: playerState });
    const page = await context.newPage();
    const t = await track(context, page);
    await page.goto('/');
    await page.locator('main#main').waitFor();
    await page.waitForLoadState('networkidle');
    t.reset();
    const start = Date.now();
    await page.goto('/');
    await page.locator('main#main a[href="/wiki/kaela-brightwind"]').first().click();
    await page.getByRole('heading', { level: 1, name: 'Kaela Brightwind' }).waitFor();
    const toArticle = Date.now() - start;
    await page.waitForLoadState('networkidle');
    results.push({ page: 'nav home→article (warm)', who: 'player', profile: 'fast', ...summarize(t.done), ms: { mainVisible: toArticle, lcp: null } });
    await context.close();
  }
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
});
