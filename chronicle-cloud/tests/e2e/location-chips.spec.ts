import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, recordApi, signInAsDm } from './support.ts';

// "Place" chips on an article. The test makes its OWN synthetic rows and removes them afterwards:
// a courier (readable) connected to a readable harbour (relation one way) and a readable tower
// (relation the other way) plus a DM-only cellar. The harbour has a player pin and a DM-only pin on
// a readable map, and a DM-only map; the cellar has a pin of its own on the readable map.

const docsShots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');
const tag = Date.now().toString(36);
const slugs = { courier: `zz-chip-courier-${tag}`, harbour: `zz-chip-harbour-${tag}`, tower: `zz-chip-tower-${tag}`, cellar: `zz-chip-cellar-${tag}`, map: `zz-chip-map-${tag}`, secretMap: `zz-chip-secret-map-${tag}` };
const T = { courier: `Chip Courier ${tag}`, harbour: `Chip Harbour ${tag}`, tower: `Chip Tower ${tag}`, cellar: `Chip Cellar ${tag}`, map: `Chip Coast Chart ${tag}`, secretMap: `Chip Secret Chart ${tag}`, pin: `Harbour Pin ${tag}`, secretPin: `Hidden Smugglers Pin ${tag}`, cellarPin: `Cellar Pin ${tag}` };
const DM_ONLY = [T.cellar, T.secretMap, T.secretPin, T.cellarPin, slugs.cellar, slugs.secretMap];

const cleanup = async () => {
  await db('delete from public.maps where slug = any($1)', [[slugs.map, slugs.secretMap]]);
  await db('delete from public.articles where slug = any($1)', [[slugs.courier, slugs.harbour, slugs.tower, slugs.cellar]]);
};

async function article(slug: string, type: string, title: string, visible: boolean) {
  const [a] = await db<{ id: string }>(
    `insert into public.articles (slug, type, title, summary, visibility, status) values ($1, $2, $3, $4, $5, $6) returning id`,
    [slug, type, title, `A synthetic ${type} for the chip test.`, visible ? 'players' : 'dm', visible ? 'published' : 'draft'],
  );
  return a!.id;
}

async function seed() {
  const courier = await article(slugs.courier, 'character', T.courier, true);
  const harbour = await article(slugs.harbour, 'location', T.harbour, true);
  const tower = await article(slugs.tower, 'location', T.tower, true);
  const cellar = await article(slugs.cellar, 'location', T.cellar, false);
  const rel = (s: string, t: string, kind: string, vis: string) =>
    db('insert into public.relations (source_article_id, target_article_id, kind, visibility) values ($1, $2, $3, $4)', [s, t, kind, vis]);
  await rel(courier, harbour, 'resides_in', 'players');
  await rel(tower, courier, 'controls', 'players'); // the other direction
  await rel(courier, cellar, 'resides_in', 'players'); // the cellar itself is DM-only
  const [map] = await db<{ id: string }>(`insert into public.maps (slug, title, visibility, status) values ($1, $2, 'players', 'published') returning id`, [slugs.map, T.map]);
  await db(`insert into public.maps (slug, title, article_id, visibility, status) values ($1, $2, $3, 'dm', 'draft')`, [slugs.secretMap, T.secretMap, harbour]);
  const pin = (label: string, x: number, y: number, article: string, vis: string) =>
    db(`insert into public.map_markers (map_id, x, y, label, description, article_id, visibility) values ($1, $2, $3, $4, 'A synthetic pin.', $5, $6) returning id`, [map!.id, x, y, label, article, vis]);
  await pin(T.pin, 1500, 400, harbour, 'players');
  await pin(T.secretPin, 300, 900, harbour, 'dm');
  await pin(T.cellarPin, 700, 1100, cellar, 'players'); // a player pin on a DM-only page: still hidden
}

const chips = (page: Page) => page.getByRole('navigation', { name: 'Places and maps' });

