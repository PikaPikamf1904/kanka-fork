// "Appears in": a page lists the pages that name it in text the reader can read, even when nobody
// wrote a [[link]]. Synthetic sample content only.
import { expect, test } from '@playwright/test';
import { enrollAsPlayer, signInAsDm } from './support.ts';

test('a place nobody linked to still shows the session and stories that name it', async ({ page }) => {
  await enrollAsPlayer(page, 'Mentions Reader');
  await page.goto('/wiki/port-vellmoor');
  await expect(page.getByRole('heading', { name: 'Port Vellmoor', level: 1 })).toBeVisible();
  const appears = page.locator('section.what-links-here');
  await expect(appears.getByRole('heading', { name: 'Appears in' })).toBeVisible();
  await expect(appears.getByRole('link', { name: /Smoke over Vellmoor/ })).toBeVisible();
  // A Gazette story that names the place opens in the newspaper, not the wiki.
  await expect(appears.locator('a[href^="/news/"]').first()).toBeVisible();
});

test('a session journal lists the people and places its text names, even without links', async ({ page }) => {
  await enrollAsPlayer(page, 'Session Reader');
  await page.goto('/wiki/session-1-smoke-over-vellmoor');
  const table = page.getByRole('complementary', { name: 'Who, where and what' });
  await expect(table.getByRole('link', { name: 'Port Vellmoor' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Captain Merrin Vael' })).toBeVisible();
});

test('the DM sees the same appearances on the normal page view', async ({ page }) => {
  await signInAsDm(page);
  await page.goto('/wiki/port-vellmoor');
  await expect(page.locator('section.what-links-here')).toBeVisible();
});
