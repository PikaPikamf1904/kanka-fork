// The returning-player home page: the session card is honest about order, open quests come first,
// and one failing part does not blank the page.
import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow } from './support.ts';

const TITLES = ['Prev Test Open Quest', 'Prev Test Done Quest', 'Prev Test Unlisted Session'];

test.beforeAll(async () => {
  await db(`delete from public.articles where title = any($1)`, [TITLES]);
  await db(`insert into public.articles (slug, type, title, visibility, status, summary) values
    ('prev-test-open-quest', 'quest', $1, 'players', 'published', 'Still hanging.'),
    ('prev-test-done-quest', 'quest', $2, 'players', 'published', 'Wrapped up.'),
    ('prev-test-unlisted-session', 'session', $3, 'players', 'published', 'A session with no date and no number.')`, TITLES);
  await db(`insert into public.infobox_fields (article_id, label, value, visibility)
    select id, 'Status', case when slug = 'prev-test-open-quest' then 'Open / unresolved' else 'Completed: done' end, 'players'
    from public.articles where slug in ('prev-test-open-quest', 'prev-test-done-quest')`);
});
test.afterAll(async () => {
  await db(`delete from public.articles where title = any($1)`, [TITLES]);
});

test('a session with no known order is not called the latest', async ({ page }) => {
  await enrollAsPlayer(page, 'Previously Tester');
  await page.goto('/');
  const card = page.locator('.now-session');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'From the session journals' })).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Latest session' })).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'Read the session journal →' })).toBeVisible();
});

test('open quests are listed with their status; finished ones are only counted', async ({ page }) => {
  await enrollAsPlayer(page, 'Threads Tester');
  await page.goto('/');
  const panel = page.locator('section.panel', { has: page.getByRole('heading', { name: 'Open threads' }) });
  await expect(panel.getByRole('link', { name: TITLES[0]! })).toBeVisible();
  await expect(panel.getByText('Open / unresolved').first()).toBeVisible();
  await expect(panel.getByRole('link', { name: TITLES[1]! })).toHaveCount(0);
  await expect(panel.getByText(/finished quest/)).toBeVisible();
});

test('one failing request leaves the rest of the home page, with a retry', async ({ page }) => {
  await enrollAsPlayer(page, 'Resilience Tester');
  await page.route('**/rest/v1/maps*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }));
  await page.goto('/');
  await expect(page.getByTestId('home-partial')).toContainText('the maps');
  await expect(page.getByTestId('home-partial').getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The company' })).toBeVisible();
});

test('the home page fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enrollAsPlayer(page, 'Phone Tester');
  await page.goto('/');
  await expect(page.locator('.quick-bar')).toBeVisible();
  await noHorizontalOverflow(page);
});
