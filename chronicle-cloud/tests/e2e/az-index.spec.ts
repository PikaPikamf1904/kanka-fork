import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, recordApi, signInAsDm } from './support.ts';

// The A-Z index. The test adds its OWN synthetic pages (readable ones under Q and #, plus a DM-only
// page under a letter no readable page uses) and removes them afterwards.

const docsShots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');
const tag = Date.now().toString(36);
const PREFIX = `zz-az-${tag}`;
const ROWS: { key: string; type: string; title: string; summary: string }[] = [
  { key: 'a', type: 'character', title: `Qzv Alderman ${tag}`, summary: 'A synthetic [[Harbour|harbour]] **official** who counts barrels and keeps careful ledgers of every ship.' },
  { key: 'b', type: 'location', title: `Qzv Landing ${tag}`, summary: 'A synthetic jetty at the edge of the synthetic bay.' },
  { key: 'c', type: 'location', title: `Qzv Market ${tag}`, summary: 'A synthetic market square.' },
  { key: 'd', type: 'quest', title: `Qzv Errand ${tag}`, summary: 'A synthetic errand for the synthetic alderman.' },
  { key: 'e', type: 'item', title: `7 Qzv Seas ${tag}`, summary: 'A synthetic item filed under other characters.' },
];
let hiddenLetter = '';
let hiddenTitle = '';

const cleanup = () => db('delete from public.articles where slug like $1', [`${PREFIX}-%`]);

