import { expect, test, type Page } from '@playwright/test';
import { enrollAsPlayer, noHorizontalOverflow, signInAsDm } from './support.ts';

// The seeded wiki is never empty, so simulate a new one: every article list comes back empty.
async function emptyWiki(page: Page) {
  await page.route('**/rest/v1/articles*', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    else await route.continue();
  });
}

test.describe('Home page of a new, empty wiki', () => {
  test('the DM gets a short getting-started list, and no empty panels', async ({ page }) => {
    await signInAsDm(page);
    await emptyWiki(page);
    await page.goto('/');
    const guide = page.getByTestId('home-empty-dm');
    await expect(guide).toBeVisible();
    await expect(guide.getByRole('link', { name: 'import a lore package' })).toHaveAttribute('href', '/dm/import');
    await expect(page.getByRole('heading', { name: 'Important characters' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recently updated' })).toHaveCount(0);
    await noHorizontalOverflow(page);
  });

  test('a player sees a plain message and no DM guidance', async ({ page }) => {
    await enrollAsPlayer(page, 'Empty Wiki Reader');
    await emptyWiki(page);
    await page.goto('/');
    await expect(page.getByTestId('home-empty-player')).toBeVisible();
    await expect(page.getByTestId('home-empty-dm')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /import a lore package/i })).toHaveCount(0);
  });
});
