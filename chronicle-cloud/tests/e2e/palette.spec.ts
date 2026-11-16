import path from 'node:path';
import { expect, test } from '@playwright/test';
import { enrollAsPlayer, noHorizontalOverflow, signInAsDm } from './support.ts';

// Command palette: keyboard shortcut, page search, commands, DM-only commands hidden from players,
// Escape returns focus, and a visible "Jump to…" button for people who do not use shortcuts.

const docsShots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');

test.describe('Command palette', () => {
  test('the DM jumps to pages and DM tools by keyboard', async ({ page }) => {
    await signInAsDm(page);
    const opener = page.locator('main#main');
    await opener.focus();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Jump to' });
    const box = dialog.getByRole('combobox', { name: 'Jump to a page or part of the site' });
    await expect(box).toBeFocused();

    await box.fill('what players');
    await expect(dialog.getByRole('option', { name: /What players can see/ })).toBeVisible();
    if (process.env.SAVE_DOC_SHOTS === '1') await page.screenshot({ path: path.join(docsShots, 'command-palette.png') });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dm\/visibility$/);
    await expect(dialog).toHaveCount(0);

    // Pages come from the search suggestions; arrows choose, Enter opens.
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Jump to a page or part of the site' }).fill('port vell');
    await expect(page.getByRole('dialog', { name: 'Jump to' }).getByRole('option').first()).toContainText('Port Vellmoor');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/wiki\/port-vellmoor/);

    // "/" opens it too, Escape closes it and gives focus back.
    await page.locator('main#main').focus();
    await page.keyboard.press('/');
    await expect(page.getByRole('dialog', { name: 'Jump to' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Jump to' })).toHaveCount(0);
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('players never see DM commands; the menu button opens it on phones', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    await enrollAsPlayer(page, 'Palette Probe');
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: /Jump to/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Jump to' });
    await expect(dialog.getByRole('option', { name: /Knowledge graph/ })).toBeVisible();
    await expect(dialog.getByRole('option', { name: /DM desk|What players can see|Tidy up/ })).toHaveCount(0);
    await dialog.getByRole('combobox').fill('tidy');
    await expect(dialog.getByRole('option', { name: /Tidy up/ })).toHaveCount(0);
    await noHorizontalOverflow(page);
  });
});
