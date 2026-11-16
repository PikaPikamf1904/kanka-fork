// Keyboard and timing behaviour: the photo dialog keeps focus inside it, and the search box never
// shows answers for something the reader is no longer typing. Synthetic sample content only.
import { expect, test } from '@playwright/test';
import { signInAsDm } from './support.ts';

test.describe('Interaction', () => {
  test('the photo dialog keeps keyboard focus inside, closes on Escape and gives focus back', async ({ page }) => {
    await signInAsDm(page);
    await page.goto('/dm/edit/captain-merrin-vael');
    const open = page.getByTestId('main-picture').getByRole('button', { name: /^(Add|Change) photo$/ });
    await open.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Choose from device' })).toBeVisible();
    const inside = () => page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement)));
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      expect(await inside(), `Tab press ${i + 1}`).toBe(true);
    }
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await inside(), `Shift+Tab press ${i + 1}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test('search suggestions for an earlier, slower request never replace the current ones', async ({ page }) => {
    await signInAsDm(page);
    // The first suggestion request (for "port") answers late, after the one for "captain".
    let first = true;
    await page.route('**/rest/v1/rpc/suggest_articles*', async (route) => {
      if (first) {
        first = false;
        await new Promise((r) => setTimeout(r, 1500));
      }
      await route.continue();
    });
    const box = page.getByRole('combobox', { name: 'Search the wiki' }).first();
    await box.fill('port');
    await page.waitForTimeout(400); // the slow request is now on its way
    await box.fill('captain');
    // Suggestions only: the header's theme picker is a native select with options of its own.
    const options = page.getByRole('listbox').getByRole('option');
    await expect(options.first()).toContainText('Merrin');
    await page.waitForTimeout(2000); // the late answer has arrived by now
    const texts = await options.allTextContents();
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).toContain('Merrin');
  });
});
