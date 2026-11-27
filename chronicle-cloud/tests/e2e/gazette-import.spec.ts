// Importing a Gazette package (one Markdown file, several finished stories) on the DM news desk, then
// approving it through the same batch step as assistant proposals. Synthetic content only.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, screenshot, signInAsDm } from './support.ts';

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function packageFile(tag: string) {
  const md = `# Synthetic package ${tag}

Instructions that are not a story.

---

## ${day(-1)} 05:45 MST — Import Missed ${tag}

*A subtitle that was missed.*

**By Gribble Inkfinger, Senior Military Correspondent**  
**Reliability: Rumor**

IMPORTBODY first story, **bold**, kept exactly.

### A heading inside the story

- one
- two

---

## ${day(2)} 05:45 MST — Import Future ${tag}

*Soup or philosophy.*

**By Professor Bogwart, Department of Questionable Science**  
**Reliability: Satire**

IMPORTBODY second story.

---

## ${day(3)} 05:45 MST — Import Unknown ${tag}

**By Nobody Real, Visiting Bard**  
**Reliability: Rumor**

Not importable.
`;
  const file = path.join(test.info().outputDir, `package-${tag}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, md);
  return file;
}

test('the DM imports a Gazette package, chooses sections, and approves it; a missed date can be printed now', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const tag = Date.now().toString(36);
  const missed = `Import Missed ${tag}`, future = `Import Future ${tag}`;
  await db('delete from public.news_proposals');
  const file = packageFile(tag);

  await signInAsDm(page);
  await page.goto('/dm/news');
  await page.getByText('Import Gazette package').click();
  await page.getByLabel('Choose a file').setInputFiles(file);
  const stories = page.getByTestId('package-story');
  await expect(stories).toHaveCount(3);
  await expect(stories.nth(0)).toContainText('By Gribble Inkfinger, Senior Military Correspondent');
  await expect(stories.nth(0)).toContainText('A subtitle that was missed.');
  await expect(stories.nth(2)).toContainText('not on the Gazette staff list');
  await expect(stories.nth(2).getByRole('checkbox')).toBeDisabled();

  // A section must be chosen for each story before anything is added.
  const add = page.getByRole('button', { name: /^Add 2 stories for approval/ });
  await expect(add).toBeDisabled();
  await stories.nth(0).getByLabel('Section').selectOption('war');
  await stories.nth(1).getByLabel('Section').selectOption('local');
  await stories.nth(0).getByRole('button', { name: 'Show text' }).click();
  await expect(stories.nth(0).locator('.gz-import-text h3')).toHaveText('A heading inside the story');
  await screenshot(page, 'gazette-import-preview');
  await add.click();
  await expect(page.getByText('2 stories added to “Waiting for your approval”')).toBeVisible();

  // Stored exactly: body text, subtitle, reporter, section, reliability, 05:45 Arizona = 12:45 UTC.
  const rows = await db<{ title: string; subtitle: string; body: string; reporter: string; section: string; reliability: string; at: string; created_via: string }>(
    "select title, subtitle, body, reporter, section::text, reliability::text, to_char(suggested_publish_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as at, created_via from public.news_proposals order by suggested_publish_at");
  expect(rows).toEqual([
    { title: missed, subtitle: 'A subtitle that was missed.', body: 'IMPORTBODY first story, **bold**, kept exactly.\n\n### A heading inside the story\n\n- one\n- two', reporter: 'gribble', section: 'war', reliability: 'rumor', at: `${day(-1)} 12:45`, created_via: 'web' },
    { title: future, subtitle: 'Soup or philosophy.', body: 'IMPORTBODY second story.', reporter: 'bogwart', section: 'local', reliability: 'satire', at: `${day(2)} 12:45`, created_via: 'web' },
  ]);

  // Importing the same file again (the panel is still open): both are recognised as duplicates.
  await page.getByLabel('Choose a file').setInputFiles(file);
  await expect(page.getByText(/Duplicate: Already on the news desk/)).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Add 0 stories/ })).toBeDisabled();

  // Approve through the existing batch step. The missed date is changed to "print now".
  const panel = page.locator('#proposals');
  await expect(panel.getByText('imported by the DM').first()).toBeVisible();
  await panel.getByRole('button', { name: 'Choose all' }).click();
  for (const t of [missed, future]) await panel.getByTestId('news-proposal').filter({ hasText: t }).getByRole('button', { name: 'Read it' }).click();
  const missedRow = panel.getByTestId('news-proposal').filter({ hasText: missed });
  await expect(missedRow.getByLabel('What happens')).toHaveValue('hold');
  await missedRow.getByLabel('What happens').selectOption('print');
  await panel.getByLabel(/I have read these 2 stories in full/).check();
  page.once('dialog', (d) => void d.accept());
  await panel.getByRole('button', { name: /^Accept, approve and schedule/ }).click();
  await expect(page.getByText(/Approved 2: 1 scheduled, 1 printed now/)).toBeVisible();
  const stored = await db<{ title: string; status: string; at: string | null }>(
    "select title, status::text, to_char(publish_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as at from public.articles where title = any($1) order by title", [[missed, future]]);
  expect(stored).toEqual([{ title: future, status: 'draft', at: `${day(2)} 12:45` }, { title: missed, status: 'published', at: null }]);

  // Players: the printed one now, the scheduled one not before its time.
  const player = await (await browser.newContext()).newPage();
  await enrollAsPlayer(player, 'Import Reader');
  await player.goto('/news');
  await expect(player.getByRole('link', { name: missed })).toBeVisible();
  await expect(player.getByText(future)).toHaveCount(0);
  await player.goto('/dm/news');
  await expect(player.getByText('Import Gazette package')).toHaveCount(0); // not the DM: no import

  // Phone.
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await signInAsDm(phone);
  await phone.goto('/dm/news');
  await phone.getByText('Import Gazette package').click();
  await phone.getByLabel('Choose a file').setInputFiles(file);
  await expect(phone.getByTestId('package-story')).toHaveCount(3);
  await noHorizontalOverflow(phone);
  await screenshot(phone, 'gazette-import-phone');

  await db('delete from public.articles where title = any($1)', [[missed, future]]);
  await db('delete from public.news_proposals');
  await player.close();
  await phone.close();
});
