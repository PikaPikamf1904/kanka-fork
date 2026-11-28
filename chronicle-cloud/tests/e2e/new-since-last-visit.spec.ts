// "New since your last visit" marks pages first published after the reader's previous visit, from a
// timestamp kept in this browser only. The first visit marks nothing. Synthetic sample content.
import { expect, test } from '@playwright/test';
import { enrollAsPlayer } from './support.ts';

test('a returning player sees what was published since their last visit; a first visit marks nothing', async ({ page }) => {
  await enrollAsPlayer(page, 'Returning Reader');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Recently updated' })).toBeVisible();
  await expect(page.getByText('New since your last visit')).toHaveCount(0);

  // Pretend this browser's last visit began a long time ago (before the sample content was published).
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('chronicle-visits:'))!;
    localStorage.setItem(key, JSON.stringify({ current: '2000-01-01T00:00:00.000Z', previous: null }));
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'New and recently updated' })).toBeVisible();
  await expect(page.getByText('New since your last visit').first()).toBeVisible();

  // Reading around in the same visit keeps the marks.
  await page.reload();
  await expect(page.getByText('New since your last visit').first()).toBeVisible();
});
