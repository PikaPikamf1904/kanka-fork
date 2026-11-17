// Character journals: write, edit, search, tag, link, delete; what other players and the DM see.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, recordApi, signInAsDm } from './support.ts';

const SLUG = 'zz-journal-harbour';
const TEXT = 'ZZJOURNALTHEORY the harbourmaster lied about the tide';

test.beforeEach(async () => {
  await db('delete from public.articles where slug = $1', [SLUG]);
  await db(`insert into public.articles (slug, type, title, summary, visibility, status, published_at) values ($1, 'location', 'Zzjournal Harbour', 'Synthetic.', 'players', 'published', now())`, [SLUG]);
});
test.afterEach(async () => {
  await db(`delete from public.journal_entries where title like 'Zz%'`);
  await db('delete from public.articles where slug = $1', [SLUG]);
});

async function writeEntry(page: Page, title: string, body: string, tags: string[], link = false, date = '2026-11-03') {
  await page.getByRole('button', { name: 'New entry' }).click();
  const form = page.getByRole('form', { name: 'New entry' });
  await form.getByLabel('Title').fill(title);
  await form.getByLabel('Date').fill(date);
  await form.getByLabel('Entry').fill(body);
  for (const t of tags) await form.getByRole('button', { name: t, exact: true }).click();
  if (link) {
    await form.getByLabel('Link a page').fill('Zzjournal');
    await form.getByRole('button', { name: /^Link Zzjournal Harbour/ }).click();
    await expect(form.getByRole('button', { name: 'Unlink Zzjournal Harbour' })).toBeVisible();
  }
  await form.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByRole('form', { name: 'New entry' })).toHaveCount(0);
}

