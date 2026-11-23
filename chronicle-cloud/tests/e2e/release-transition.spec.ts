import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { enrollAsPlayer } from './support.ts';

// Real release transitions on Cloudflare's own local runtime (wrangler pages dev), not intercepted
// requests: a second server serves a folder, and the test swaps whole builds in that folder while a
// tab is open, the way a Pages deployment replaces every file.
//
//   release A = the build in dist/
//   release B = the same build with every hashed file renamed and every reference to it updated,
//               which is exactly what a release with changed code looks like to an open tab
//
// Swapping A -> B is a deployment; swapping B -> A is a rollback.

const PORT = 8797;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const root = path.resolve(import.meta.dirname, '../..');
const work = path.join(root, '.local', 'release-transition');
const dirs = { A: path.join(work, 'A'), B: path.join(work, 'B'), live: path.join(work, 'live') };
let server: ChildProcess | undefined;

function makeReleaseB() {
  fs.rmSync(dirs.B, { recursive: true, force: true });
  fs.cpSync(dirs.A, dirs.B, { recursive: true });
  const assets = path.join(dirs.B, 'assets');
  // Every file gets a name release A never had. (Keeping a name would let the browser reuse A's
  // cached copy, which no real release can cause: Vite renames a file whenever anything it imports
  // is renamed.)
  const renames = new Map<string, string>();
  const taken = new Set(fs.readdirSync(assets));
  for (const f of taken) {
    const m = /^(.+)-([\w-]{8})\.(\w+)$/.exec(f);
    if (!m) continue;
    const to = `${m[1]}-${m[2]![0] === 'Z' ? 'Y' : 'Z'}${m[2]!.slice(1)}.${m[3]}`;
    if (taken.has(to) || [...renames.values()].includes(to)) throw new Error(`release B: ${to} would reuse a name`);
    renames.set(f, to);
  }
  for (const [from, to] of renames) fs.renameSync(path.join(assets, from), path.join(assets, to));
  const textFiles = [path.join(dirs.B, 'index.html'), ...fs.readdirSync(assets).filter((f) => /\.(js|css)$/.test(f)).map((f) => path.join(assets, f))];
  for (const file of textFiles) {
    let text = fs.readFileSync(file, 'utf8');
    for (const [from, to] of renames) text = text.replaceAll(from, to);
    fs.writeFileSync(file, text);
  }
}

const entryOf = (html: string) => /\/assets\/(index-[\w-]+\.js)/.exec(html)?.[1] ?? null;
const entryIn = (dir: string) => entryOf(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'))!;

/** Deploy a release into the served folder, and wait until the server answers with it. */
async function deploy(release: 'A' | 'B') {
  // Like a real release: the new files are in place before the home page points at them. The served
  // folder itself stays (deleting it can stop the server noticing changes on some file systems).
  const from = dirs[release];
  const liveAssets = path.join(dirs.live, 'assets');
  fs.rmSync(liveAssets, { recursive: true, force: true });
  fs.cpSync(path.join(from, 'assets'), liveAssets, { recursive: true });
  for (const f of fs.readdirSync(from)) if (f !== 'assets' && f !== 'index.html') fs.cpSync(path.join(from, f), path.join(dirs.live, f), { recursive: true });
  fs.copyFileSync(path.join(from, 'index.html'), path.join(dirs.live, 'index.html'));
  // Done only when the server answers with the new home page AND serves every file of the release.
  const want = entryIn(from);
  const files = fs.readdirSync(path.join(from, 'assets')).filter((f) => f !== '404.html');
  await expect.poll(async () => {
    if (entryOf(await (await fetch(`${ORIGIN}/`, { cache: 'no-store' })).text()) !== want) return 'old home page';
    const statuses = await Promise.all(files.map(async (f) => (await fetch(`${ORIGIN}/assets/${f}`, { method: 'HEAD', cache: 'no-store' })).status));
    return statuses.every((st) => st === 200) ? 'ready' : `${statuses.filter((st) => st !== 200).length} files not served yet`;
  }, { timeout: 30_000, intervals: [250, 500, 1000] }).toBe('ready');
}

test.use({ baseURL: ORIGIN });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  fs.rmSync(work, { recursive: true, force: true });
  fs.cpSync(path.join(root, 'dist'), dirs.A, { recursive: true });
  makeReleaseB();
  fs.cpSync(dirs.A, dirs.live, { recursive: true });
  server = spawn('npx', ['wrangler', 'pages', 'dev', dirs.live, '--port', String(PORT), '--ip', '127.0.0.1'], { cwd: root, stdio: 'ignore', detached: true });
  await expect.poll(async () => (await fetch(`${ORIGIN}/`).catch(() => null))?.status ?? 0, { timeout: 60_000 }).toBe(200);
});
test.afterAll(() => {
  if (server?.pid) process.kill(-server.pid);
  fs.rmSync(work, { recursive: true, force: true });
});

