import { expect, test } from '@playwright/test';
import { enrollAsPlayer, noHorizontalOverflow, recordApi, SAMPLE_SECRETS, screenshot } from './support.ts';

test.describe('player', () => {
  test('access screen refuses a wrong code', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Chronicle' })).toBeVisible();
    await screenshot(page, '01-access-screen');
    await page.getByLabel('Access code').fill('definitely-not-the-code');
    await page.getByLabel('Your name at the table').fill('Nobody');
    await page.getByRole('button', { name: 'Enter Chronicle' }).click();
    await expect(page.getByRole('alert')).toContainText('not accepted');
  });

  test('never receives DM-only content anywhere, on screen or over the network', async ({ page, context }) => {
    const api = recordApi(context);
    const consoleErrors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    await enrollAsPlayer(page, 'Tasslehoof Tester');

    await expect(page.getByRole('heading', { name: 'Chronicle', level: 1 })).toBeVisible();
    await expect(page.getByText('Operation Emberfall').first()).toBeVisible();
    await screenshot(page, '02-home-player');

    const visits = [
      '/wiki/captain-merrin-vael', '/wiki/port-vellmoor', '/wiki/the-dragon-nest', '/wiki/operation-emberfall',
      '/wiki/silver-quill-society', '/wiki/lantern-of-seven-stars', '/wiki/the-three-moons',
      '/browse/character', '/browse/location', '/browse/session', '/categories', '/category/port-vellmoor',
      '/timeline', '/connections', '/maps', '/maps/ember-coast', '/search?q=broker', '/search?q=harbour',
    ];
    for (const path of visits) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const text = await page.locator('body').innerText();
      for (const secret of SAMPLE_SECRETS) expect(text, `${path} shows "${secret}"`).not.toContain(secret);
    }

    for (const { url, body } of api) {
      for (const secret of SAMPLE_SECRETS) expect(body, `${url} returned "${secret}"`).not.toContain(secret);
    }
    expect(api.length).toBeGreaterThan(20);
    expect(consoleErrors.filter((e) => !e.includes('favicon'))).toEqual([]);
  });

  test('article page: infobox, contents, connections and backlinks, without DM rows', async ({ page }) => {
    await enrollAsPlayer(page);
    await page.goto('/wiki/captain-merrin-vael');
    await expect(page.getByRole('heading', { name: 'Captain Merrin Vael', level: 1 })).toBeVisible();
    const infobox = page.getByRole('complementary', { name: /at a glance/ });
    await expect(infobox).toContainText('Harbourmaster');
    await expect(infobox).not.toContainText('True identity');
    await expect(page.getByRole('navigation', { name: 'Contents' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Secrets' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Next session' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Connections' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What links here' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await screenshot(page, '03-article-player');

    await page.getByRole('link', { name: 'Port Vellmoor' }).first().click();
    await expect(page.getByRole('heading', { name: 'Port Vellmoor', level: 1 })).toBeVisible();
  });

  test('hidden pages and DM redirects look like pages that do not exist', async ({ page }) => {
    await enrollAsPlayer(page);
    for (const slug of ['the-masked-broker', 'the-firestarter', 'dossier-nest-commander', 'session-3-draft']) {
      await page.goto(`/wiki/${slug}`);
      await expect(page.getByRole('heading', { name: 'Nothing written here yet' })).toBeVisible();
    }
    await page.goto('/wiki/vellmoor');
    await expect(page.getByRole('heading', { name: 'Port Vellmoor', level: 1 })).toBeVisible();
    await expect(page.getByText('(Redirected from vellmoor)')).toBeVisible();
    await page.goto('/dm');
    await expect(page.getByRole('heading', { name: 'Nothing written here yet' })).toBeVisible();
  });

  test('search and suggestions', async ({ page }) => {
    await enrollAsPlayer(page);
    const box = page.getByRole('combobox').first();
    await box.fill('Port');
    await expect(page.getByRole('option', { name: /Port Vellmoor/ })).toBeVisible();
    await box.fill('the masked');
    await expect(page.getByRole('option')).toHaveCount(0);
    await page.goto('/search?q=ledger');
    await expect(page.getByRole('link', { name: 'Operation Emberfall' })).toBeVisible();
    await expect(page.locator('.search-results mark').first()).toBeVisible();
  });

  test('map shows only discovered markers', async ({ page }) => {
    await enrollAsPlayer(page);
    await page.goto('/maps/ember-coast');
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await expect(page.locator('.map-pin')).toHaveCount(3);
    await expect(page.locator('.marker-list li')).toHaveCount(3);
    await page.getByPlaceholder('Find a place…').fill('spire');
    await expect(page.locator('.marker-list li')).toHaveCount(1);
    await page.getByPlaceholder('Find a place…').fill('');
    await page.locator('.map-pin').filter({ hasText: 'Port Vellmoor' }).click();
    await expect(page.locator('.leaflet-popup')).toContainText('Read: Port Vellmoor');
    await screenshot(page, '05-map-player');
  });

  test('timeline and connections hide DM rows', async ({ page }) => {
    await enrollAsPlayer(page);
    await page.goto('/timeline');
    await expect(page.locator('.timeline li')).toHaveCount(3);
    await page.goto('/connections');
    await expect(page.getByText('Secret agent')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Kaela Brightwind' }).first()).toBeVisible();
  });

  test('leaving the device signs it out', async ({ page }) => {
    await enrollAsPlayer(page);
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Leave on this device' }).click();
    // (desktop layout: the sidebar is always visible)
    await expect(page.getByLabel('Access code')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Access code')).toBeVisible();
  });

  test('stays signed in across reloads', async ({ page }) => {
    await enrollAsPlayer(page);
    await page.reload();
    await expect(page.getByRole('link', { name: 'Main page' })).toBeVisible();
  });
});

test.describe('player on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('menu, article and map work without sideways scrolling', async ({ page }) => {
    await enrollAsPlayer(page);
    await noHorizontalOverflow(page);
    await screenshot(page, '06-home-phone');
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Wiki' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Wiki' }).getByRole('link', { name: 'Characters' }).click();
    await expect(page.getByRole('heading', { name: /Characters/ })).toBeVisible();
    await page.goto('/wiki/the-dragon-nest');
    await expect(page.getByRole('heading', { name: 'The Dragon Nest', level: 1 })).toBeVisible();
    await noHorizontalOverflow(page);
    await screenshot(page, '07-article-phone');
    await page.goto('/maps/ember-coast');
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await noHorizontalOverflow(page);
  });
});

test.describe('player on a tablet, dark mode', () => {
  test.use({ viewport: { width: 820, height: 1180 }, colorScheme: 'dark' });

  test('home and article render in dark mode', async ({ page }) => {
    await enrollAsPlayer(page);
    await noHorizontalOverflow(page);
    await page.goto('/wiki/operation-emberfall');
    await expect(page.getByRole('heading', { name: 'Operation Emberfall', level: 1 })).toBeVisible();
    await noHorizontalOverflow(page);
    await screenshot(page, '08-article-tablet-dark');
  });
});
