import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { assertDisposableDatabase, readLocalEnv } from '../../scripts/local-targets.mjs';
import { enrollAsPlayer, noHorizontalOverflow, screenshot, signInAsDm } from './support.ts';

// The DM's "Tidy up the wiki" report, against the synthetic sample world plus two probe pages the
// test adds (and removes): one players can read and one only the DM can see, each linking to a page
// that does not exist.

const docsShots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');
const LIVE = 'harbour-ledger-notes';
const HIDDEN = 'lantern-rites-draft';
const GAPS = ['lost-harbour-ledger', 'lost-lantern-rites'];

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

const removeProbes = () => db('delete from public.articles where slug = any($1)', [[LIVE, HIDDEN]]);

async function addProbe(slug: string, title: string, visibility: 'players' | 'dm', status: 'published' | 'draft', gap: string) {
  const [a] = await db<{ id: string }>(
    `insert into public.articles (slug, type, title, summary, visibility, status) values ($1, 'location', $2, '', $3, $4) returning id`,
    [slug, title, visibility, status],
  );
  await db(
    `insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 1, 'Notes', $2, $3, $4)`,
    [a!.id, `The old route is written up in [[${gap}]].`, visibility, status],
  );
}

const section = (page: Page, id: string) => page.getByTestId(`tidy-${id}`);

test.describe('Tidy up the wiki', () => {
  test.beforeEach(async () => {
    await removeProbes();
    await addProbe(LIVE, 'Harbour Ledger Notes', 'players', 'published', GAPS[0]!);
    await addProbe(HIDDEN, 'Lantern Rites Draft', 'dm', 'draft', GAPS[1]!);
  });
  test.afterEach(removeProbes);

  test('the DM finds the report from the DM desk and works through it', async ({ page, browser }) => {
    test.setTimeout(180_000);
    await signInAsDm(page);
    await page.goto('/dm');
    await page.locator('main').getByRole('link', { name: 'Tidy up the wiki' }).click();
    await expect(page).toHaveURL(/\/dm\/tidy$/);
    await expect(page.getByRole('heading', { name: 'Tidy up the wiki', level: 1 })).toBeVisible();
    await expect(page.getByText('Checking the wiki')).toHaveCount(0);

    // All five sections are there, collapsed, each with a count.
    for (const id of ['broken', 'orphans', 'summary', 'picture', 'empty']) {
      await expect(section(page, id)).toBeVisible();
      await expect(section(page, id)).not.toHaveAttribute('open', '');
    }
    const broken = section(page, 'broken');
    await expect(broken.locator('.tidy-count')).toHaveText(/^[1-9]\d*$/);
    const total = Number(await broken.locator('.tidy-count').innerText());

    // Expanding shows both probes' broken links, with links to the page, its editor and "Create this page".
    await broken.locator('summary').click();
    await expect(broken).toHaveAttribute('open', '');
    const liveRow = broken.getByRole('listitem').filter({ hasText: 'Harbour Ledger Notes' });
    const hiddenRow = broken.getByRole('listitem').filter({ hasText: 'Lantern Rites Draft' });
    await expect(liveRow).toContainText(`[[${GAPS[0]}]]`);
    await expect(liveRow.getByText('Players', { exact: true })).toBeVisible();
    await expect(liveRow.getByText('Published', { exact: true })).toBeVisible();
    await expect(hiddenRow.getByText('DM only')).toBeVisible();
    await expect(hiddenRow.getByText('Draft', { exact: true })).toBeVisible();
    await expect(liveRow.getByRole('link', { name: 'Harbour Ledger Notes', exact: true })).toHaveAttribute('href', `/wiki/${LIVE}`);
    await expect(liveRow.getByRole('link', { name: 'Edit Harbour Ledger Notes' })).toHaveAttribute('href', `/dm/edit/${LIVE}`);
    // The probes are locations with no picture, no summary and not linked from anywhere.
    for (const id of ['orphans', 'summary', 'picture']) {
      await section(page, id).locator('summary').click();
      await expect(section(page, id).getByRole('listitem').filter({ hasText: 'Harbour Ledger Notes' })).toHaveCount(1);
    }

    // The filter drops the DM-only draft and keeps the published page, and the counts follow.
    await page.getByRole('button', { name: 'Only pages players can see' }).click();
    await expect(page.getByRole('button', { name: 'Only pages players can see' })).toHaveAttribute('aria-pressed', 'true');
    await expect(hiddenRow).toHaveCount(0);
    await expect(liveRow).toHaveCount(1);
    expect(Number(await broken.locator('.tidy-count').innerText())).toBeLessThan(total);
    await page.getByRole('button', { name: 'Only pages players can see' }).click();
    await expect(hiddenRow).toHaveCount(1);

    // "Create this page" opens the new-page form with the missing address filled in.
    await liveRow.getByRole('link', { name: 'Create this page' }).click();
    await expect(page).toHaveURL(/\/dm\/new\?/);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Lost Harbour Ledger');
    await expect(page.locator('input[value="lost-harbour-ledger"]')).toHaveCount(1);

    // Desktop picture, with the sections open.
    const desktop = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
    await signInAsDm(desktop);
    await desktop.goto('/dm/tidy');
    await expect(section(desktop, 'broken')).toBeVisible();
    await section(desktop, 'broken').locator('summary').click();
    await section(desktop, 'orphans').locator('summary').click();
    await expect(section(desktop, 'broken').getByRole('listitem').filter({ hasText: 'Harbour Ledger Notes' })).toBeVisible();
    await desktop.waitForTimeout(300);
    await desktop.screenshot({ path: path.join(docsShots, 'wiki-tidy-desktop.png') });
    await noHorizontalOverflow(desktop);

    // Phone: no sideways scroll, rows wrap, controls are at least 44px tall.
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
    await signInAsDm(phone);
    await phone.goto('/dm/tidy');
    await expect(section(phone, 'broken')).toBeVisible();
    for (const id of ['broken', 'orphans', 'summary', 'picture', 'empty']) await section(phone, id).locator('summary').click();
    await expect(section(phone, 'broken').getByRole('listitem').filter({ hasText: 'Harbour Ledger Notes' })).toBeVisible();
    await noHorizontalOverflow(phone);
    const controls = phone.locator('.tidy-section .button, .tidy-section summary, .tidy-filter');
    for (let i = 0; i < Math.min(await controls.count(), 12); i++) {
      const b = await controls.nth(i).boundingBox();
      if (b) expect(b.height).toBeGreaterThanOrEqual(43.5);
    }
    await phone.evaluate(() => window.scrollTo(0, 0));
    await phone.waitForTimeout(300);
    await phone.screenshot({ path: path.join(docsShots, 'wiki-tidy-phone.png') });
    await screenshot(phone, 'wiki-tidy-phone');
  });

  test('a player gets no link and no report', async ({ page }) => {
    await enrollAsPlayer(page, 'Tidy Checker');
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Tidy up the wiki' })).toHaveCount(0);
    await page.goto('/dm/tidy');
    await expect(page.getByRole('heading', { name: 'Tidy up the wiki' })).toHaveCount(0);
    await expect(page.getByTestId('tidy-broken')).toHaveCount(0);
    await expect(page.getByText(GAPS[0]!)).toHaveCount(0);
    await expect(page.getByText('Harbour Ledger Notes')).toHaveCount(0);
  });
});