test.describe('character journal', () => {
  test('create, edit, search, filter by tag, link a page, delete', async ({ page }) => {
    await enrollAsPlayer(page, 'Journal One');
    await page.goto('/journal');
    await expect(page.getByRole('heading', { name: 'Your journal', level: 1 })).toBeVisible();
    await expect(page.getByText('Your journal is empty.')).toBeVisible();

    await writeEntry(page, 'Zz Harbourmaster', `${TEXT}. **Bold clue.**`, ['Theory', 'Suspicion'], true);
    await writeEntry(page, 'Zz Find the key', 'Ask the smith about the key.', ['Goal'], false, '2026-10-12');

    const entries = page.getByTestId('journal-entry');
    await expect(entries).toHaveCount(2);
    // Newest first, grouped by month.
    await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: /2026$/ })).toHaveText(['November 2026', 'October 2026']);
    await expect(entries.first()).toContainText('3 November 2026');
    await expect(entries.first().locator('strong')).toHaveText('Bold clue.');
    await expect(entries.first().getByRole('link', { name: 'Zzjournal Harbour' })).toHaveAttribute('href', `/wiki/${SLUG}`);

    await page.getByLabel('Search your journal').fill('smith');
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText('Zz Find the key');
    await page.getByLabel('Search your journal').fill('');
    await page.getByRole('group', { name: 'Filter by tag' }).getByRole('button', { name: 'Suspicion' }).click();
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText('Zz Harbourmaster');
    await page.getByRole('button', { name: 'All entries' }).click();

    await page.getByRole('button', { name: 'Edit Zz Find the key' }).click();
    await page.getByRole('form', { name: 'Edit entry' }).getByLabel('Title').fill('Zz Find the lost key');
    await page.getByRole('form', { name: 'Edit entry' }).getByRole('button', { name: 'Save entry' }).click();
    await expect(page.getByRole('heading', { name: 'Zz Find the lost key', level: 3 })).toBeVisible();

    // A page that is hidden later drops out of the links; the entry stays.
    await db(`update public.articles set visibility = 'dm' where slug = $1`, [SLUG]);
    await page.reload();
    await expect(entries).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Zzjournal Harbour' })).toHaveCount(0);

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Delete Zz Harbourmaster' }).click();
    await expect(entries).toHaveCount(1);
    await expect(page.getByText(TEXT)).toHaveCount(0);
  });

  test('another player sees nothing of it, on screen or in API responses; the DM reads it, read-only', async ({ page, browser }: { page: Page; browser: Browser }) => {
    await enrollAsPlayer(page, 'Journal Writer');
    await page.goto('/journal');
    await writeEntry(page, 'Zz Secret theory', TEXT, ['Theory'], true);

    const ctx2 = await browser.newContext();
    const api = recordApi(ctx2);
    const p2 = await ctx2.newPage();
    await enrollAsPlayer(p2, 'Journal Reader');
    await p2.goto('/journal');
    await expect(p2.getByText('Your journal is empty.')).toBeVisible();
    await p2.goto('/dm/journals');
    await expect(p2.getByText('ZZJOURNALTHEORY')).toHaveCount(0);
    await expect(p2.getByRole('heading', { name: 'Player journals' })).toHaveCount(0);
    await p2.goto(`/wiki/${SLUG}`);
    await expect(p2.getByRole('heading', { name: 'Zzjournal Harbour', level: 1 })).toBeVisible();
    await p2.waitForLoadState('networkidle');
    expect(api.map((r) => r.body).join('\n')).not.toContain('ZZJOURNALTHEORY');
    expect(api.map((r) => r.body).join('\n')).not.toContain('Zz Secret theory');
    await ctx2.close();

    const dmCtx = await browser.newContext();
    const dm = await dmCtx.newPage();
    await signInAsDm(dm);
    await dm.goto('/dm/journals');
    const section = dm.getByRole('region', { name: /^Journal Writer/ });
    await expect(section.getByTestId('player-journal-entry')).toContainText('ZZJOURNALTHEORY');
    await expect(section.getByRole('link', { name: 'Zzjournal Harbour' })).toBeVisible();
    await dm.getByRole('group', { name: 'Filter by tag' }).getByRole('button', { name: 'Goal' }).click();
    await expect(dm.getByText('No entries match.')).toBeVisible();
    await dm.getByRole('button', { name: 'All entries' }).click();
    await expect(section).toBeVisible();
    await expect(dm.getByRole('button', { name: /Edit|Delete/ })).toHaveCount(0);
    // The DM's own journal page lists only the DM's own entries.
    await dm.goto('/journal');
    await expect(dm.getByText('ZZJOURNALTHEORY')).toHaveCount(0);
    await dmCtx.close();
  });

  test('the journal never says who can read it', async ({ page }) => {
    await enrollAsPlayer(page, 'Journal Three');
    await page.goto('/journal');
    await writeEntry(page, 'Zz Copy check', 'Plain text.', ['Note']);
    await page.getByRole('button', { name: 'New entry' }).click();
    const text = (await page.locator('main#main').innerText()).toLowerCase();
    for (const banned of ['private', 'only you', 'dm can', 'the dm', 'read receipt']) expect(text, banned).not.toContain(banned);
  });

  test('phone layout: no sideways scrolling and large touch targets', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await enrollAsPlayer(page, 'Journal Phone');
    await page.goto('/journal');
    await writeEntry(page, 'Zz A long title that keeps going and going on a small phone screen for testing', 'Text '.repeat(80), ['Goal'], true);
    await noHorizontalOverflow(page);
    await page.getByRole('button', { name: 'New entry' }).click();
    await noHorizontalOverflow(page);
    for (const control of await page.locator('main button:visible, main input:visible').all()) {
      const type = await control.getAttribute('type');
      if (type === 'checkbox' || type === 'hidden') continue;
      const box = await control.boundingBox();
      expect(box!.height, (await control.innerText().catch(() => '')) || (await control.getAttribute('id')) || '').toBeGreaterThanOrEqual(43.5);
    }
    await context.close();
  });
});
