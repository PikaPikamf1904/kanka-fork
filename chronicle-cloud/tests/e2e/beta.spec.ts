import { devices, expect, test } from '@playwright/test';
import { enrollAsPlayer, noHorizontalOverflow, screenshot, signInAsDm } from './support.ts';

// Beta features: quick jump, link previews, since-your-last-visit, connections web, table screen.
// Synthetic sample world only.

test.describe('Beta features', () => {
  test('quick jump finds pages and tools; players never see DM pages or tools', async ({ page, browser }) => {
    await signInAsDm(page);
    await page.goto('/');
    await expect(page.locator('main#main')).toBeVisible();
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox', { name: 'Jump to a page or tool' });
    await expect(box).toBeFocused();
    await box.fill('merin vael');
    await expect(page.getByRole('option').first()).toContainText('Captain Merrin Vael');
    await screenshot(page, 'beta-quick-jump');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/wiki\/captain-merrin-vael$/);
    await page.keyboard.press('/');
    await page.getByRole('combobox', { name: 'Jump to a page or tool' }).fill('table');
    await expect(page.getByRole('option', { name: /Table screen/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Quick jump' })).toHaveCount(0);

    const player = await (await browser.newContext()).newPage();
    await enrollAsPlayer(player, 'Jumper');
    await player.getByRole('button', { name: 'Quick jump to a page' }).click();
    const pbox = player.getByRole('combobox', { name: 'Jump to a page or tool' });
    await pbox.fill('masked broker');
    await expect(player.getByText(/\d+ pages/)).toBeVisible();
    await expect(player.getByRole('option', { name: /Masked Broker/ })).toHaveCount(0);
    await pbox.fill('table screen');
    await expect(player.getByRole('option', { name: /Table screen/ })).toHaveCount(0);
    await pbox.fill('vellmoor');
    await expect(player.getByRole('option', { name: /Port Vellmoor/ })).toBeVisible();
  });

  test('link previews show a page card on hover and keyboard focus', async ({ page }) => {
    await enrollAsPlayer(page, 'Hover Reader');
    await page.goto('/wiki/captain-merrin-vael');
    const link = page.getByRole('main').getByRole('link', { name: 'Silver Quill Society' }).first();
    await link.hover();
    const card = page.getByRole('tooltip');
    await expect(card).toContainText('Silver Quill Society');
    await expect(card).toContainText('Faction');
    await expect(card).toContainText('Scholars, archivists and spies');
    await screenshot(page, 'beta-link-preview');
    await page.mouse.move(5, 5);
    await expect(card).toHaveCount(0);
    await link.focus();
    await expect(page.getByRole('tooltip')).toContainText('Silver Quill Society');
  });

  test('since your last visit lists changed pages, and mark-all-as-seen clears it', async ({ page }) => {
    await enrollAsPlayer(page, 'Returning Reader');
    await page.goto('/');
    const panel = page.getByRole('region', { name: /Since your last visit/ });
    await expect(panel).toContainText('Welcome!');
    // Pretend the last visit was a week ago, then start a new browser session.
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (k.startsWith('chronicle.beta.last-visit.')) localStorage.setItem(k, JSON.stringify(new Date(Date.now() - 7 * 864e5).toISOString()));
      sessionStorage.clear();
    });
    await page.reload();
    await expect(panel.getByRole('listitem').first()).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Port Vellmoor' })).toBeVisible();
    await expect(panel).not.toContainText('Masked Broker');
    await screenshot(page, 'beta-whats-new');
    await panel.getByRole('button', { name: 'Mark all as seen' }).click();
    await expect(panel).toContainText('Nothing new since then.');
  });

  test('connections web draws the readable connections and explains one page', async ({ page, browser }) => {
    await signInAsDm(page);
    await page.goto('/connections');
    await page.getByRole('button', { name: /^Web/ }).click();
    const web = page.getByTestId('connections-web');
    await expect(web).toBeVisible();
    await web.getByRole('button', { name: /^Captain Merrin Vael,/ }).click();
    const panel = page.getByRole('complementary', { name: 'Connections of Captain Merrin Vael' });
    await expect(panel.getByRole('link', { name: 'Captain Merrin Vael' })).toBeVisible();
    await expect(panel.getByRole('listitem').first()).toBeVisible();
    await screenshot(page, 'beta-connections-web');

    const player = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
    await enrollAsPlayer(player, 'Web Reader');
    await player.goto('/connections');
    await player.getByRole('button', { name: /^Web/ }).click();
    const pweb = player.getByTestId('connections-web');
    await expect(pweb.getByRole('button', { name: /^Captain Merrin Vael,/ })).toBeVisible();
    await expect(pweb.getByRole('button', { name: /Masked Broker/ })).toHaveCount(0);
    await noHorizontalOverflow(player);
  });

  test('table screen: initiative, hit points, dice, pins and notes stay on this device', async ({ browser }) => {
    for (const [label, opts] of [['desktop', { viewport: { width: 1366, height: 900 } }], ['phone', { ...devices['Pixel 7'] }]] as const) {
      const context = await browser.newContext(opts);
      const page = await context.newPage();
      await signInAsDm(page);
      await page.goto('/dm/table');
      await expect(page.getByRole('heading', { name: /Table screen/ })).toBeVisible();

      const init = page.getByRole('region', { name: 'Initiative' });
      for (const [name, value, hp] of [['Kaela', '15', ''], ['Goblin boss', '18', '21'], ['Doran', '9', '']] as const) {
        await init.getByLabel('Name', { exact: true }).fill(name);
        await init.getByLabel('Initiative', { exact: true }).fill(value);
        await init.getByLabel('Hit points', { exact: true }).fill(hp);
        await init.getByRole('button', { name: 'Add' }).click();
      }
      await expect(init.getByRole('listitem').first()).toContainText('Goblin boss');
      await expect(init.getByText('Round 1 · Goblin boss’s turn')).toBeVisible();
      await init.getByLabel('Amount for Goblin boss').fill('8');
      await init.getByRole('button', { name: 'Damage Goblin boss' }).click();
      await expect(init.getByLabel('Goblin boss hit points')).toHaveText('13/21');
      for (let i = 0; i < 3; i++) await init.getByRole('button', { name: 'Next turn' }).click();
      await expect(init.getByText('Round 2 · Goblin boss’s turn')).toBeVisible();

      const dice = page.getByRole('region', { name: 'Dice' });
      await dice.getByRole('button', { name: 'Advantage', exact: true }).click();
      const total = Number(await dice.locator('.dice-total').textContent());
      expect(total).toBeGreaterThanOrEqual(1);
      expect(total).toBeLessThanOrEqual(20);
      await expect(dice.locator('.dice-detail')).toContainText('2d20kh1');
      await dice.getByLabel('Dice expression').fill('4d6kh3');
      await dice.getByRole('button', { name: 'Roll', exact: true }).click();
      await expect(dice.locator('.dice-detail')).toContainText('4d6kh3');
      await dice.getByLabel('Dice expression').fill('banana');
      await dice.getByRole('button', { name: 'Roll', exact: true }).click();
      await expect(dice.getByRole('alert')).toContainText('Could not read');

      const pins = page.getByRole('region', { name: 'Pinned pages' });
      await pins.getByLabel('Find a page to pin').fill('masked');
      await pins.getByRole('button', { name: /Pin The Masked Broker/ }).click();
      await expect(pins.getByRole('link', { name: 'The Masked Broker' })).toBeVisible();

      await page.getByRole('textbox', { name: 'Table notes' }).fill('Synthetic note: the innkeeper is called Bram.');
      await noHorizontalOverflow(page);
      await page.getByRole('textbox', { name: 'Table notes' }).blur();
      await page.evaluate(() => window.scrollTo(0, 0));
      await screenshot(page, `beta-table-${label}`);

      // Everything is still there after a reload (this device only).
      await page.reload();
      await expect(page.getByRole('region', { name: 'Initiative' }).getByText('Round 2 · Goblin boss’s turn')).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Table notes' })).toHaveValue('Synthetic note: the innkeeper is called Bram.');
      await expect(page.getByRole('region', { name: 'Pinned pages' }).getByRole('link', { name: 'The Masked Broker' })).toBeVisible();
      await context.close();
    }
  });

  test('a player cannot open the table screen', async ({ page }) => {
    await enrollAsPlayer(page, 'Curious Player');
    await page.goto('/dm/table');
    await expect(page.getByRole('heading', { name: /Table screen/ })).toHaveCount(0);
  });
});
