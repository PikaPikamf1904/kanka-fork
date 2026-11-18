import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, signInAsDm } from './support.ts';

// "Wander" picks a random page the reader may read. The test adds its OWN synthetic pages (a few
// readable ones and many DM-only/draft ones) and removes them afterwards.

const tag = Date.now().toString(36);
const PREFIX = `zz-wander-${tag}`;
const SECRET = Array.from({ length: 12 }, (_, i) => `${PREFIX}-secret-${i}`);
const OPEN = Array.from({ length: 3 }, (_, i) => `${PREFIX}-open-${i}`);

const cleanup = () => db('delete from public.articles where slug like $1', [`${PREFIX}-%`]);

test.describe('Wander', () => {
  test.beforeEach(async () => {
    await cleanup();
    for (const slug of OPEN) {
      await db(`insert into public.articles (slug, type, title, summary, visibility, status) values ($1, 'location', $2, 'A synthetic readable place.', 'players', 'published')`, [slug, `Wander Open ${slug}`]);
    }
    for (const [i, slug] of SECRET.entries()) {
      await db(`insert into public.articles (slug, type, title, summary, visibility, status) values ($1, $2, $3, 'A synthetic DM-only page.', $4, $5)`, [slug, i % 2 ? 'location' : 'dossier', `Wander Hidden ${slug}`, 'dm', i % 3 ? 'published' : 'draft']);
    }
  });
  test.afterEach(cleanup);

  test('a player wanders: always a readable page, never a DM-only one, and not the same one twice running', async ({ page }) => {
    test.setTimeout(180_000);
    await enrollAsPlayer(page, 'Wander Reader');
    // The link is in the main navigation and on the home page.
    await expect(page.getByRole('navigation', { name: 'Wiki' }).getByRole('link', { name: /Wander/ })).toHaveAttribute('href', '/wander');
    await expect(page.getByRole('navigation', { name: 'Quick access' }).getByRole('link', { name: 'Wander', exact: true })).toHaveAttribute('href', '/wander');
    const landed: string[] = [];
    for (let i = 0; i < 15; i++) {
      await page.goto('/wander');
      await page.waitForURL(/\/wiki\/[a-z0-9-]+$/);
      const slug = new URL(page.url()).pathname.split('/').pop()!;
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText('Nothing written here yet')).toHaveCount(0);
      expect(SECRET).not.toContain(slug);
      await expect(page.locator('body')).not.toContainText('Wander Hidden');
      landed.push(slug);
    }
    for (let i = 1; i < landed.length; i++) expect(landed[i]).not.toBe(landed[i - 1]);
    // The tab remembers the last ten and forgets them on sign-out of the account (storage cleared by the app).
    const remembered = await page.evaluate(() => JSON.parse(sessionStorage.getItem('chronicle-wander-recent') ?? '[]') as string[]);
    expect(remembered.length).toBeLessThanOrEqual(10);
    expect(remembered[remembered.length - 1]).toBe(landed[landed.length - 1]);

    // A type filter lands on that type only.
    for (let i = 0; i < 4; i++) {
      await page.goto('/wander?type=location');
      await page.waitForURL(/\/wiki\/[a-z0-9-]+$/);
      await expect(page.locator('.article-type-location')).toBeVisible();
    }
    // Nothing readable of a type: a friendly message instead of a page.
    const [dossiers] = await db<{ n: string }>(`select count(*)::text as n from public.articles where type = 'dossier' and visibility = 'players' and status = 'published'`);
    expect(dossiers!.n).toBe('0');
    await page.goto('/wander?type=dossier');
    await expect(page.getByRole('heading', { name: 'Nothing to wander to yet' })).toBeVisible();
    await expect(page.getByText('Wander Hidden')).toHaveCount(0);
    await expect(page).toHaveURL(/\/wander\?type=dossier$/);
  });

  test('the DM wanders to a page and the back button does not trap them', async ({ page }) => {
    await signInAsDm(page);
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Wiki' }).getByRole('link', { name: /Wander/ }).click();
    await page.waitForURL(/\/wiki\/[a-z0-9-]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/); // the /wander step was replaced, not kept in history
  });
});
