import { expect, test } from '@playwright/test';
import { enrollAsPlayer, noHorizontalOverflow, signInAsDm } from './support.ts';

test.describe('The Goblin Gazette', () => {
  test('players read the printed paper: masthead, lead story, stamps, story page and links', async ({ page }) => {
    await enrollAsPlayer(page, 'Gazette Reader');
    await page.goto('/news');
    await expect(page.getByRole('link', { name: 'The Goblin Gazette' }).first()).toBeVisible();
    await expect(page.getByText('“All the news that’s fit to steal.”')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Fires on the Coast Road as Wagons Turn Back' })).toBeVisible();
    await expect(page.locator('.gz-stamp', { hasText: 'Unconfirmed' }).first()).toBeVisible();
    await expect(page.getByText('Harbourmaster in Secret Talks')).toHaveCount(0);
    await noHorizontalOverflow(page);

    await page.getByRole('link', { name: 'Fires on the Coast Road as Wagons Turn Back' }).click();
    await expect(page).toHaveURL(/\/news\/fires-on-the-coast-road$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Fires on the Coast Road as Wagons Turn Back' })).toBeVisible();
    await expect(page.getByText('Mossbottom Quill', { exact: true })).toBeVisible();
    const related = page.getByRole('complementary', { name: 'In the Chronicle' });
    await expect(related.getByRole('link', { name: 'Port Vellmoor' })).toBeVisible();
    await expect(related.getByRole('link', { name: 'Captain Merrin Vael' })).toBeVisible();

    await page.goto('/news/lights-over-the-spire');
    await expect(page.getByText('Not established fact.')).toBeVisible();
    await page.goto('/news/harbourmaster-secret-talks');
    await expect(page.getByRole('heading', { name: 'Nothing written here yet' })).toBeVisible();
    await page.goto('/news?section=corrections');
    await expect(page.getByRole('heading', { name: 'Correction: Dragons Are Not “Mostly Harmless”' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Fires on the Coast Road as Wagons Turn Back' })).toHaveCount(0);
  });

  test('the DM writes, reviews and prints a story; players only see it while it is printed', async ({ page, browser }) => {
    const headline = `Goats Seen Wearing Hats ${Date.now().toString(36)}`;
    await signInAsDm(page);
    await page.goto('/dm/news');
    await expect(page.getByRole('heading', { name: 'The news desk' })).toBeVisible();
    await page.getByRole('link', { name: 'Write a story' }).click();
    await page.getByLabel('Headline', { exact: true }).fill(headline);
    await page.getByLabel('Deck (the line under the headline)').fill('Our columnist asked the goats. The goats declined.');
    await page.getByLabel('Section').selectOption('local');
    await page.getByLabel('Kind of reporting').selectOption('rumor');
    await page.getByLabel('Reporter').selectOption('pinchcheek');
    await page.getByRole('textbox', { name: /^Story/ }).fill('Three goats, two hats. See [[port-vellmoor|the port]].');
    await page.getByRole('button', { name: 'Save story' }).click();
    await expect(page.getByText('Saved. Players cannot see it until you print it.')).toBeVisible();

    // Preview shows the printed form before anything is public.
    await page.getByRole('button', { name: 'Preview as printed' }).click();
    await expect(page.getByRole('heading', { level: 1, name: headline })).toBeVisible();
    await expect(page.locator('.gz-stamp', { hasText: 'Unconfirmed' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to editing' }).click();

    const player = await (await browser.newContext()).newPage();
    await enrollAsPlayer(player, 'Goat Watcher');
    const slug = new URL(page.url()).pathname.split('/').pop()!;
    await player.goto(`/news/${slug}`);
    await expect(player.getByRole('heading', { name: 'Nothing written here yet' })).toBeVisible();

    await page.getByRole('button', { name: 'Send for review' }).click();
    await expect(page.getByText('In review: players cannot see this story.')).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Approved: players cannot see this story.')).toBeVisible();
    await page.getByRole('button', { name: 'Print for players' }).click();
    await expect(page.getByText('Printed: players can read this story.')).toBeVisible();

    await player.goto(`/news/${slug}`);
    await expect(player.getByRole('heading', { level: 1, name: headline })).toBeVisible();
    await player.goto('/news');
    await expect(player.getByRole('link', { name: headline })).toBeVisible();

    await page.getByRole('button', { name: 'Back to draft' }).click();
    await expect(page.getByText('Draft: players cannot see this story.')).toBeVisible();
    await player.goto(`/news/${slug}`);
    await expect(player.getByRole('heading', { name: 'Nothing written here yet' })).toBeVisible();
    await player.close();
  });

  test('the newspaper works on a phone without sideways scrolling', async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    await enrollAsPlayer(page, 'Phone Reader');
    for (const path of ['/news', '/news/fires-on-the-coast-road', '/news/archive']) {
      await page.goto(path);
      await expect(page.locator('.gz-masthead')).toBeVisible();
      await noHorizontalOverflow(page);
    }
  });
});
