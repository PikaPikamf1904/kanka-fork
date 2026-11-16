import { expect, test } from '@playwright/test';
import { enrollAsPlayer, signInAsDm } from './support.ts';

// Header and menu: search one tap away on phones, the phone menu behaves like a dialog (focus in,
// Escape out, page behind inert), a named theme choice, a sticky desktop menu, 44px touch targets
// and no hover movement when reduced motion is asked for.

test.describe('Navigation and accessibility', () => {
  test('phone: search button, menu focus and Escape, page behind is inert', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    await enrollAsPlayer(page, 'Nav Probe');

    await page.getByRole('button', { name: 'Open search' }).click();
    const search = page.locator('#site-nav').getByRole('combobox').or(page.locator('#site-nav input')).first();
    await expect(search).toBeFocused();
    await expect(page.locator('main#main')).toHaveAttribute('inert', '');
    await page.keyboard.press('Escape');
    await expect(page.locator('#site-nav')).not.toHaveClass(/open/);
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused();
    await expect(page.locator('main#main')).not.toHaveAttribute('inert', '');

    // Opening with the menu button also moves focus into the menu.
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('#site-nav'))).toBe(true);
    // Following a link closes the menu and leaves focus with the new page, not the menu button.
    await page.locator('#site-nav').getByRole('link', { name: 'A–Z index' }).click();
    await expect(page).toHaveURL(/\/a-z/);
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).not.toBeFocused();

    // Touch targets in the menu are at least 44px high.
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    for (const el of await page.locator('#site-nav a, #site-nav button').all()) {
      const box = await el.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(43.5);
    }
  });

  test('desktop: a named theme choice and a menu that stays in view', async ({ page }) => {
    await signInAsDm(page);
    const theme = page.getByLabel('Colour theme');
    await theme.selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(theme).toHaveValue('dark');
    await page.reload();
    await expect(page.getByLabel('Colour theme')).toHaveValue('dark');
    await page.getByLabel('Colour theme').selectOption('auto');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);

    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto('/wiki/port-vellmoor');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const nav = await page.locator('#site-nav').boundingBox();
    expect(nav!.y).toBeLessThan(120);
    await expect(page.locator('#site-nav').getByRole('link', { name: 'Main page' })).toBeInViewport();
  });

  test('reading comfort: larger text and a plain font, remembered', async ({ page }) => {
    await signInAsDm(page);
    await page.goto('/wiki/port-vellmoor');
    const para = page.locator('.article-body .prose p').first();
    const before = await para.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await page.getByLabel('Reading comfort').selectOption('plain');
    await expect(page.locator('html')).toHaveAttribute('data-reading', 'plain');
    await expect.poll(() => para.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(before);
    expect(await para.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Verdana');
    await page.reload();
    await expect(page.getByLabel('Reading comfort')).toHaveValue('plain');
    await page.getByLabel('Reading comfort').selectOption('standard');
    await expect(page.locator('html')).not.toHaveAttribute('data-reading', /.+/);
  });

  test('reduced motion: cards do not move on hover', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await signInAsDm(page);
    await page.goto('/browse/location');
    const card = page.locator('.card').first();
    await card.hover();
    expect(await card.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  });
});
