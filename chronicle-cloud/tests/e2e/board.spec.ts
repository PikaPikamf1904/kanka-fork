// The party's Investigation Board with synthetic pages made and removed here.
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, recordApi, signInAsDm } from './support.ts';

const HARBOUR = 'zz-board-harbour';
const SECRET = 'zz-board-secret';
const shotDir = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');
const shot = async (page: Page, name: string) => {
  if (process.env.SAVE_DOC_SHOTS !== '1') return;
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(shotDir, name) });
};

async function clean() {
  await db('delete from public.board_items');
  await db('delete from public.board_groups');
  await db('delete from public.board_activity');
  await db('delete from public.articles where slug = any($1)', [[HARBOUR, SECRET]]);
}
test.beforeEach(async () => {
  await clean();
  await db(`insert into public.articles (slug, type, title, summary, visibility, status, published_at) values
    ($1, 'location', 'Zzboard Harbour', 'A synthetic harbour.', 'players', 'published', now()),
    ($2, 'character', 'Zzboard Secret', 'Hidden.', 'dm', 'published', now())`, [HARBOUR, SECRET]);
});
test.afterEach(clean);

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Board tools' });
const card = (page: Page, text: string) => page.getByTestId('board-card').filter({ hasText: text });

async function addNote(page: Page, title: string) {
  await toolbar(page).getByRole('button', { name: 'Add a note' }).click();
  await page.getByLabel('Note title').fill(title);
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(card(page, title)).toBeVisible();
}
async function addTheory(page: Page, title: string) {
  await toolbar(page).getByRole('button', { name: 'Add a theory' }).click();
  await page.getByLabel('Theory', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Add theory' }).click();
  await expect(card(page, title)).toBeVisible();
}

/** Every card lies fully inside the board area (nothing clipped at an edge). */
async function expectAllCardsInside(page: Page) {
  const area = (await page.locator('.board-surface').boundingBox())!;
  const cards = await page.getByTestId('board-card').all();
  expect(cards.length).toBeGreaterThan(0);
  for (const c of cards) {
    const b = (await c.boundingBox())!;
    expect(b.x, 'left').toBeGreaterThanOrEqual(area.x - 0.5);
    expect(b.y, 'top').toBeGreaterThanOrEqual(area.y - 0.5);
    expect(b.x + b.width, 'right').toBeLessThanOrEqual(area.x + area.width + 0.5);
    expect(b.y + b.height, 'bottom').toBeLessThanOrEqual(area.y + area.height + 0.5);
  }
}

test.describe('investigation board', () => {
  test('pin, note, theory, connect, move, status, activity; second player and DM', async ({ page, browser }: { page: Page; browser: Browser }) => {
    const api = recordApi(page.context());
    await enrollAsPlayer(page, 'Board One');
    await page.goto('/board');
    await expect(page.getByRole('heading', { name: 'Start the board' })).toBeVisible();
    await expect(page.getByText('Theories are the party’s guesses, not facts of the story.')).toBeVisible();

    await toolbar(page).getByRole('button', { name: 'Pin a page' }).click();
    await page.getByLabel('Find a page to pin').fill('Zzboard');
    await expect(page.getByRole('button', { name: 'Pin Zzboard Secret' })).toHaveCount(0); // a hidden page cannot even be found
    await page.getByRole('button', { name: 'Pin Zzboard Harbour' }).click();
    await expect(card(page, 'Zzboard Harbour')).toBeVisible();

    await addNote(page, 'Zz Note one');
    await addTheory(page, 'Zz The harbourmaster did it');
    await expect(page.getByText('A theory is the party’s guess.').first()).toBeVisible();

    // Connect the theory (selected after adding) to the note, with a label.
    await page.getByRole('button', { name: 'Connect to…' }).click();
    await page.getByLabel('Connect to', { exact: true }).selectOption({ label: 'Zz Note one' });
    await page.getByLabel('What links them? (optional)').fill('saw it first');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByTestId('board-link')).toHaveCount(1);
    await expect(page.getByTestId('board-link')).toContainText('saw it first');
    await expect(page.getByText('Connected to Zz Note one')).toBeVisible();

    // Move a card with the mouse; the move is stored.
    const note = card(page, 'Zz Note one');
    const before = (await db<{ x: number }>(`select x from public.board_items where title = 'Zz Note one'`))[0]!.x;
    const box = (await note.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 50, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await db<{ x: number }>(`select x from public.board_items where title = 'Zz Note one'`))[0]!.x).not.toBe(before);
    const moved = (await db<{ x: number }>(`select x from public.board_items where title = 'Zz Note one'`))[0]!.x;
    expect(Math.abs(moved - before)).toBeGreaterThan(20);
    await page.reload();
    await expect(card(page, 'Zz Note one')).toBeVisible();
    await expectAllCardsInside(page);
    expect((await db<{ x: number }>(`select x from public.board_items where title = 'Zz Note one'`))[0]!.x).toBe(moved);

    // Keyboard move: arrow keys shift a focused card by 20 board pixels.
    await card(page, 'Zz Note one').focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await db<{ x: number }>(`select x from public.board_items where title = 'Zz Note one'`))[0]!.x, { timeout: 6000 }).toBe(moved + 60);

    // Theory status, by any member.
    await card(page, 'Zz The harbourmaster did it').click();
    await page.getByLabel('Theory status').selectOption('solved');
    await expect.poll(async () => (await db<{ s: string }>(`select theory_status as s from public.board_items where kind = 'theory'`))[0]!.s).toBe('solved');

    // Activity.
    const activity = page.getByRole('region', { name: 'Recent activity' });
    await expect(activity).toContainText('Board One added a theory: Zz The harbourmaster did it');
    await expect(activity).toContainText('Board One added a pinned page');
    await expect(activity).not.toContainText('Zzboard Harbour');
    await shot(page, 'board-desktop.png');

    // A second player sees the board and cannot edit the first player's text.
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await enrollAsPlayer(p2, 'Board Two');
    await p2.goto('/board');
    await card(p2, 'Zz The harbourmaster did it').click();
    await expect(p2.getByLabel('Theory status')).toHaveValue('solved');
    await expect(p2.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(p2.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await p2.getByLabel('Theory status').selectOption('disproven');
    await expect.poll(async () => (await db<{ s: string }>(`select theory_status as s from public.board_items where kind = 'theory'`))[0]!.s).toBe('disproven');
    await ctx2.close();

    // The DM reads the theories, with author and status.
    const dmCtx = await browser.newContext();
    const dm = await dmCtx.newPage();
    await signInAsDm(dm);
    await dm.goto('/dm/theories');
    const row = dm.getByTestId('theory-row');
    await expect(row).toContainText('Zz The harbourmaster did it');
    await expect(row).toContainText('Board One');
    await expect(row).toContainText('Disproven');
    await expect(row).toContainText('Connected to Zz Note one (saw it first)');
    await dmCtx.close();

    // A pinned page that is hidden later is "no longer available", and its title never arrives again.
    await db(`update public.articles set visibility = 'dm' where slug = $1`, [HARBOUR]);
    const mark = api.length;
    await page.reload();
    await expect(page.getByTestId('board-card').filter({ hasText: 'This evidence is no longer available' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(api.slice(mark).map((r) => r.body).join('\n')).not.toContain('Zzboard Harbour');
    await expect(page.getByText('Zzboard Harbour')).toHaveCount(0);
  });

  test('a conflicting move shows the refreshed-board message', async ({ page }) => {
    await enrollAsPlayer(page, 'Board Conflict');
    await page.goto('/board');
    await addNote(page, 'Zz Conflict note');
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
    // Someone else moves the card first.
    await db(`update public.board_items set x = x + 5 where title = 'Zz Conflict note'`);
    await card(page, 'Zz Conflict note').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByText('Someone else changed this card; the board was refreshed.')).toBeVisible({ timeout: 6000 });
  });

  test('sections, marks, colours, export and zoom', async ({ page }) => {
    await enrollAsPlayer(page, 'Board Sections');
    await page.goto('/board');
    await page.getByText('Mystery sections (0)').click();
    await page.getByLabel('New section name').fill('The missing ship');
    await page.getByRole('button', { name: 'Add section' }).click();
    await expect(page.getByText('Mystery sections (1)')).toBeVisible();
    await addNote(page, 'Zz Ship note');
    await page.getByLabel('Section', { exact: true }).selectOption({ label: 'The missing ship' });
    await page.getByRole('group', { name: 'Marks' }).getByRole('button', { name: 'Suspicious' }).click();
    await expect(page.getByRole('group', { name: 'Marks' }).getByRole('button', { name: 'Suspicious' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
    await addNote(page, 'Zz Loose note');
    await page.getByLabel('Show section').selectOption({ label: 'The missing ship' });
    await expect(page.getByTestId('board-card')).toHaveCount(1);
    await page.getByLabel('Show section').selectOption('all');
    await expect(page.getByTestId('board-card')).toHaveCount(2);

    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expectAllCardsInside(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save as image' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^investigation-board\.(png|svg)$/);
  });

  test('phone: list view works without sideways scrolling, with large touch targets', async ({ browser }: { browser: Browser }) => {
    const owner = await browser.newContext();
    const op = await owner.newPage();
    await enrollAsPlayer(op, 'Board Owner');
    await op.goto('/board');
    await addNote(op, 'Zz Phone note');
    await addTheory(op, 'Zz Phone theory');
    await op.getByRole('button', { name: 'Connect to…' }).click();
    await op.getByLabel('Connect to', { exact: true }).selectOption({ label: 'Zz Phone note' });
    await op.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(op.getByTestId('board-link')).toHaveCount(1);
    await owner.close();

    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await enrollAsPlayer(page, 'Board Phone');
    await page.goto('/board');
    await expect(page.getByTestId('board-list-card')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Board view' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Connected to Zz Phone note')).toBeVisible();
    await noHorizontalOverflow(page);
    await page.getByRole('button', { name: /Zz Phone theory/ }).click();
    await expect(page.getByLabel('Theory status')).toBeVisible();
    await noHorizontalOverflow(page);
    for (const control of await page.locator('main button:visible, main select:visible').all()) {
      const b = await control.boundingBox();
      expect(b!.height, (await control.innerText().catch(() => '')).slice(0, 30)).toBeGreaterThanOrEqual(43.5);
    }
    await shot(page, 'board-phone-list.png');
    await context.close();
  });
});
