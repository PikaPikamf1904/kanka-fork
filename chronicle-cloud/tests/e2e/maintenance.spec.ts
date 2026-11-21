import path from 'node:path';
import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, signInAsDm } from './support.ts';

// The maintenance notice: the real /api/status function (no switch set locally, so no notice), its
// refusal of writes, and the banner when the status says maintenance is on.

const docsShots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');

test.describe('Maintenance notice', () => {
  test('off by default; it cannot be written; the banner shows the exact message when on', async ({ page, request }) => {
    const off = await request.get('/api/status');
    expect(off.status()).toBe(200);
    expect(await off.json()).toEqual({ notice: false, message: null });
    // The status can only be read; there is nothing to write to.
    const write = await request.post('/api/status', { data: { kind: 'deploy', state: 'start' }, headers: { authorization: 'Bearer guess' } });
    expect(write.status()).toBe(405);

    await enrollAsPlayer(page, 'Maintenance Probe');
    await expect(page.getByTestId('maintenance-notice')).toHaveCount(0);

    const message = 'Declan is currently performing maintenance on Chronicle. Some features may be temporarily unavailable or behave unexpectedly. Please save your work before refreshing.';
    await page.route('**/api/status', (route) => route.fulfill({ json: { notice: true, message } }));
    await page.reload();
    await expect(page.getByTestId('maintenance-notice')).toContainText(message);
    await expect(page.getByTestId('maintenance-notice')).toHaveAttribute('role', 'status');
    if (process.env.SAVE_DOC_SHOTS === '1') await page.screenshot({ path: path.join(docsShots, 'maintenance-notice.png'), clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 260 } });

    // A status outage shows nothing rather than a false alarm.
    await page.route('**/api/status', (route) => route.fulfill({ status: 503, body: 'down' }));
    await page.reload();
    await expect(page.locator('main#main')).toBeVisible();
    await expect(page.getByTestId('maintenance-notice')).toHaveCount(0);
  });

  test('the DM switches the notice on from Wiki settings; it shows to players and turns off again', async ({ page, browser }) => {
    await db('update public.campaign_settings set maintenance_until = null');
    await signInAsDm(page);
    await page.goto('/dm/settings');
    const panel = page.getByTestId('maintenance-switch');
    await expect(panel.getByRole('status')).toHaveText('Off.');
    await panel.getByRole('button', { name: 'Show for 30 minutes' }).click();
    await expect(panel.getByRole('status')).toContainText('On until');
    // The DM's own page shows the banner at once, without waiting for the next check or a reload.
    await expect(page.getByTestId('maintenance-notice')).toContainText('Declan is currently performing maintenance on Chronicle.', { timeout: 5000 });

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const player = await ctx.newPage();
    await enrollAsPlayer(player, 'Switch Probe');
    await expect(player.getByTestId('maintenance-notice')).toContainText('Declan is currently performing maintenance on Chronicle.');
    // The notice does not block the menu on a phone.
    await player.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(player.getByRole('link', { name: 'Main page' })).toBeVisible();

    await panel.getByRole('button', { name: 'Turn off now' }).click();
    await expect(panel.getByRole('status')).toHaveText('Off.');
    await expect(page.getByTestId('maintenance-notice')).toHaveCount(0, { timeout: 5000 });
    await player.reload();
    await expect(player.locator('main#main')).toBeVisible();
    await expect(player.getByTestId('maintenance-notice')).toHaveCount(0);
    await ctx.close();
  });

  test('the first screen shows the deploy or Cloudflare notice to visitors who are not signed in', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /who.s at the table/i })).toBeVisible();
    await expect(page.getByTestId('maintenance-notice')).toHaveCount(0);
    const message = 'Declan is currently performing maintenance on Chronicle. Some features may be temporarily unavailable or behave unexpectedly. Please save your work before refreshing.';
    await page.route('**/api/status', (route) => route.fulfill({ json: { notice: true, message } }));
    await page.reload();
    await expect(page.getByTestId('maintenance-notice')).toContainText(message);
    // Signed out, the DM's switch is not asked for, so nothing fails in the console.
    expect(errors).toEqual([]);
  });
});
