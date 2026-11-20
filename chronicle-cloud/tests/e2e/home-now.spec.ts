// The home page's "now" cards ask the database for one session and a short list of stories instead of
// downloading every session and every Gazette story. They must still pick the same items.
import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer } from './support.ts';

const DATED = 'Home Test Latest Dated Session';
const UNDATED = 'Home Test Undated Later Session';

test.beforeAll(async () => {
  await db(`delete from public.articles where title = any($1)`, [[DATED, UNDATED]]);
  // A session with the latest play date, and a newer page with no play date: only a play date counts.
  await db(`insert into public.articles (slug, type, title, visibility, status, session_date, created_at)
    values ('home-test-latest-dated', 'session', $1, 'players', 'published', '2099-12-31', now() - interval '1 day'),
           ('home-test-undated-later', 'session', $2, 'players', 'published', null, now())`, [DATED, UNDATED]);
});
test.afterAll(async () => {
  await db(`delete from public.articles where title = any($1)`, [[DATED, UNDATED]]);
});

test('the latest played session and the newest printed headline, for a player', async ({ page }) => {
  const [expected] = await db<{ title: string }>(`
    select a.title from public.articles a join public.news_stories n on n.article_id = a.id
    where a.type = 'news' and a.status = 'published' and a.visibility = 'players'
    order by coalesce(n.issue_number, 0) desc, coalesce(a.published_at, a.updated_at) desc limit 1`);
  await enrollAsPlayer(page, 'Home Now Tester');
  await page.goto('/');
  const cards = page.locator('.now-big');
  await expect(cards.filter({ hasText: DATED })).toHaveCount(1);
  // The undated page may appear elsewhere (recently updated), never as the latest session.
  await expect(cards.filter({ hasText: UNDATED })).toHaveCount(0);
  if (expected) await expect(page.locator('.now-headline')).toHaveText(expected.title);
});
