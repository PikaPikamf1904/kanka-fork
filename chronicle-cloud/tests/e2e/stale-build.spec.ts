import fs from 'node:fs';
import path from 'node:path';
import { devices, expect, test, type Page, type Route } from '@playwright/test';
import { enrollAsPlayer, noHorizontalOverflow, signInAsDm } from './support.ts';

// Chronicle open in a tab while a new release is deployed. A release replaces the hashed files under
// /assets, and Cloudflare Pages answers a name it no longer has with the home page (200, text/html),
// so the Knowledge Graph, which loads on demand, used to fail with "Failed to fetch dynamically
// imported module". These tests play a release against the real production build: the page is
// loaded from the real build, then the "server" changes under it.
//
//   old release = the build in dist/ (its entry script and its Knowledge Graph chunk)
//   new release = the same code under new file names (index-RELEASE2.js, GraphPage-RELEASE2.js)

const base = process.env.CHRONICLE_E2E_URL ?? 'http://127.0.0.1:8788';
const dist = path.resolve(import.meta.dirname, '../../dist');
const OLD_ENTRY = /assets\/(index-[^"']+\.js)/.exec(fs.readFileSync(path.join(dist, 'index.html'), 'utf8'))![1]!;
const OLD_CHUNK = fs.readdirSync(path.join(dist, 'assets')).find((f) => /^GraphPage-.+\.js$/.test(f))!;
const NEW_ENTRY = 'index-RELEASE2.js';
const NEW_CHUNK = 'GraphPage-RELEASE2.js';

// Rewriting the page's HTML here makes Chrome treat the page as "public", and its local-network
// protection would then block the page's calls to the local test database. Real Cloudflare pages
// are not affected; this only lets the test harness reach the local stack.
test.use({ launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'] } });

interface Server {
  /** A new release is live: the home page names the new entry script, and the old chunk is gone. */
  released: boolean;
  /** The old Knowledge Graph chunk is gone even though no release is reported (a flaky edge, say). */
  oldChunkGone: boolean;
  /** The new release is itself broken: its chunk is missing too. */
  newChunkGone: boolean;
  /** Page loads still get the OLD home page (a stale intermediary); the background check sees the new one. */
  staleDocuments: boolean;
}
const idle = (): Server => ({ released: false, oldChunkGone: false, newChunkGone: false, staleDocuments: false });

// What Cloudflare Pages sends for a file it does not have.
// A release renames every file consistently, so each reference to the old entry or chunk is renamed too.
const renamed = (js: string) => js.replaceAll(OLD_ENTRY, NEW_ENTRY).replaceAll(OLD_CHUNK, NEW_CHUNK);
const missing = (route: Route, html: string) =>
  route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, body: html });

async function playReleases(page: Page, server: Server) {
  const documents: string[] = [];
  page.on('request', (r) => { if (r.resourceType() === 'document') documents.push(r.url()); });
  await page.route((url) => url.origin === base, async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    const isDocument = req.resourceType() === 'document';
    if (pathname === `/assets/${OLD_CHUNK}`) {
      if (server.released || server.oldChunkGone) return missing(route, '<!doctype html><title>Chronicle</title>');
      return route.continue();
    }
    if (pathname === `/assets/${NEW_ENTRY}`) {
      const real = await route.fetch({ url: `${base}/assets/${OLD_ENTRY}` });
      return route.fulfill({ response: real, body: renamed(await real.text()) });
    }
    if (pathname === `/assets/${NEW_CHUNK}`) {
      if (server.newChunkGone) return missing(route, '<!doctype html><title>Chronicle</title>');
      const real = await route.fetch({ url: `${base}/assets/${OLD_CHUNK}` });
      return route.fulfill({ response: real, body: renamed(await real.text()) });
    }
    // (Not when a stale intermediary keeps serving the old home page: then the old files really are old.)
    if (server.released && !server.staleDocuments && pathname.startsWith('/assets/') && pathname.endsWith('.js')) {
      const real = await route.fetch();
      return route.fulfill({ response: real, body: renamed(await real.text()) });
    }
    if (isDocument || (req.resourceType() === 'fetch' && pathname === '/')) {
      const real = await route.fetch();
      const html = await real.text();
      const serveNew = server.released && !(server.staleDocuments && isDocument);
      return route.fulfill({ response: real, body: serveNew ? html.replace(OLD_ENTRY, NEW_ENTRY) : html });
    }
    return route.continue();
  });
  return documents;
}

const graphLink = (page: Page) => page.getByRole('link', { name: 'Knowledge graph' }).first();

test.describe('a release while Chronicle is open', () => {
  test('a player is carried to the new release by one reload, and the page opens', async ({ page }) => {
    const server = idle();
    const documents = await playReleases(page, server);
    await enrollAsPlayer(page, 'Release Reader');
    const before = documents.length;
    server.released = true; // a deployment happens while the tab is open
    await graphLink(page).click();
    await expect(page.getByTestId('graph-canvas')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/graph$/);
    expect(documents.length - before).toBe(1); // exactly one reload
    await expect(page.getByTestId('error-screen')).toHaveCount(0);
    // Still a player after the reload: no DM menu.
    await expect(page.getByRole('link', { name: 'DM desk' })).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelector('script[type="module"][src]')!.getAttribute('src'))).toContain(NEW_ENTRY);
  });

  test('the DM is carried over too and stays signed in', async ({ page }) => {
    const server = idle();
    const documents = await playReleases(page, server);
    await signInAsDm(page);
    const before = documents.length;
    server.released = true;
    await graphLink(page).click();
    await expect(page.getByTestId('graph-canvas')).toBeVisible({ timeout: 20_000 });
    expect(documents.length - before).toBe(1);
    await expect(page.getByTestId('error-screen')).toHaveCount(0);
  });

  test('without a newer release the friendly screen appears and nothing reloads', async ({ page }) => {
    const server = idle();
    const documents = await playReleases(page, server);
    await enrollAsPlayer(page, 'Flaky Reader');
    const before = documents.length;
    server.oldChunkGone = true; // the file is missing, but there is no new release to move to
    await graphLink(page).click();
    const screen = page.getByTestId('error-screen');
    await expect(screen).toBeVisible({ timeout: 20_000 });
    await expect(screen).toContainText('This page could not be loaded');
    await expect(screen).toContainText('Nothing you saved has been lost');
    await expect(page.getByText('Unexpected Application Error')).toHaveCount(0);
    expect(documents.length - before).toBe(0);
    // The menu is still there, inside the same layout, and the way home works.
    await expect(graphLink(page)).toBeVisible();
    await screen.getByRole('link', { name: 'Go to the main page' }).click();
    await expect(page).toHaveURL(`${base}/`);
    await expect(page.locator('main#main')).toBeVisible();
  });

  test('the Reload button gets the page once the server has it again', async ({ page }) => {
    const server = idle();
    await playReleases(page, server);
    await enrollAsPlayer(page, 'Button Reader');
    server.oldChunkGone = true;
    await graphLink(page).click();
    await expect(page.getByTestId('error-screen')).toBeVisible({ timeout: 20_000 });
    server.oldChunkGone = false; // the file is back (the edge caught up)
    await page.getByRole('button', { name: 'Reload the page' }).click();
    await expect(page.getByTestId('graph-canvas')).toBeVisible({ timeout: 20_000 });
  });

  test('a broken release reloads once, then shows the screen: no loop', async ({ page }) => {
    const server = idle();
    const documents = await playReleases(page, server);
    await enrollAsPlayer(page, 'Loop Reader');
    const before = documents.length;
    server.released = true;
    server.newChunkGone = true; // the new release is missing its own chunk
    await graphLink(page).click();
    await expect(page.getByTestId('error-screen')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000); // a loop would show up as more page loads
    expect(documents.length - before).toBe(1);
  });

  test('a stale home page served again after the reload still stops after one reload', async ({ page }) => {
    const server = idle();
    const documents = await playReleases(page, server);
    await enrollAsPlayer(page, 'Stale Reader');
    const before = documents.length;
    server.released = true;
    server.staleDocuments = true; // every reload brings back the OLD page, so the tab never catches up
    await graphLink(page).click();
    await expect(page.getByTestId('error-screen')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000);
    expect(documents.length - before).toBe(1); // the one-reload limit held
  });
});

