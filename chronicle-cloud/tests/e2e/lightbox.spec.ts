import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { assertDisposableDatabase, readLocalEnv } from '../../scripts/local-targets.mjs';
import { enrollAsPlayer, noHorizontalOverflow, screenshot, signInAsDm } from './support.ts';

// The picture viewer on an article, with synthetic pictures drawn in the browser. The test makes
// its OWN synthetic article (so it never shares pictures with other specs), the DM adds three
// pictures a player may see (one single, two in a gallery) and one DM-only picture, and the
// article is removed afterwards.

const TITLE = 'Lightbox Probe Captain';
const tag = Date.now().toString(36);
const SLUG = `zz-lightbox-${tag}`;

async function db<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const url = readLocalEnv().DATABASE_URL!;
  await assertDisposableDatabase(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

// Sections go with the article (cascade); media rows the DM adds are left to the reseed.
const removeProbe = () => db('delete from public.articles where slug = $1', [SLUG]);

async function addProbe() {
  const [a] = await db<{ id: string }>(
    `insert into public.articles (slug, type, title, summary, visibility, status) values ($1, 'character', $2, 'A synthetic captain for the picture viewer.', 'players', 'published') returning id`,
    [SLUG, TITLE],
  );
  await db(
    `insert into public.article_sections (article_id, position, heading, body, visibility, status) values
       ($1, 1, 'Known history', 'Pictures of the harbour.', 'players', 'published'),
       ($1, 2, 'Secrets', 'Notes for the DM only.', 'dm', 'published')`,
    [a!.id],
  );
}

const docsShots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');

async function picture(page: Page, label: string, width: number, height: number, colour: string) {
  const dataUrl = await page.evaluate(({ label, width, height, colour }) => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const x = c.getContext('2d')!;
    const g = x.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, colour);
    g.addColorStop(1, '#1d2448');
    x.fillStyle = g;
    x.fillRect(0, 0, width, height);
    x.fillStyle = '#f6efdc';
    x.font = `bold ${Math.round(height / 8)}px serif`;
    x.textAlign = 'center';
    x.fillText(label, width / 2, height / 2);
    return c.toDataURL('image/png');
  }, { label, width, height, colour });
  return { name: `${label.toLowerCase().replace(/\W+/g, '-')}.png`, mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') };
}

const dialogs = (page: Page) => page.getByRole('dialog');
const viewer = (page: Page) => page.getByRole('dialog', { name: 'Picture viewer' });
const position = (page: Page) => viewer(page).getByTestId('lightbox-position');
const openers = (page: Page) => page.getByRole('button', { name: /^View picture/ });

