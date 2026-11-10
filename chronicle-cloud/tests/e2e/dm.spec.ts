import { expect, test, type Page } from '@playwright/test';
import { enrollAsPlayer, screenshot, signInAsDm } from './support.ts';

const unique = `Test Lighthouse ${Date.now().toString(36)}`;
const slug = unique.toLowerCase().replace(/[^a-z0-9]+/g, '-');

async function save(page: Page) {
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText('Saved.')).toBeVisible();
}

test.describe('DM', () => {
  test('sees DM-only material, marked as such', async ({ page }) => {
    await signInAsDm(page);
    await page.goto('/wiki/captain-merrin-vael');
    await expect(page.getByRole('heading', { name: /Secrets/ })).toBeVisible();
    await expect(page.locator('.article-section.dm-only').first()).toBeVisible();
    await expect(page.getByRole('complementary', { name: /at a glance/ })).toContainText('True identity');
    await screenshot(page, '04-article-dm');
    await page.goto('/dm');
    await expect(page.getByRole('heading', { name: 'Drafts and DM-only pages' })).toBeVisible();
    await expect(page.getByText('The Masked Broker')).toBeVisible();
  });

  test('draft, publish and unpublish control exactly what players see', async ({ browser }) => {
    const dmContext = await browser.newContext();
    const dm = await dmContext.newPage();
    await signInAsDm(dm);
    await dm.goto('/dm/new?type=location');
    await dm.getByLabel('Title', { exact: true }).fill(unique);
    await dm.getByLabel('Summary (shown to players at the top of the page and on cards)').fill('A synthetic test lighthouse.');
    const sections = dm.locator('.section-editor');
    await sections.nth(0).getByRole('textbox', { name: /text/ }).fill('PLAYERTEXT visible lore about the lighthouse.');
    await sections.nth(1).getByRole('textbox', { name: /text/ }).fill('More public history.');
    // The template's last section is DM-only.
    const dmSection = sections.last();
    await expect(dmSection.getByRole('combobox', { name: /visibility/ })).toHaveValue('dm');
    await dmSection.getByRole('textbox', { name: /text/ }).fill('DMTEXT the keeper is a spy.');
    await save(dm);
    await expect(dm).toHaveURL(new RegExp(`/dm/edit/${slug}$`));
    await screenshot(dm, '09-editor-dm');

    const playerContext = await browser.newContext();
    const player = await playerContext.newPage();
    await enrollAsPlayer(player, 'Draft Checker');
    await player.goto(`/wiki/${slug}`);
    await expect(player.getByRole('heading', { name: 'Nothing written here yet' })).toBeVisible();

    // Publish the article and its player sections, keeping the DM section DM-only.
    await dm.getByRole('combobox', { name: 'Article status' }).selectOption('published');
    for (let i = 0; i < (await sections.count()); i++) {
      await sections.nth(i).getByRole('combobox', { name: /status/ }).selectOption('published');
    }
    await save(dm);

    await player.goto(`/wiki/${slug}`);
    await expect(player.getByRole('heading', { name: unique, level: 1 })).toBeVisible();
    await expect(player.getByText('PLAYERTEXT visible lore')).toBeVisible();
    await expect(player.getByText('DMTEXT')).toHaveCount(0);

    // The DM's "view as a player" shows the same thing.
    await dm.goto(`/wiki/${slug}`);
    await expect(dm.getByText('DMTEXT the keeper is a spy.')).toBeVisible();
    await dm.getByRole('button', { name: 'View as a player' }).click();
    await expect(dm.getByRole('status')).toContainText('Viewing as a player');
    await expect(dm.getByText('PLAYERTEXT visible lore')).toBeVisible();
    await expect(dm.getByText('DMTEXT')).toHaveCount(0);
    await dm.getByRole('button', { name: 'Back to DM view' }).click();

    // History has the earlier version; unpublishing hides the page again.
    await dm.goto(`/dm/edit/${slug}`);
    await expect(dm.locator('.revision-list li').first()).toBeVisible();
    dm.once('dialog', (d) => void d.accept());
    await dm.getByRole('combobox', { name: 'Article status' }).selectOption('draft');
    await dm.getByRole('button', { name: 'Save' }).first().click();
    await expect(dm.getByText('Saved.')).toBeVisible();
    await player.goto(`/wiki/${slug}`);
    await expect(player.getByRole('heading', { name: 'Nothing written here yet' })).toBeVisible();

    await dmContext.close();
    await playerContext.close();
  });

  test('a DM-only marker is visible to the DM and not to players', async ({ browser }) => {
    const dmContext = await browser.newContext();
    const dm = await dmContext.newPage();
    await signInAsDm(dm);
    await dm.goto('/maps/ember-coast');
    await expect(dm.locator('.map-pin')).toHaveCount(6);
    await expect(dm.locator('.map-pin-dm')).toHaveCount(2);
    await screenshot(dm, '10-map-dm');
    const playerContext = await browser.newContext();
    const player = await playerContext.newPage();
    await enrollAsPlayer(player, 'Map Checker');
    await player.goto('/maps/ember-coast');
    await expect(player.locator('.map-pin')).toHaveCount(3);
    await dmContext.close();
    await playerContext.close();
  });

  test('removing a player device locks it out immediately', async ({ browser }) => {
    const playerContext = await browser.newContext();
    const player = await playerContext.newPage();
    const name = `Revoke Me ${Date.now().toString(36)}`;
    await enrollAsPlayer(player, name);
    await player.goto('/wiki/port-vellmoor');
    await expect(player.getByRole('heading', { name: 'Port Vellmoor', level: 1 })).toBeVisible();

    const dmContext = await browser.newContext();
    const dm = await dmContext.newPage();
    await signInAsDm(dm);
    await dm.goto('/dm/access');
    await screenshot(dm, '11-access-admin');
    const row = dm.getByRole('row', { name: new RegExp(name) });
    dm.once('dialog', (d) => void d.accept());
    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(dm.getByRole('row', { name: new RegExp(name) })).toContainText('Removed');

    await player.reload();
    await expect(player.getByText('This device no longer has access')).toBeVisible();
    await dmContext.close();
    await playerContext.close();
  });

  test('a player cannot use DM pages even by URL', async ({ page }) => {
    await enrollAsPlayer(page);
    for (const path of ['/dm', '/dm/new', '/dm/access', '/dm/notes', `/dm/edit/port-vellmoor`]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Nothing written here yet' })).toBeVisible();
    }
  });
});
