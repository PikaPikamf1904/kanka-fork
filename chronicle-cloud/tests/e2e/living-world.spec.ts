// Living World: a scheduled story stays invisible to players until the database says its time has
// come; letters from Krynn; the home page's small "what's new". Synthetic content only.
import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, screenshot, signInAsDm } from './support.ts';

test.describe('Living World', () => {
  test('a scheduled story prints itself when its time comes; a letter is delivered like a letter', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const tag = Date.now().toString(36);
    const headline = `Goblin Postmaster Delayed ${tag}`;
    const letterTitle = `A Note About The Bridge ${tag}`;
    await signInAsDm(page);

    // ---- write, approve and SCHEDULE a story
    await page.goto('/dm/news/new');
    await page.getByLabel('Headline', { exact: true }).fill(headline);
    await page.getByRole('textbox', { name: /^Story/ }).fill('LIVINGBODY The postmaster was late.');
    await page.getByRole('button', { name: 'Save story' }).click();
    await expect(page.getByText('Saved. Players cannot see it until you print it.')).toBeVisible();
    const slug = new URL(page.url()).pathname.split('/').pop()!;
    await page.getByRole('button', { name: 'Send for review' }).click();
    await expect(page.getByText('In review: players cannot see this story.')).toBeVisible();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText('Approved: players cannot see this story.')).toBeVisible();

    // A time in the past is refused; a future time schedules.
    const when = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel(/Release on/).fill(`${when}T09:00`);
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(page.getByText(/Scheduled for/).first()).toBeVisible();
    await expect(page.getByText('Players cannot see it until then.')).toBeVisible();
    await screenshot(page, 'living-world-dm-scheduled');

    // The desk lists it under Scheduled, apart from the printed stories.
    await page.goto('/dm/news');
    const scheduled = page.getByRole('heading', { name: 'Scheduled' });
    await expect(scheduled).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(headline) })).toContainText('Scheduled');

    // ---- a player cannot see it: not on the front page, not by address, not in search
    const player = await (await browser.newContext()).newPage();
    await enrollAsPlayer(player, 'Living Reader');
    await player.goto('/news');
    await expect(player.getByText(headline)).toHaveCount(0);
    await player.goto(`/news/${slug}`);
    await expect(player.getByRole('heading', { name: 'Nothing written here yet' })).toBeVisible();
    await player.goto(`/search?q=${encodeURIComponent('LIVINGBODY')}`);
    await expect(player.getByText(headline)).toHaveCount(0);

    // ---- time passes (moved on the database, as the clock would): the next visit prints it
    await db("update public.articles set publish_at = now() - interval '1 second' where slug = $1", [slug]);
    await player.goto('/news');
    await expect(player.getByRole('link', { name: headline })).toBeVisible();
    await player.goto(`/news/${slug}`);
    await expect(player.getByRole('heading', { level: 1, name: headline })).toBeVisible();

    // ---- a letter: sender, recipient, signature, then delivered at once
    await page.goto('/dm/news/new');
    await page.getByLabel('Headline', { exact: true }).fill(letterTitle);
    await page.getByLabel('Section').selectOption('letters');
    await page.getByLabel('Letter from (sender)').fill('A Synthetic Innkeeper');
    await page.getByLabel('Letter to (recipient)').fill('The Company');
    await page.getByLabel('Signature (optional)').fill('With warm regards');
    await page.getByLabel('Dateline (place)').fill('The Synthetic Inn');
    await page.getByRole('textbox', { name: /^Story/ }).fill('Dear friends, the bridge is mended. LETTERBODY');
    await page.getByRole('button', { name: 'Save story' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    const letterSlug = new URL(page.url()).pathname.split('/').pop()!;
    await page.getByRole('button', { name: 'Send for review' }).click();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.getByRole('button', { name: 'Print for players' }).click();
    await expect(page.getByText('Printed: players can now read this story.')).toBeVisible();

    await player.goto('/letters');
    await expect(player.getByRole('heading', { name: 'Letters from Krynn' })).toBeVisible();
    await player.getByRole('link', { name: letterTitle }).click();
    await expect(player.getByRole('heading', { level: 1, name: letterTitle })).toBeVisible();
    await expect(player.getByText('From A Synthetic Innkeeper')).toBeVisible();
    await expect(player.getByText('With warm regards')).toBeVisible();
    await screenshot(player, 'living-world-letter');
    // A letter is not a newspaper story: it is absent from the front page and archive.
    await player.goto('/news');
    await expect(player.getByRole('link', { name: letterTitle }).first()).toBeVisible(); // in the "Letters from Krynn" box only
    await expect(player.locator('.gz-teaser', { hasText: letterTitle })).toHaveCount(0);
    await player.goto('/news/archive');
    await expect(player.getByText(letterTitle)).toHaveCount(0);

    // ---- the home page shows what is new, without inventing anything
    await player.goto('/');
    await expect(player.locator('.now-gazette')).toContainText(headline);
    await expect(player.locator('.now-letter')).toContainText(letterTitle);
    await expect(player.locator('.now-discovery')).toBeVisible();
    await screenshot(player, 'living-world-home');

    // ---- phone
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    await enrollAsPlayer(phone, 'Phone Letters');
    for (const path of ['/', '/letters', `/news/${letterSlug}`]) {
      await phone.goto(path);
      await noHorizontalOverflow(phone);
    }
    await screenshot(phone, 'living-world-letter-phone');

    await db("delete from public.articles where slug = any($1)", [[slug, letterSlug]]);
    await player.close();
    await phone.close();
  });
});