const diagnostics: string[] = [];
function watch(page: Page) {
  const seen = { documents: 0, missingAssets: [] as string[] };
  diagnostics.length = 0;
  page.on('request', (r) => { if (r.resourceType() === 'document') seen.documents++; });
  page.on('response', (r) => { if (r.url().includes('/assets/') && r.status() === 404) seen.missingAssets.push(r.url().split('/assets/')[1]!); });
  page.on('console', (m) => { if (m.type() === 'error') diagnostics.push(`console: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => diagnostics.push(`pageerror: ${String(e).slice(0, 200)}`));
  return seen;
}

// CI keeps no screenshots, so a failure prints what the page showed.
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const text = await page.locator('body').innerText().catch(() => '(no page)');
  console.log(`[release-transition] ${info.title}\n  url: ${page.url()}\n  page: ${text.replace(/\s+/g, ' ').slice(0, 300)}\n  ${diagnostics.slice(0, 8).join('\n  ')}`);
});
/** A tab that has been open a while: signed in, and done with what it loads in the background at start. */
async function openTab(page: Page, name: string) {
  await enrollAsPlayer(page, name);
  await page.waitForLoadState('networkidle');
}
const graphLink = (page: Page) => page.getByRole('link', { name: 'Knowledge graph' }).first();
/** What the tab does when it comes back to the front: it checks for a release. Waits for that check. */
async function comeBack(page: Page) {
  const checked = page.waitForResponse((r) => r.url() === `${ORIGIN}/` && r.request().resourceType() === 'fetch');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await checked;
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50))); // let the check record its answer
}
const runningEntry = (page: Page) => page.evaluate(() => document.querySelector('script[type="module"][src]')!.getAttribute('src'));

test.describe('real release transitions', () => {
  test.beforeEach(async () => { await deploy('A'); });

  test('the server answers a deleted file with a real 404 that nothing caches, and app pages still load', async ({ request }) => {
    await deploy('B');
    const gone = await request.get(`/assets/${entryIn(dirs.A)}`);
    expect(gone.status()).toBe(404);
    expect(gone.headers()['cache-control']).toBe('no-store');
    const current = await request.get(`/assets/${entryIn(dirs.B)}`);
    expect(current.status()).toBe(200);
    expect(current.headers()['content-type']).toContain('javascript');
    expect(current.headers()['cache-control']).toContain('immutable');
    for (const route of ['/graph', '/wiki/kaela-brightwind', '/dm/edit/anything']) {
      const r = await request.get(route);
      expect(r.status(), route).toBe(200);
      expect(r.headers()['content-type'], route).toContain('text/html');
    }
  });

  test('prevention: a tab that has noticed the release loads the new one on the next click and never asks for a deleted file', async ({ page }) => {
    const seen = watch(page);
    await openTab(page, 'Transition Reader');
    expect(await runningEntry(page)).toContain(entryIn(dirs.A));
    await deploy('B');
    await comeBack(page);
    const before = seen.documents;
    await graphLink(page).click();
    await expect(page.getByTestId('graph-canvas')).toBeVisible({ timeout: 20_000 });
    expect(await runningEntry(page)).toContain(entryIn(dirs.B));
    expect(seen.documents - before).toBe(1); // one ordinary page load
    expect(seen.missingAssets).toEqual([]); // nothing deleted was ever requested
    await expect(page.getByTestId('error-screen')).toHaveCount(0);
  });

  test('recovery: a click before the tab noticed the release gets one 404, then one reload into the release', async ({ page }) => {
    const seen = watch(page);
    await openTab(page, 'Quick Reader');
    await deploy('B');
    const before = seen.documents;
    await graphLink(page).click(); // straight away: the five-minute check has not run
    await expect(page.getByTestId('graph-canvas')).toBeVisible({ timeout: 20_000 });
    expect(await runningEntry(page)).toContain(entryIn(dirs.B));
    expect(seen.documents - before).toBe(1);
    expect(seen.missingAssets).toHaveLength(1);
    expect(seen.missingAssets[0]).toMatch(/^GraphPage-/);
  });

  test('rollback: a tab on the newer release is carried back to the older one', async ({ page }) => {
    await deploy('B');
    const seen = watch(page);
    await openTab(page, 'Rollback Reader');
    expect(await runningEntry(page)).toContain(entryIn(dirs.B));
    await deploy('A'); // roll back
    await comeBack(page);
    await graphLink(page).click();
    await expect(page.getByTestId('graph-canvas')).toBeVisible({ timeout: 20_000 });
    expect(await runningEntry(page)).toContain(entryIn(dirs.A));
    expect(seen.missingAssets).toEqual([]);
  });

  test('a long-open tab moves through two releases in a row', async ({ page }) => {
    const seen = watch(page);
    await openTab(page, 'Long Reader');
    await deploy('B');
    await graphLink(page).click();
    await expect(page.getByTestId('graph-canvas')).toBeVisible({ timeout: 20_000 });
    await deploy('A'); // and back again, a few minutes later in real life
    await page.evaluate(() => sessionStorage.removeItem('chronicle-stale-build-reload')); // past the 5-minute window
    await page.getByRole('link', { name: 'Recently updated' }).first().click();
    await expect(page).toHaveURL(/\/recent$/);
    await expect(page.locator('main#main')).toBeVisible();
    await page.getByRole('link', { name: 'Maps' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
    expect(await runningEntry(page)).toContain(entryIn(dirs.A));
    await expect(page.getByTestId('error-screen')).toHaveCount(0);
    expect(seen.missingAssets.length).toBeLessThanOrEqual(2);
  });
});
