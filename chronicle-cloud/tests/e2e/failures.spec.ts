// A DM action that fails must say so. Believing a device was removed, or a map area hidden again,
// when it was not would leave players with access nobody knows about. Synthetic outages only.
import { expect, test, type Page } from '@playwright/test';
import { enrollAsPlayer, signInAsDm } from './support.ts';

/** Aborts the first matching write request, then lets everything through. */
async function failOnce(page: Page, url: string) {
  let outage = true;
  await page.route(url, (route) => {
    if (outage && route.request().method() !== 'GET') {
      outage = false;
      return route.abort();
    }
    return route.continue();
  });
}

test.describe('Failed actions are reported', () => {
  test('removing a player device: a failure is shown and the device still has access until it really works', async ({ browser }) => {
    const playerContext = await browser.newContext();
    const player = await playerContext.newPage();
    const name = `Outage Device ${Date.now().toString(36)}`;
    await enrollAsPlayer(player, name);

    const dmContext = await browser.newContext();
    const dm = await dmContext.newPage();
    await signInAsDm(dm);
    await dm.goto('/dm/access');
    const row = dm.getByRole('row', { name: new RegExp(name) });
    await failOnce(dm, '**/rest/v1/rpc/revoke_member*');
    dm.once('dialog', (d) => void d.accept());
    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(dm.getByRole('alert').filter({ hasText: 'did NOT happen' })).toBeVisible();
    await expect(row).toContainText('Active');
    await player.goto('/wiki/port-vellmoor');
    await expect(player.getByRole('heading', { name: 'Port Vellmoor', level: 1 })).toBeVisible();

    dm.once('dialog', (d) => void d.accept());
    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(row).toContainText('Removed');
    await expect(dm.getByRole('alert')).toHaveCount(0);
    await player.reload();
    await expect(player.getByText('This device no longer has access')).toBeVisible();
    await dmContext.close();
    await playerContext.close();
  });

  test('switching fog of war: a failure is shown and the switch does not pretend to have changed', async ({ page }) => {
    await signInAsDm(page);
    await page.goto('/maps/port-vellmoor-town');
    const off = page.getByRole('button', { name: 'Fog of war: off' });
    await expect(off).toBeVisible();
    await failOnce(page, '**/rest/v1/maps*');
    await off.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Changing fog of war did NOT happen' })).toBeVisible();
    await expect(off).toBeVisible();
    await off.click();
    await expect(page.getByRole('button', { name: 'Fog of war: on' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Fog of war: on' }).click();
    await expect(off).toBeVisible();
  });
});
