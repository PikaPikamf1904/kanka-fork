import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { devices, expect, test, type Page } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, signInAsDm } from './support.ts';

// The DM's knowledge export, through real sign-in flows and real downloads. Synthetic rows only,
// created and removed here.
const SECRET_PAGE = 'zz-export-secret';
const PUBLIC_PAGE = 'zz-export-public';
const SECRET = 'E2E-EXPORT-SECRET-SENTINEL';
const JOURNAL = 'E2E-JOURNAL-SENTINEL';
const WORDS = 'E2E custom connection words';

test.beforeAll(async () => {
  await db(`delete from public.articles where slug = any($1)`, [[SECRET_PAGE, PUBLIC_PAGE]]);
  const [pub] = await db<{ id: string }>(`insert into public.articles (slug, type, title, summary, visibility, status) values ($1, 'location', 'Zzexport Haven’s Gate', 'A synthetic place.', 'players', 'published') returning id`, [PUBLIC_PAGE]);
  const [sec] = await db<{ id: string }>(`insert into public.articles (slug, type, title, summary, visibility, status) values ($1, 'character', 'Zzexport Hidden Agent', $2, 'dm', 'published') returning id`, [SECRET_PAGE, SECRET]);
  await db(`insert into public.relations (source_article_id, target_article_id, kind, label, visibility) values ($1, $2, 'resides_in', $3, 'dm')`, [sec!.id, pub!.id, WORDS]);
});
test.afterAll(async () => {
  await db(`delete from public.articles where slug = any($1)`, [[SECRET_PAGE, PUBLIC_PAGE]]);
  await db(`delete from public.journal_entries where body = $1`, [JOURNAL]);
});

async function download(page: Page, button: RegExp) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  const d = await pending;
  await expect(page.getByTestId('export-done')).toBeVisible();
  return { name: d.suggestedFilename(), file: (await d.path())! };
}

test('a player cannot see or open the export, even by its address', async ({ page }) => {
  await enrollAsPlayer(page, 'Export Probe Player');
  // A private journal entry by this player, which no export may contain.
  const [me] = await db<{ user_id: string }>(`select user_id from public.campaign_members where display_name = 'Export Probe Player' order by created_at desc limit 1`);
  await db(`insert into public.journal_entries (user_id, title, body) values ($1, 'Diary', $2)`, [me!.user_id, JOURNAL]);
  await page.goto('/dm');
  await expect(page.getByRole('link', { name: /Export knowledge/ })).toHaveCount(0);
  await page.goto('/dm/export');
  await expect(page.getByRole('heading', { name: 'Export Chronicle Knowledge' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /NotebookLM knowledge document/ })).toHaveCount(0);
});

test('the DM downloads the NotebookLM document and the archive, with secrets and connections and without journals', async ({ page }) => {
  await signInAsDm(page);
  await page.goto('/dm');
  await page.getByRole('link', { name: 'Export knowledge (NotebookLM)' }).click();
  await expect(page.getByRole('heading', { name: 'Export Chronicle Knowledge' })).toBeVisible();

  const doc = await download(page, /NotebookLM knowledge document/);
  expect(doc.name).toMatch(/^Chronicle-Knowledge-\d{4}-\d{2}-\d{2}\.md$/);
  const text = fs.readFileSync(doc.file, 'utf8');
  expect(text).toContain('Zzexport Haven’s Gate'); // apostrophe intact
  expect(text).toContain(SECRET);
  expect(text).toContain(`“${WORDS}”`);
  expect(text).toContain(`IDs: \`${SECRET_PAGE}\` → \`${PUBLIC_PAGE}\`, kind \`resides_in\``);
  expect(text).not.toContain(JOURNAL);
  expect(text).not.toContain('media:');

  const zip = await download(page, /Complete Chronicle archive/);
  expect(zip.name).toMatch(/^Chronicle-Export-\d{4}-\d{2}-\d{2}\.zip$/);
  const listing = JSON.parse(execFileSync('python3', ['-I', '-c', `
import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps({n: z.read(n).decode('utf-8') for n in z.namelist()}))
`, zip.file], { encoding: 'utf8' })) as Record<string, string>;
  expect(Object.keys(listing)).toContain('Chronicle-Export/README.md');
  expect(Object.keys(listing)).toContain('Chronicle-Export/Locations/Zzexport Haven’s Gate.md');
  expect(listing['Chronicle-Export/Relationships/Relationships.md']).toContain(WORDS);
  expect(JSON.stringify(listing)).not.toContain(JOURNAL);

  // Without DM secrets, the same download holds none of them.
  await page.getByLabel(/Include DM secrets/).uncheck();
  const safe = fs.readFileSync((await download(page, /NotebookLM knowledge document/)).file, 'utf8');
  expect(safe).toContain('Zzexport Haven’s Gate');
  expect(safe).not.toContain(SECRET);
  expect(safe).not.toContain(WORDS);
  expect(safe).toContain('contains only what players can read');
});

test.describe('on a phone', () => {
  const pixel: Record<string, unknown> = { ...devices['Pixel 7'] };
  delete pixel.defaultBrowserType;
  test.use(pixel);

  test('the export page fits and the download works', async ({ page }) => {
    await signInAsDm(page);
    await page.goto('/dm/export');
    await expect(page.getByRole('heading', { name: 'Export Chronicle Knowledge' })).toBeVisible();
    await noHorizontalOverflow(page);
    for (const b of [page.getByRole('button', { name: /NotebookLM knowledge document/ }), page.getByRole('button', { name: /Complete Chronicle archive/ })]) {
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const doc = await download(page, /NotebookLM knowledge document/);
    expect(fs.readFileSync(doc.file, 'utf8')).toContain('Zzexport Haven’s Gate');
    await noHorizontalOverflow(page);
  });
});
