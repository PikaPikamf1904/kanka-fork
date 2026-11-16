import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, recordApi, signInAsDm } from './support.ts';

// "Recently updated" with pages made and removed here. Both were published long ago. One gets a
// fresh edit to a section players can read; the other only to a DM-only section. A player sees the
// first as updated and never hears of the second edit; the DM sees both.

const SLUGS = ['zz-recent-harbour-board', 'zz-recent-quiet-shrine'];

async function oldPage(slug: string, title: string, sectionHeading: string, sectionVisibility: 'players' | 'dm') {
  const [a] = await db<{ id: string }>(
    `insert into public.articles (slug, type, title, summary, visibility, status, published_at) values ($1, 'location', $2, 'Synthetic.', 'players', 'published', '2020-01-01') returning id`,
    [slug, title],
  );
  await db(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 1, 'Long ago', 'Old text.', 'players', 'published')`, [a!.id]);
  // Triggers stamp published_at and updated_at with the current time. Backdate both in one
  // transaction with those two triggers off (DDL is transactional, so no other session ever sees
  // them disabled), so only the section added below is recent. The id comes from the database.
  await db(`begin;
    alter table public.article_sections disable trigger sections_touch;
    alter table public.articles disable trigger articles_published_at;
    update public.article_sections set updated_at = '2020-01-01' where article_id = '${a!.id}';
    update public.articles set published_at = '2020-01-01' where id = '${a!.id}';
    alter table public.article_sections enable trigger sections_touch;
    alter table public.articles enable trigger articles_published_at;
    commit;`);
  await db(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 2, $2, 'Fresh text.', $3, 'published')`, [a!.id, sectionHeading, sectionVisibility]);
}

test.describe('Recently updated', () => {
  test.beforeEach(async () => {
    await db('delete from public.articles where slug = any($1)', [SLUGS]);
    await oldPage(SLUGS[0]!, 'Zzrecent Harbour Board', 'Posted notices', 'players');
    await oldPage(SLUGS[1]!, 'Zzrecent Quiet Shrine', 'Zzrecent secret plans', 'dm');
  });
  test.afterEach(() => db('delete from public.articles where slug = any($1)', [SLUGS]));

  test('players see only changes to text they can read', async ({ page, browser }) => {
    await signInAsDm(page);
    await page.getByRole('link', { name: 'Recently updated' }).first().click();
    await expect(page).toHaveURL(/\/recent$/);
    const today = page.getByRole('region', { name: 'Today' });
    await expect(today.getByTestId('recent-entry').filter({ hasText: 'Zzrecent Harbour Board' })).toContainText('Updated: Posted notices');
    await expect(today.getByTestId('recent-entry').filter({ hasText: 'Zzrecent Quiet Shrine' })).toContainText('Zzrecent secret plans');
    // Filtering by kind keeps the address and narrows the list.
    await page.getByRole('group', { name: 'Kind of page' }).getByRole('button', { name: 'Locations' }).click();
    await expect(page).toHaveURL(/type=location/);
    await expect(page.getByTestId('recent-entry').filter({ hasText: 'Zzrecent Harbour Board' })).toHaveCount(1);
    await page.getByRole('group', { name: 'Kind of page' }).getByRole('button', { name: 'Characters' }).click();
    await expect(page.getByTestId('recent-entry').filter({ hasText: 'Zzrecent Harbour Board' })).toHaveCount(0);

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const bodies = recordApi(context);
    const player = await context.newPage();
    await enrollAsPlayer(player, 'Recent Probe');
    await player.goto('/recent');
    const ptoday = player.getByRole('region', { name: 'Today' });
    await expect(ptoday.getByTestId('recent-entry').filter({ hasText: 'Zzrecent Harbour Board' })).toContainText('Updated: Posted notices');
    // The shrine's only fresh edit is DM-only: for this player it is not updated today (it may still be
    // listed further down under its 2020 publication date), and the hidden heading never arrives.
    await expect(ptoday.getByTestId('recent-entry').filter({ hasText: 'Zzrecent Quiet Shrine' })).toHaveCount(0);
    await expect(player.getByText('Zzrecent secret plans')).toHaveCount(0);
    await noHorizontalOverflow(player);
    for (const b of bodies) expect(b.body, b.url).not.toContain('Zzrecent secret plans');
  });
});
