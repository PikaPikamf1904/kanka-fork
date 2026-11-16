import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, signInAsDm } from './support.ts';

// Renaming a page's address keeps the old one working: the editor adds a redirect when it saves.
// Probe pages are made and removed here.

const OLD = 'zz-rename-old-mill';
const NEW = 'zz-rename-new-mill';
const HIDDEN_OLD = 'zz-rename-secret-vault';
const HIDDEN_NEW = 'zz-rename-plain-cellar';
const ALL = [OLD, NEW, HIDDEN_OLD, HIDDEN_NEW];

async function make(slug: string, title: string, visibility: 'players' | 'dm') {
  const [a] = await db<{ id: string }>(
    `insert into public.articles (slug, type, title, summary, visibility, status) values ($1, 'location', $2, 'A synthetic place.', $3, 'published') returning id`,
    [slug, title, visibility],
  );
  await db(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 1, 'About', 'Synthetic text.', $2, 'published')`, [a!.id, visibility]);
}

const clean = async () => {
  await db('delete from public.redirects where from_slug = any($1)', [ALL]);
  await db('delete from public.articles where slug = any($1)', [ALL]);
};

test.describe('Renaming an address', () => {
  test.beforeEach(async () => {
    await clean();
    await make(OLD, 'Zzrename Old Mill', 'players');
    await make(HIDDEN_OLD, 'Zzrename Secret Vault', 'dm');
  });
  test.afterEach(clean);

  test('old links keep working; a hidden page keeps its old address private', async ({ page, browser }) => {
    await signInAsDm(page);
    const rename = async (from: string, to: string) => {
      await page.goto(`/dm/edit/${from}`);
      const field = page.getByLabel('Address (slug)');
      await expect(field).toHaveValue(from);
      await field.fill(to);
      await expect(page.getByLabel(`Keep the old address /wiki/${from} working (adds a redirect when you save)`)).toBeChecked();
      await page.getByRole('button', { name: 'Save', exact: true }).first().click();
      await expect(page.getByText(`Saved. The old address /wiki/${from} now leads here.`)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/dm/edit/${to}$`));
    };
    await rename(OLD, NEW);
    await rename(HIDDEN_OLD, HIDDEN_NEW);
    expect(await db<{ from_slug: string; visibility: string }>('select from_slug, visibility from public.redirects where from_slug = any($1) order by from_slug', [[OLD, HIDDEN_OLD]]))
      .toEqual([{ from_slug: OLD, visibility: 'players' }, { from_slug: HIDDEN_OLD, visibility: 'dm' }]);

    await page.goto(`/wiki/${OLD}`);
    await expect(page).toHaveURL(new RegExp(`/wiki/${NEW}`));
    await expect(page.getByText(`(Redirected from ${OLD})`)).toBeVisible();

    // Unticking the box renames without a redirect.
    await page.goto(`/dm/edit/${NEW}`);
    await expect(page.getByLabel('Address (slug)')).toHaveValue(NEW);
    await page.getByLabel('Address (slug)').fill('zz-rename-third-mill');
    await page.getByLabel(`Keep the old address /wiki/${NEW} working (adds a redirect when you save)`).uncheck();
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    expect(await db('select 1 from public.redirects where from_slug = $1', [NEW])).toHaveLength(0);
    await db(`update public.articles set slug = $1 where slug = 'zz-rename-third-mill'`, [NEW]);

    // A player follows the public page's old link, but learns nothing about the hidden one.
    const player = await (await browser.newContext()).newPage();
    await enrollAsPlayer(player, 'Rename Probe');
    await player.goto(`/wiki/${OLD}`);
    await expect(player.getByRole('heading', { level: 1, name: 'Zzrename Old Mill' })).toBeVisible();
    await player.goto(`/wiki/${HIDDEN_OLD}`);
    await expect(player.getByText('Zzrename Secret Vault')).toHaveCount(0);
    await expect(player.getByText(HIDDEN_NEW)).toHaveCount(0);
  });
});
