import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, recordApi, signInAsDm } from './support.ts';

// Status ribbons come from each page's Status field. Two synthetic characters made and removed here:
// one whose status players may see ("Slain at the Ford"), one whose status field is DM-only
// ("Missing"): the DM sees both ribbons, a player sees only the first, and never the hidden text.

const SLUGS = ['zz-ribbon-fallen-knight', 'zz-ribbon-secret-spy'];

async function character(slug: string, title: string, status: string, fieldVisibility: 'players' | 'dm') {
  const [a] = await db<{ id: string }>(
    `insert into public.articles (slug, type, title, summary, visibility, status) values ($1, 'character', $2, 'A synthetic character.', 'players', 'published') returning id`,
    [slug, title],
  );
  await db(`insert into public.infobox_fields (article_id, position, label, value, visibility) values ($1, 1, 'Status', $2, $3)`, [a!.id, status, fieldVisibility]);
}

test.describe('Status ribbons', () => {
  test.beforeEach(async () => {
    await db('delete from public.articles where slug = any($1)', [SLUGS]);
    await character(SLUGS[0]!, 'Zzribbon Fallen Knight', 'Slain at the Ford', 'players');
    await character(SLUGS[1]!, 'Zzribbon Secret Spy', 'Missing, presumed turned', 'dm');
  });
  test.afterEach(() => db('delete from public.articles where slug = any($1)', [SLUGS]));

  test('cards and pages show known world states; a hidden status never reaches a player', async ({ page, browser }) => {
    await signInAsDm(page);
    await page.goto('/browse/character');
    const knight = page.getByRole('link').filter({ hasText: 'Zzribbon Fallen Knight' });
    await expect(knight.getByTestId('status-ribbon')).toHaveText('Deceased');
    await expect(page.getByRole('link').filter({ hasText: 'Zzribbon Secret Spy' }).getByTestId('status-ribbon')).toHaveText('Missing');
    await page.goto(`/wiki/${SLUGS[0]}`);
    await expect(page.getByTestId('status-ribbon').first()).toHaveText('Deceased');
    // The page heading is still just the name.
    await expect(page.getByRole('heading', { level: 1, name: 'Zzribbon Fallen Knight', exact: true })).toBeVisible();

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const bodies = recordApi(context);
    const player = await context.newPage();
    await enrollAsPlayer(player, 'Ribbon Probe');
    await player.goto('/browse/character');
    await expect(player.getByRole('link').filter({ hasText: 'Zzribbon Fallen Knight' }).getByTestId('status-ribbon')).toHaveText('Deceased');
    const spy = player.getByRole('link').filter({ hasText: 'Zzribbon Secret Spy' });
    await expect(spy).toBeVisible();
    await expect(spy.getByTestId('status-ribbon')).toHaveCount(0);
    await noHorizontalOverflow(player);
    await player.goto(`/wiki/${SLUGS[1]}`);
    await expect(player.getByRole('heading', { level: 1, name: 'Zzribbon Secret Spy' })).toBeVisible();
    await expect(player.getByTestId('status-ribbon')).toHaveCount(0);
    for (const b of bodies) expect(b.body, b.url).not.toContain('presumed turned');
  });
});