test.describe('Place chips', () => {
  test.beforeEach(async () => {
    await cleanup();
    await seed();
  });
  test.afterEach(cleanup);

  test('the DM sees every place and map, including DM-only ones', async ({ page }) => {
    await signInAsDm(page);
    await page.goto(`/wiki/${slugs.courier}`);
    await expect(page.getByRole('heading', { name: T.courier, level: 1 })).toBeVisible();
    for (const t of [T.harbour, T.tower, T.cellar]) await expect(chips(page).getByRole('link', { name: new RegExp(`^${t}$`) })).toBeVisible();
    await expect(chips(page).getByRole('link', { name: new RegExp(`On map: ${T.secretMap}`) })).toBeVisible();
    await expect(chips(page).getByRole('link', { name: new RegExp(`On map: ${T.map}`) }).first()).toBeVisible();
  });

  test('a player sees only readable places, the map opens focused on the pin, phone and desktop layout', async ({ browser }) => {
    test.setTimeout(120_000);
    const desktop = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
    const bodies = recordApi(desktop.context());
    await enrollAsPlayer(desktop, 'Chip Reader');
    await desktop.goto(`/wiki/${slugs.courier}`);
    await expect(desktop.getByRole('heading', { name: T.courier, level: 1 })).toBeVisible();
    const nav = chips(desktop);
    await expect(nav.getByRole('link', { name: new RegExp(`^${T.harbour}$`) })).toHaveAttribute('href', `/wiki/${slugs.harbour}`);
    await expect(nav.getByRole('link', { name: new RegExp(`^${T.tower}$`) })).toHaveAttribute('href', `/wiki/${slugs.tower}`);
    const mapChip = nav.getByRole('link', { name: new RegExp(`On map: ${T.map}`) });
    await expect(mapChip).toHaveCount(1);
    await expect(mapChip).toHaveAttribute('href', new RegExp(`^/maps/${slugs.map}\\?marker=[0-9a-f-]{36}$`));
    // Nothing DM-only anywhere: not on the page, not in any API response the browser received.
    for (const t of DM_ONLY) await expect(desktop.locator('body')).not.toContainText(t);
    await desktop.waitForLoadState('networkidle');
    const seen = bodies.map((b) => b.body).join('\n');
    for (const t of DM_ONLY) expect(seen).not.toContain(t);
    await noHorizontalOverflow(desktop);
    if (process.env.SAVE_DOC_SHOTS === '1') await desktop.screenshot({ path: path.join(docsShots, 'location-chips.png') });

    // The chip opens the map focused on the pin, with its popup.
    await mapChip.click();
    await expect(desktop).toHaveURL(new RegExp(`/maps/${slugs.map}\\?marker=`));
    await expect(desktop.locator('.leaflet-popup')).toContainText(T.pin);
    await expect(desktop.locator('.leaflet-popup')).toBeVisible();
    const pinBox = (await desktop.locator('.map-pin', { hasText: T.pin }).boundingBox())!;
    const mapBox = (await desktop.locator('.leaflet-container').boundingBox())!;
    expect(pinBox.x).toBeGreaterThan(mapBox.x);
    expect(pinBox.x + pinBox.width).toBeLessThan(mapBox.x + mapBox.width);
    expect(pinBox.y).toBeGreaterThan(mapBox.y);
    expect(pinBox.y + pinBox.height).toBeLessThan(mapBox.y + mapBox.height);
    await expect(desktop.locator('body')).not.toContainText(T.secretPin);
    await expect(desktop.locator('body')).not.toContainText(T.cellarPin);
    // An unknown or hidden pin id is ignored: the map just opens.
    await desktop.goto(`/maps/${slugs.map}?marker=00000000-0000-0000-0000-000000000000`);
    await expect(desktop.locator('.leaflet-container')).toBeVisible();
    await expect(desktop.locator('.leaflet-popup')).toHaveCount(0);
    await expect(desktop.locator('.map-pin', { hasText: T.pin })).toBeVisible();

    // The harbour's own page: the harbour has a pin and a (DM-only) map; the player gets the pin chip only.
    await desktop.goto(`/wiki/${slugs.harbour}`);
    await expect(chips(desktop).getByRole('link', { name: new RegExp(`On map: ${T.map}`) })).toBeVisible();
    await expect(chips(desktop).getByRole('link', { name: new RegExp(T.secretMap) })).toHaveCount(0);
    await expect(desktop.locator('body')).not.toContainText(T.secretMap);

    // A phone: chips wrap, are at least 44px tall and never push the page sideways.
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
    await enrollAsPlayer(phone, 'Chip Phone');
    await phone.goto(`/wiki/${slugs.courier}`);
    await expect(chips(phone).getByRole('link')).toHaveCount(3);
    for (const link of await chips(phone).getByRole('link').all()) {
      const b = (await link.boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(43.5);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
    }
    await noHorizontalOverflow(phone);
    // Keyboard: the chip takes focus and Enter follows it.
    await chips(phone).getByRole('link', { name: new RegExp(`^${T.tower}$`) }).focus();
    await phone.keyboard.press('Enter');
    await expect(phone).toHaveURL(new RegExp(`/wiki/${slugs.tower}$`));
  });

  test('a page with no connected place shows no chip row', async ({ page }) => {
    await db('delete from public.relations where source_article_id in (select id from public.articles where slug = $1) or target_article_id in (select id from public.articles where slug = $1)', [slugs.courier]);
    await signInAsDm(page);
    await page.goto(`/wiki/${slugs.courier}`);
    await expect(page.getByRole('heading', { name: T.courier, level: 1 })).toBeVisible();
    await expect(chips(page)).toHaveCount(0);
  });
});