test.describe('on a phone', () => {
  // Playwright refuses a browser type inside a describe group, so take it out of the device description.
  const pixel: Record<string, unknown> = { ...devices['Pixel 7'] };
  delete pixel.defaultBrowserType;
  test.use(pixel);

  test('a release is recovered from on a phone', async ({ page }) => {
    const server = idle();
    const documents = await playReleases(page, server);
    await enrollAsPlayer(page, 'Phone Reader');
    // The menu is behind a button on a phone; go there through the address instead of the menu.
    const before = documents.length;
    server.released = true;
    await page.evaluate(() => { window.history.pushState({}, '', '/graph'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await expect(page.getByTestId('graph-canvas')).toBeVisible({ timeout: 20_000 });
    expect(documents.length - before).toBe(1);
    await noHorizontalOverflow(page);
  });

  test('the friendly screen fits a phone and its buttons are large enough to tap', async ({ page }) => {
    const server = idle();
    await playReleases(page, server);
    await enrollAsPlayer(page, 'Phone Screen Reader');
    server.oldChunkGone = true;
    await page.evaluate(() => { window.history.pushState({}, '', '/graph'); window.dispatchEvent(new PopStateEvent('popstate')); });
    const screen = page.getByTestId('error-screen');
    await expect(screen).toBeVisible({ timeout: 20_000 });
    await noHorizontalOverflow(page);
    for (const control of [screen.getByRole('button', { name: 'Reload the page' }), screen.getByRole('link', { name: 'Go to the main page' })]) {
      await expect(control).toBeInViewport();
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  });
});
