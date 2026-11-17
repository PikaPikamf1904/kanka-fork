// Saved pages, reading lists, the scratchpad and recently viewed, with synthetic pages made and removed here.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow } from './support.ts';

const SLUGS = ['zz-saved-alpha', 'zz-saved-bravo', 'zz-saved-charlie'];
const TITLES = ['Zzsaved Alpha', 'Zzsaved Bravo', 'Zzsaved Charlie'];

async function makePages() {
  await db('delete from public.articles where slug = any($1)', [SLUGS]);
  for (const [i, slug] of SLUGS.entries()) {
    await db(`insert into public.articles (slug, type, title, summary, visibility, status, published_at) values ($1, 'location', $2, 'Synthetic.', 'players', 'published', now())`, [slug, TITLES[i]]);
  }
}
const itemTitles = (page: Page, section: string) =>
  page.getByRole('region', { name: new RegExp(`^${section}`) }).getByTestId('saved-item').locator('.saved-main a').allTextContents();

async function savePageAt(page: Page, slug: string) {
  await page.goto(`/wiki/${slug}`);
  const save = page.getByRole('button', { name: 'Save this page' });
  await expect(save).toHaveAttribute('aria-pressed', 'false');
  await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'true');
}

test.describe('saved pages', () => {
  test.beforeEach(makePages);
  test.afterEach(() => db('delete from public.articles where slug = any($1)', [SLUGS]));

  test('save, make a list, rename, reorder with buttons, move, remove and delete the list', async ({ page }) => {
    await enrollAsPlayer(page, 'Saver One');
    await page.goto('/saved');
    await expect(page.getByText('Nothing saved yet.')).toBeVisible();
    for (const s of SLUGS) await savePageAt(page, s);

    // The page's own toggle can be switched off and on again.
    await page.getByRole('button', { name: 'Save this page' }).click();
    await expect(page.getByRole('button', { name: 'Save this page' })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: 'Save this page' }).click();
    await expect(page.getByRole('button', { name: 'Save this page' })).toHaveAttribute('aria-pressed', 'true');

    await page.goto('/saved');
    await expect.poll(() => itemTitles(page, 'Saved')).toEqual(TITLES);

    await page.getByLabel('New reading list').fill('Suspects');
    await page.getByRole('button', { name: 'Create list' }).click();
    await expect(page.getByRole('heading', { name: /^Suspects/ })).toBeVisible();
    await page.getByRole('button', { name: 'Rename the list Suspects' }).click();
    await page.getByLabel('List name').fill('Prime suspects');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByRole('heading', { name: /^Prime suspects/ })).toBeVisible();

    // Keyboard-friendly reordering.
    await page.getByRole('button', { name: 'Move Zzsaved Charlie up' }).click();
    await expect.poll(() => itemTitles(page, 'Saved')).toEqual([TITLES[0], TITLES[2], TITLES[1]]);
    await page.getByRole('button', { name: 'Move Zzsaved Alpha down' }).click();
    await expect.poll(() => itemTitles(page, 'Saved')).toEqual([TITLES[2], TITLES[0], TITLES[1]]);
    await expect(page.getByRole('button', { name: 'Move Zzsaved Charlie up' })).toBeDisabled();
    await page.reload();
    await expect.poll(() => itemTitles(page, 'Saved')).toEqual([TITLES[2], TITLES[0], TITLES[1]]);

    // Move between lists.
    await page.getByLabel('Move Zzsaved Alpha to another list').selectOption({ label: 'Prime suspects' });
    await expect.poll(() => itemTitles(page, 'Prime suspects')).toEqual([TITLES[0]]);
    await expect.poll(() => itemTitles(page, 'Saved')).toEqual([TITLES[2], TITLES[1]]);

    // The page menu shows the list as ticked.
    await page.goto(`/wiki/${SLUGS[0]}`);
    await page.getByText('Add to a list').click();
    await expect(page.getByRole('checkbox', { name: 'Prime suspects' })).toBeChecked();

    // Remove one, then delete the list (confirm).
    await page.goto('/saved');
    await page.getByRole('button', { name: /^Remove Zzsaved Bravo/ }).click();
    await expect.poll(() => itemTitles(page, 'Saved')).toEqual([TITLES[2]]);
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Delete the list Prime suspects' }).click();
    await expect(page.getByRole('heading', { name: /^Prime suspects/ })).toHaveCount(0);
    await noHorizontalOverflow(page);
    // The page itself is untouched.
    expect((await db('select 1 from public.articles where slug = $1', [SLUGS[0]])).length).toBe(1);
  });

  test('a page hidden later disappears from Saved without a trace', async ({ page }) => {
    await enrollAsPlayer(page, 'Saver Two');
    await savePageAt(page, SLUGS[0]!);
    await savePageAt(page, SLUGS[1]!);
    await page.goto('/saved');
    await expect.poll(() => itemTitles(page, 'Saved')).toEqual([TITLES[0], TITLES[1]]);
    await db(`update public.articles set visibility = 'dm' where slug = $1`, [SLUGS[0]]);
    await page.reload();
    await expect.poll(() => itemTitles(page, 'Saved')).toEqual([TITLES[1]]);
    await expect(page.getByText('Zzsaved Alpha')).toHaveCount(0);
    // It is also gone from "Recently viewed", although this device had seen it.
    await expect(page.getByRole('region', { name: 'Recently viewed' }).getByText('Zzsaved Alpha')).toHaveCount(0);
  });

  test('recently viewed is kept per person on this device and can be cleared', async ({ page }) => {
    await enrollAsPlayer(page, 'Saver Three');
    await page.goto(`/wiki/${SLUGS[0]}`);
    await expect(page.getByRole('heading', { name: TITLES[0]!, level: 1 })).toBeVisible();
    await page.goto(`/wiki/${SLUGS[1]}`);
    await expect(page.getByRole('heading', { name: TITLES[1]!, level: 1 })).toBeVisible();
    await page.goto('/saved');
    const recent = page.getByRole('region', { name: 'Recently viewed' });
    await expect(recent.locator('li a')).toHaveText([TITLES[1]!, TITLES[0]!]);
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('chronicle-recent-views')));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^chronicle-recent-views:[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: 'Clear recently viewed' }).click();
    await expect(recent.getByText('Pages you open on this device will show up here.')).toBeVisible();
    await page.reload();
    await expect(recent.getByText('Pages you open on this device will show up here.')).toBeVisible();
  });

  test('the scratchpad autosaves, and a second device that is out of date gets the conflict message', async ({ page, browser }) => {
    await enrollAsPlayer(page, 'Saver Four');
    await page.goto(`/wiki/${SLUGS[0]}`);
    await page.locator('details.scratchpad > summary').click();
    const note = page.getByLabel('My note');
    await expect(page.getByText('Only you can see this note.')).toBeVisible();
    await note.fill('First thought about the alpha page.');
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible({ timeout: 8000 }); // autosave after 2 seconds
    await page.reload();
    await page.locator('details.scratchpad > summary').click();
    await expect(note).toHaveValue('First thought about the alpha page.');

    // The same account on a second device.
    const second = await browser.newContext({ storageState: await page.context().storageState() });
    const other = await second.newPage();
    await other.goto(`/wiki/${SLUGS[0]}`);
    await other.locator('details.scratchpad > summary').click();
    await expect(other.getByLabel('My note')).toHaveValue('First thought about the alpha page.');

    await note.fill('Changed on the first device.');
    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

    await other.getByLabel('My note').fill('Changed on the second device.');
    await other.getByRole('button', { name: 'Save note' }).click();
    await expect(other.getByRole('alert').filter({ hasText: 'This note was changed on another device. Copy your text, reload, and try again.' })).toBeVisible();
    await expect(other.getByLabel('My note')).toHaveValue('Changed on the second device.'); // kept so it can be copied
    const stored = await db<{ body: string }>('select body from public.scratchpad_notes n join public.articles a on a.id = n.article_id where a.slug = $1', [SLUGS[0]]);
    expect(stored.map((r) => r.body)).toEqual(['Changed on the first device.']);
    await second.close();
  });

  test('the general scratchpad saves too', async ({ page }) => {
    await enrollAsPlayer(page, 'Saver Five');
    await page.goto('/scratchpad');
    await page.getByLabel('My note').fill('Remember to ask about the lighthouse.');
    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('My note')).toHaveValue('Remember to ask about the lighthouse.');
    await db('delete from public.scratchpad_notes where article_id is null');
  });

  test('phone layout: no sideways scrolling and large touch targets', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await enrollAsPlayer(page, 'Saver Six');
    await savePageAt(page, SLUGS[0]!);
    await noHorizontalOverflow(page);
    await page.goto('/saved');
    await page.getByLabel('New reading list').fill('Phone list');
    await page.getByRole('button', { name: 'Create list' }).click();
    await expect(page.getByRole('heading', { name: /^Phone list/ })).toBeVisible();
    await noHorizontalOverflow(page);
    for (const control of await page.locator('main button:visible, main select:visible, main a.button:visible').all()) {
      const box = await control.boundingBox();
      expect(box!.height, await control.innerText().catch(() => '')).toBeGreaterThanOrEqual(43.5);
    }
    await page.goto(`/wiki/${SLUGS[0]}`);
    await page.locator('details.scratchpad > summary').click();
    await noHorizontalOverflow(page);
    await context.close();
  });
});
