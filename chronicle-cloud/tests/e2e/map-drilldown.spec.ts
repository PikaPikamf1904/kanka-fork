import { expect, test, type Page } from '@playwright/test';
import { enrollAsPlayer, signInAsDm } from './support.ts';

async function openPin(page: Page, label: string) {
  await page.goto('/maps/ember-coast');
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await page.locator('.map-pin').filter({ hasText: label }).click();
  return page.locator('.leaflet-popup');
}

test.describe('Map pins open the map of the place they mark', () => {
  test('a player opens the town map from its pin and can go back up', async ({ page }) => {
    await enrollAsPlayer(page);
    const popup = await openPin(page, 'Port Vellmoor');
    await expect(popup).toContainText('Read: Port Vellmoor');
    await popup.getByRole('link', { name: 'Open map: Port Vellmoor (town)' }).click();
    await expect(page).toHaveURL(/\/maps\/port-vellmoor-town$/);
    await expect(page.getByRole('heading', { name: 'Port Vellmoor (town)' })).toBeVisible();
    await expect(page.locator('.map-pin').filter({ hasText: "Harbourmaster's office" })).toBeVisible();
    await page.getByRole('link', { name: 'The Ember Coast' }).first().click();
    await expect(page).toHaveURL(/\/maps\/ember-coast$/);
  });

  test('a hidden map is never offered to a player, but is to the DM', async ({ page, browser }) => {
    await enrollAsPlayer(page);
    const bodies: string[] = [];
    page.on('response', async (r) => {
      if (r.url().includes('/rest/v1/')) bodies.push(await r.text().catch(() => ''));
    });
    const popup = await openPin(page, 'The Dragon Nest');
    await expect(popup).toContainText('Read: The Dragon Nest');
    await expect(popup.getByRole('link', { name: /Open map/ })).toHaveCount(0);
    expect(bodies.join('\n')).not.toContain('dragon-nest-interior');

    const dmContext = await browser.newContext();
    const dm = await dmContext.newPage();
    await signInAsDm(dm);
    const dmPopup = await openPin(dm, 'The Dragon Nest');
    await expect(dmPopup.getByRole('link', { name: 'Open map: Inside the Dragon Nest' })).toBeVisible();
    await dmContext.close();
  });
});