test.describe('A-Z index', () => {
  test.beforeEach(async () => {
    await cleanup();
    for (const r of ROWS) {
      await db(`insert into public.articles (slug, type, title, summary, visibility, status) values ($1, $2, $3, $4, 'players', 'published')`, [`${PREFIX}-${r.key}`, r.type, r.title, r.summary]);
    }
    // A DM-only page under a letter that no readable page starts with.
    const used = new Set((await db<{ l: string }>(`select distinct upper(left(title, 1)) as l from public.articles where visibility = 'players' and status = 'published' and type <> 'news'`)).map((r) => r.l));
    hiddenLetter = [...'ZYXWVKJ'].find((l) => !used.has(l)) ?? '';
    expect(hiddenLetter).not.toBe('');
    hiddenTitle = `${hiddenLetter}ecret Cellar ${tag}`;
    await db(`insert into public.articles (slug, type, title, summary, visibility, status) values ($1, 'location', $2, 'Synthetic DM-only notes.', 'dm', 'draft')`, [`${PREFIX}-hidden`, hiddenTitle]);
  });
  test.afterEach(cleanup);

  const bar = (page: Page) => page.getByRole('navigation', { name: 'Alphabet' });
  const letter = (page: Page, l: string) => bar(page).getByRole('button', { name: l === '#' ? 'Other characters' : l, exact: true });
  const list = (page: Page) => page.locator('.az-list');

  test('a player browses by letter, kind and typing; the address holds the state; DM-only pages never show', async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
    const bodies = recordApi(page.context());
    await enrollAsPlayer(page, 'Index Reader');
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Wiki' }).getByRole('link', { name: 'A–Z index' }).click();
    await expect(page).toHaveURL(/\/a-z$/);
    await expect(page.getByRole('heading', { name: 'A–Z index', level: 1 })).toBeVisible();
    // A letter with no readable page is disabled; letters with pages are enabled.
    await expect(letter(page, hiddenLetter)).toBeDisabled();
    await expect(letter(page, 'Q')).toBeEnabled();
    await expect(letter(page, '#')).toBeEnabled();
    await expect(list(page).getByRole('listitem').first()).toBeVisible(); // the first letter opens by default

    await letter(page, 'Q').click();
    await expect(page).toHaveURL(/\?letter=Q$/);
    await expect(letter(page, 'Q')).toHaveAttribute('aria-pressed', 'true');
    for (const r of ROWS.filter((x) => x.title.startsWith('Qzv'))) await expect(list(page).getByRole('link', { name: r.title, exact: true })).toBeVisible();
    await expect(list(page).getByRole('link', { name: ROWS[4]!.title })).toHaveCount(0);
    const alderman = list(page).getByRole('listitem').filter({ hasText: ROWS[0]!.title });
    await expect(alderman.getByRole('link', { name: ROWS[0]!.title, exact: true })).toHaveAttribute('href', `/wiki/${PREFIX}-a`);
    await expect(alderman.getByText('Character', { exact: true })).toBeVisible();
    await expect(alderman).toContainText('A synthetic harbour official who counts barrels'); // markup removed from the snippet
    await expect(alderman).not.toContainText('**');
    await page.waitForTimeout(300);
    if (process.env.SAVE_DOC_SHOTS === '1') await page.screenshot({ path: path.join(docsShots, 'az-index-desktop.png') });

    // Kind filter: kept in the address, narrows this letter.
    await page.getByLabel('Kind of page').selectOption('location');
    await expect(page).toHaveURL(/\?letter=Q&type=location$/);
    await expect(list(page).getByRole('listitem')).toHaveCount(2);
    await expect(list(page).getByText(ROWS[0]!.title)).toHaveCount(0);
    // With a kind chosen, a letter with no page of that kind is disabled.
    await expect(letter(page, '#')).toBeDisabled();
    // Back goes to the previous state; forward returns.
    await page.goBack();
    await expect(page).toHaveURL(/\?letter=Q$/);
    await expect(list(page).getByRole('listitem')).toHaveCount(4);
    await expect(page.getByLabel('Kind of page')).toHaveValue('');
    await page.goForward();
    await expect(list(page).getByRole('listitem')).toHaveCount(2);
    await page.getByLabel('Kind of page').selectOption('');

    // The other-characters bucket.
    await letter(page, '#').click();
    await expect(list(page).getByRole('link', { name: ROWS[4]!.title, exact: true })).toBeVisible();

    // Typing searches titles across the wiki and is kept in the address.
    await page.getByLabel('Find by title').fill('landing');
    await expect(page).toHaveURL(/\?q=landing$/);
    await expect(list(page).getByRole('listitem')).toHaveCount(1);
    await expect(list(page).getByRole('link', { name: ROWS[1]!.title })).toBeVisible();
    await page.getByLabel('Find by title').fill('100%_zzzz');
    await expect(list(page).getByRole('listitem')).toHaveCount(0);
    await expect(page.getByText('No titles match.')).toBeVisible();
    // A shared address restores the whole view.
    await page.goto(`/a-z?letter=Q&type=quest`);
    await expect(list(page).getByRole('listitem')).toHaveCount(1);
    await expect(page.getByLabel('Kind of page')).toHaveValue('quest');
    await expect(letter(page, 'Q')).toHaveAttribute('aria-pressed', 'true');
    await page.goto(`/a-z?q=${encodeURIComponent('secret')}`);
    await expect(page.getByLabel('Find by title')).toHaveValue('secret');

    // The DM-only page is nowhere: not on the page, not in any response this browser got.
    await page.goto(`/a-z?letter=${encodeURIComponent(hiddenLetter)}`);
    await expect(page.getByText('Nothing under this letter.')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(hiddenTitle);
    await page.goto(`/a-z?q=${encodeURIComponent(hiddenTitle)}`);
    await expect(page.getByText('No titles match.')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(bodies.map((b) => b.body).join('\n')).not.toContain(hiddenTitle);
    await noHorizontalOverflow(page);
  });

  test('the DM sees the DM-only page under its letter', async ({ page }) => {
    await signInAsDm(page);
    await page.goto('/a-z');
    await expect(letter(page, hiddenLetter)).toBeEnabled();
    await letter(page, hiddenLetter).click();
    const row = list(page).getByRole('listitem').filter({ hasText: hiddenTitle });
    await expect(row).toBeVisible();
    await expect(row.getByText('DM only')).toBeVisible();
    await expect(row.getByText('Draft', { exact: true })).toBeVisible();
  });

  test('on a phone: no sideways scroll, 44px targets, the letter bar scrolls inside itself', async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
    await enrollAsPlayer(page, 'Index Phone');
    await page.goto('/a-z?letter=Q');
    await expect(list(page).getByRole('listitem').first()).toBeVisible();
    await noHorizontalOverflow(page);
    for (const b of [...(await bar(page).getByRole('button').all()), page.getByLabel('Find by title'), page.getByLabel('Kind of page'), ...(await list(page).getByRole('link', { name: /^Qzv/ }).all())]) {
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43.5);
    }
    for (const b of await bar(page).getByRole('button').all()) expect((await b.boundingBox())!.width).toBeGreaterThanOrEqual(43.5);
    const scroll = await bar(page).evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(scroll.sw).toBeGreaterThan(scroll.cw); // scrolls within its own container
    const barBox = (await bar(page).boundingBox())!;
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(390);
    await letter(page, 'Q').tap();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    if (process.env.SAVE_DOC_SHOTS === '1') await page.screenshot({ path: path.join(docsShots, 'az-index-phone.png') });
  });
});
