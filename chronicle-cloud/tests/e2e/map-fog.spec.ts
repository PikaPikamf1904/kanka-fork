import { expect, test, type Page } from '@playwright/test';
import { enrollAsPlayer, signInAsDm } from './support.ts';

const MAP = '/maps/port-vellmoor-town';

async function fogHoles(page: Page) {
  await expect(page.locator('.leaflet-container')).toBeVisible();
  return page.locator('svg.map-fog mask polygon').count();
}

test('fog of war: the DM draws and reveals an area, and players see only what is revealed', async ({ page, browser }) => {
  await signInAsDm(page);
  await page.goto(MAP);
  await page.getByRole('button', { name: 'Fog of war: off' }).click();
  await expect(page.getByRole('button', { name: 'Fog of war: on' })).toBeVisible();
  await expect(page.getByText('None yet: players see this whole map covered.')).toBeVisible();

  // Draw a triangle by clicking three corners on the map.
  await page.getByRole('button', { name: 'Draw fog area' }).click();
  const box = (await page.locator('.leaflet-container').boundingBox())!;
  for (const [fx, fy] of [[0.3, 0.3], [0.6, 0.3], [0.45, 0.6]] as const) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  }
  await expect(page.getByRole('status')).toContainText('3 corners');
  await page.getByRole('button', { name: 'Finish area' }).click();
  const dialog = page.getByRole('dialog', { name: 'Fog area' });
  await dialog.getByLabel('Name (only you see it)').fill('Synthetic dock');
  await expect(dialog.getByLabel('Revealed to players')).toBeChecked();
  await dialog.getByRole('button', { name: 'Save area' }).click();
  await expect(page.locator('.fog-list')).toContainText('Synthetic dock');
  await expect(page.locator('.fog-list')).toContainText('revealed');
  await expect(page.locator('svg.map-fog-dm polygon.map-fog-area.revealed')).toHaveCount(1);

  // A player sees solid fog with one clear area, and no DM outlines.
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  await enrollAsPlayer(player, 'Fog Tester');
  await player.goto(MAP);
  expect(await fogHoles(player)).toBe(1);
  await expect(player.locator('svg.map-fog-dm')).toHaveCount(0);
  await expect(player.locator('.map-fog-area')).toHaveCount(0);
  await expect(player.getByRole('button', { name: /Fog of war/ })).toHaveCount(0);

  // The DM hides it again: the player gets full fog, and the area's name never reaches them.
  await page.locator('.fog-list').getByRole('button', { name: 'hide again' }).click();
  await expect(page.locator('svg.map-fog-dm polygon.map-fog-area.fogged')).toHaveCount(1);
  const bodies: string[] = [];
  player.on('response', async (r) => {
    if (r.url().includes('/rest/v1/')) bodies.push(await r.text().catch(() => ''));
  });
  await player.reload();
  expect(await fogHoles(player)).toBe(0);
  await expect(player.locator('svg.map-fog')).toHaveCount(1);
  await player.waitForLoadState('networkidle');
  expect(bodies.join('\n')).not.toContain('Synthetic dock');
  await playerContext.close();

  // Clean up: delete the area and turn fog off again.
  await page.locator('.fog-list').getByRole('button', { name: 'edit' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('dialog', { name: 'Fog area' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('None yet: players see this whole map covered.')).toBeVisible();
  await page.getByRole('button', { name: 'Fog of war: on' }).click();
  await expect(page.getByRole('button', { name: 'Fog of war: off' })).toBeVisible();
  await expect(page.locator('svg.map-fog')).toHaveCount(0);
});