async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= 5; i++) {
    const t = i / 5;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test.describe('Picture viewer', () => {
  test.beforeEach(async () => {
    await removeProbe();
    await addProbe();
  });
  test.afterEach(removeProbe);

  test('opens from an article picture and steps through every picture the reader can see', async ({ page, browser }) => {
    test.setTimeout(180_000);
    await signInAsDm(page);
    await page.goto(`/dm/edit/${SLUG}`);
    await expect(page.getByLabel('Title', { exact: true }).first()).toHaveValue(TITLE);

    // One captioned picture and a gallery of two in "Known history", one picture in the DM-only "Secrets".
    const history = page.getByRole('toolbar', { name: 'Known history text: pictures' });
    await history.getByRole('button', { name: /Add photo/ }).click();
    await dialogs(page).getByTestId('image-file-input').setInputFiles(await picture(page, `Harbour ${tag}`, 900, 600, '#8a3b2e'));
    await dialogs(page).getByLabel('Caption (shown under the picture)').fill(`The harbour after the fire ${tag}`);
    await dialogs(page).getByLabel('Description for screen readers').fill('Smoke over a harbour');
    await dialogs(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialogs(page)).toHaveCount(0);

    await history.getByRole('button', { name: 'Add gallery' }).click();
    await dialogs(page).getByTestId('image-file-input').setInputFiles([await picture(page, 'Ship', 800, 600, '#3b7a57'), await picture(page, 'Ledger', 600, 800, '#7a6a3b')]);
    await dialogs(page).getByLabel('Caption (shown under the picture)').nth(0).fill(`The ship ${tag}`);
    await dialogs(page).getByLabel('Caption (shown under the picture)').nth(1).fill(`The ledger ${tag}`);
    await dialogs(page).getByLabel('Description for screen readers').nth(0).fill('A ship at anchor');
    await dialogs(page).getByLabel('Description for screen readers').nth(1).fill('A closed ledger');
    await dialogs(page).getByRole('button', { name: 'Save 2 photos' }).click();
    await expect(dialogs(page)).toHaveCount(0);

    await page.getByRole('toolbar', { name: 'Secrets text: pictures' }).getByRole('button', { name: /Add photo/ }).click();
    await dialogs(page).getByTestId('image-file-input').setInputFiles(await picture(page, 'Plan', 900, 600, '#2e5c8a'));
    await dialogs(page).getByLabel('Caption (shown under the picture)').fill(`Secret plan ${tag}`);
    await dialogs(page).getByLabel('Description for screen readers').fill('A secret plan');
    await dialogs(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialogs(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.getByText('Saved.')).toBeVisible();

    // The DM sees four pictures in the viewer, including the DM-only one.
    await page.goto(`/wiki/${SLUG}`);
    await expect(openers(page)).toHaveCount(4);
    await expect(page.getByText(`Secret plan ${tag}`)).toBeVisible();
    await openers(page).first().click();
    await expect(position(page)).toHaveText(/^1 of 4$/);
    await page.keyboard.press('Escape');
    await expect(viewer(page)).toHaveCount(0);

    // ---- A player on a desktop screen: only the three pictures they may see. ----
    const desktop = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
    await enrollAsPlayer(desktop, 'Picture Viewer');
    await desktop.goto(`/wiki/${SLUG}`);
    await expect(desktop.getByText(`The ledger ${tag}`)).toBeVisible();
    await expect(openers(desktop)).toHaveCount(3);
    await expect(openers(desktop).nth(0)).toHaveAccessibleName('View picture: Smoke over a harbour');
    await expect(desktop.getByText(`Secret plan ${tag}`)).toHaveCount(0);
    await expect(viewer(desktop)).toHaveCount(0);

    // Open the middle picture (a gallery picture) by keyboard: Enter on the focused picture.
    const ship = desktop.getByRole('button', { name: 'View picture: A ship at anchor' });
    await ship.focus();
    await desktop.keyboard.press('Enter');
    await expect(viewer(desktop)).toBeVisible();
    await expect(position(desktop)).toHaveText('2 of 3');
    await expect(position(desktop)).toHaveAttribute('aria-live', 'polite');
    await expect(viewer(desktop).getByText(`The ship ${tag}`)).toBeVisible();
    await expect(viewer(desktop).getByText('A ship at anchor')).toBeVisible();
    const original = viewer(desktop).getByRole('link', { name: 'Open original' });
    await expect(original).toHaveAttribute('target', '_blank');
    await expect(original).toHaveAttribute('rel', 'noopener noreferrer');
    expect(desktop.url()).not.toContain('token');

    // Buttons, then arrow keys; the ring wraps around.
    await viewer(desktop).getByRole('button', { name: 'Next picture' }).click();
    await expect(position(desktop)).toHaveText('3 of 3');
    await expect(viewer(desktop).getByText(`The ledger ${tag}`)).toBeVisible();
    await viewer(desktop).getByRole('button', { name: 'Next picture' }).click();
    await expect(position(desktop)).toHaveText('1 of 3');
    await expect(viewer(desktop).getByText(`The harbour after the fire ${tag}`)).toBeVisible();
    await viewer(desktop).getByRole('button', { name: 'Previous picture' }).click();
    await expect(position(desktop)).toHaveText('3 of 3');
    await desktop.keyboard.press('ArrowLeft');
    await expect(position(desktop)).toHaveText('2 of 3');
    await desktop.keyboard.press('ArrowRight');
    await desktop.keyboard.press('ArrowRight');
    await expect(position(desktop)).toHaveText('1 of 3');
    // The DM-only picture never shows up while cycling.
    await expect(viewer(desktop).getByText(`Secret plan ${tag}`)).toHaveCount(0);
    await desktop.keyboard.press('ArrowLeft');
    await desktop.keyboard.press('ArrowLeft');
    await expect(viewer(desktop).getByText(`The ship ${tag}`)).toBeVisible();
    await expect.poll(() => viewer(desktop).locator('img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);

    // An expired link: make the current signed URL fail once, then force the viewer to reload the
    // picture by stepping away and back. It must ask for a fresh link and end up showing it.
    const shipImg = viewer(desktop).locator('img');
    const staleSrc = (await shipImg.getAttribute('src'))!;
    let aborted = 0;
    await desktop.route((u) => u.href === staleSrc, (route) => {
      aborted += 1;
      return route.abort();
    });
    await new Promise((r) => setTimeout(r, 1100)); // a fresh signed link differs from the old one
    await viewer(desktop).getByRole('button', { name: 'Next picture' }).click();
    await expect(position(desktop)).toHaveText('3 of 3');
    await viewer(desktop).getByRole('button', { name: 'Previous picture' }).click();
    await expect(position(desktop)).toHaveText('2 of 3');
    await expect.poll(() => shipImg.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    const freshSrc = (await shipImg.getAttribute('src'))!;
    expect(freshSrc).not.toBe(staleSrc);
    expect(aborted).toBeGreaterThan(0);
    await expect(viewer(desktop).getByRole('link', { name: 'Open original' })).toHaveAttribute('href', freshSrc);
    await desktop.unroute((u) => u.href === staleSrc).catch(() => undefined);
    await noHorizontalOverflow(desktop);
    await desktop.waitForTimeout(300);
    if (process.env.SAVE_DOC_SHOTS === '1') await desktop.screenshot({ path: path.join(docsShots, 'lightbox-desktop.png') });

    // Esc closes; focus returns to the picture that was clicked.
    await desktop.keyboard.press('Escape');
    await expect(viewer(desktop)).toHaveCount(0);
    await expect(ship).toBeFocused();

    // Clicking opens too, and the Close button closes.
    await openers(desktop).first().click();
    await expect(position(desktop)).toHaveText('1 of 3');
    await viewer(desktop).getByRole('button', { name: 'Close' }).click();
    await expect(viewer(desktop)).toHaveCount(0);
    await expect(openers(desktop).first()).toBeFocused();

    // ---- A player on a phone: no sideways scrolling; swipe and Next both work. ----
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
    await enrollAsPlayer(phone, 'Phone Viewer');
    await phone.goto(`/wiki/${SLUG}`);
    await expect(openers(phone)).toHaveCount(3);
    await openers(phone).first().scrollIntoViewIfNeeded();
    await openers(phone).first().tap();
    await expect(position(phone)).toHaveText('1 of 3');
    expect(await phone.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    const box = (await viewer(phone).locator('img').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    for (const name of ['Previous picture', 'Next picture', 'Close']) {
      const b = (await viewer(phone).getByRole('button', { name }).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await swipe(phone, { x: cx + 80, y: cy }, { x: cx - 80, y: cy }); // leftward = next
    await expect(position(phone)).toHaveText('2 of 3');
    await swipe(phone, { x: cx - 80, y: cy }, { x: cx + 80, y: cy }); // rightward = previous
    await expect(position(phone)).toHaveText('1 of 3');
    await swipe(phone, { x: cx, y: cy - 60 }, { x: cx + 20, y: cy + 60 }); // mostly vertical: ignored
    await expect(position(phone)).toHaveText('1 of 3');
    await viewer(phone).getByRole('button', { name: 'Next picture' }).tap();
    await expect(position(phone)).toHaveText('2 of 3');
    await expect.poll(() => viewer(phone).locator('img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    expect(await phone.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await phone.waitForTimeout(300);
    if (process.env.SAVE_DOC_SHOTS === '1') await phone.screenshot({ path: path.join(docsShots, 'lightbox-phone.png') });
    await screenshot(phone, 'lightbox-phone');
    await phone.keyboard.press('Escape');
    await expect(viewer(phone)).toHaveCount(0);
    await noHorizontalOverflow(phone);
  });
});
