import path from 'node:path';
import { expect, test } from '@playwright/test';
import { enrollAsPlayer } from './support.ts';

// The maintenance notice: the real /api/status function (no switch set locally, so no notice), its
// refusal of unauthenticated writes, and the banner when the status says maintenance is on.

const docsShots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');

test.describe('Maintenance notice', () => {
  test('off by default; writes need the token; the banner shows the exact message when on', async ({ page, request }) => {
    const off = await request.get('/api/status');
    expect(off.status()).toBe(200);
    expect(await off.json()).toEqual({ notice: false, message: null });
    // No MAINTENANCE_TOKEN is configured locally: the write endpoint does not even admit to existing.
    const write = await request.post('/api/status', { data: { kind: 'deploy', state: 'start' }, headers: { authorization: 'Bearer guess' } });
    expect(write.status()).toBe(404);

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
});
