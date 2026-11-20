// Importing a picture for a map: pick the file, save the map, and the picture shows on the map.
import { expect, test, type Page } from '@playwright/test';
import { db } from './db.ts';
import { signInAsDm } from './support.ts';

async function mapPicture(page: Page, label: string, width = 1700, height = 1225) {
  const dataUrl = await page.evaluate(({ label, width, height }) => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const x = c.getContext('2d')!;
    x.fillStyle = '#b9d3c2';
    x.fillRect(0, 0, width, height);
    x.fillStyle = '#2a2217';
    x.font = 'bold 120px serif';
    x.fillText(label, 80, height / 2);
    return c.toDataURL('image/png');
  }, { label, width, height });
  return { name: 'map.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') };
}

const SLUG = 'map-image-probe';
/** On the map's own page (the editor's address /dm/maps/... also ends the same way, so match the whole path). */
const shown = (page: Page) => page.waitForURL((u) => u.pathname === `/maps/${SLUG}`);
test.beforeEach(async () => {
  await db(`delete from public.maps where slug = $1`, [SLUG]);
});
test.afterAll(async () => {
  await db(`delete from public.maps where slug = $1`, [SLUG]);
});

test('a new map keeps the picture that was chosen and shows it', async ({ page }) => {
  await signInAsDm(page);
  await page.goto('/dm/maps/new');
  await page.getByLabel('Title').fill('Map Image Probe');
  await page.locator('input[type="file"]').setInputFiles(await mapPicture(page, 'PROBE'));
  await expect(page.locator('.hero-thumb')).toBeVisible();
  await page.getByRole('button', { name: 'Save map' }).click();
  await shown(page);
  const [row] = await db<{ media_id: string | null; width: number; height: number }>(`select media_id, width, height from public.maps where slug = $1`, [SLUG]);
  expect(row?.media_id).not.toBeNull();
  expect([row?.width, row?.height]).toEqual([1700, 1225]);
  await expect.poll(() => page.locator('img.leaflet-image-layer').evaluateAll((els) => (els as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth > 0).length)).toBe(1);
});

test('adding a picture to an existing map: saving keeps it and shows it', async ({ page }) => {
  await db(`insert into public.maps (slug, title, width, height, visibility, status) values ($1, 'Map Image Probe', 2000, 1500, 'dm', 'draft')`, [SLUG]);
  await signInAsDm(page);
  await page.goto(`/dm/maps/${SLUG}`);
  await expect(page.getByLabel('Title')).toHaveValue('Map Image Probe');
  await page.locator('input[type="file"]').setInputFiles(await mapPicture(page, 'SECOND'));
  await expect(page.locator('.hero-thumb')).toBeVisible();
  await page.getByRole('button', { name: 'Save map' }).click();
  await shown(page);
  const [row] = await db<{ media_id: string | null }>(`select media_id from public.maps where slug = $1`, [SLUG]);
  expect(row?.media_id).not.toBeNull();
  await expect.poll(() => page.locator('img.leaflet-image-layer').evaluateAll((els) => (els as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth > 0).length)).toBe(1);
});

test('Save waits for a slow upload instead of keeping the map without its picture', async ({ page }) => {
  await db(`insert into public.maps (slug, title, width, height, visibility, status) values ($1, 'Map Image Probe', 2000, 1500, 'dm', 'draft')`, [SLUG]);
  const [before] = await db<{ n: string }>(`select count(*)::text n from public.media where role = 'display'`);
  await signInAsDm(page);
  await page.goto(`/dm/maps/${SLUG}`);
  await expect(page.getByLabel('Title')).toHaveValue('Map Image Probe');
  // A slow connection: the picture's upload to Storage takes a few seconds.
  await page.route('**/storage/v1/object/**', async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });
  await page.locator('input[type="file"]').setInputFiles(await mapPicture(page, 'SLOW'));
  const save = page.getByRole('button', { name: /Uploading picture|Save map/ });
  await expect(save).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Uploading the picture' })).toBeVisible();
  // Nothing is saved while it uploads.
  const [during] = await db<{ media_id: string | null }>(`select media_id from public.maps where slug = $1`, [SLUG]);
  expect(during?.media_id).toBeNull();
  await expect(page.getByRole('status').filter({ hasText: 'Picture ready' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Save map' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save map' }).click();
  await shown(page);
  const [row] = await db<{ media_id: string | null }>(`select media_id from public.maps where slug = $1`, [SLUG]);
  expect(row?.media_id).not.toBeNull();
  // One map, one picture: this flow left nothing unattached.
  const [after] = await db<{ n: string }>(`select count(*)::text n from public.media where role = 'display'`);
  expect(Number(after!.n) - Number(before!.n)).toBe(1);
});
