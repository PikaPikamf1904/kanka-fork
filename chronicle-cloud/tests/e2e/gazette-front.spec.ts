// The front page lays out the newest 40 printed stories and points to the archive for the rest;
// the archive still lists every printed story. Synthetic stories, LOCAL database only.
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { assertDisposableDatabase } from '../../scripts/local-targets.mjs';
import { enrollAsPlayer } from './support.ts';

const COUNT = 45;

async function asAdmin(sql: string) {
  await assertDisposableDatabase();
  const client = new pg.Client({ connectionString: 'postgres://supabase_admin@127.0.0.1:54322/postgres' });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  // Printed directly (triggers off) so the test does not depend on the review workflow.
  await asAdmin(`begin;
    set local session_replication_role = replica;
    delete from public.articles where slug like 'front-test-%';
    insert into public.articles (slug, type, title, summary, visibility, status, published_at)
      select 'front-test-' || g, 'news', 'Front Test Story ' || g, 'Synthetic.', 'players', 'published', now() + make_interval(mins => g)
      from generate_series(1, ${COUNT}) g;
    insert into public.news_stories (article_id, issue_number, review_state)
      select id, 9000 + substring(slug from 12)::int, 'approved' from public.articles where slug like 'front-test-%';
    commit;`);
});
test.afterAll(async () => {
  await asAdmin(`delete from public.articles where slug like 'front-test-%'`);
});

test('the front page shows the newest 40 stories and the archive keeps them all', async ({ page }) => {
  await enrollAsPlayer(page, 'Front Page Reader');
  await page.goto('/news');
  await expect(page.getByRole('link', { name: `Front Test Story ${COUNT}`, exact: true }).first()).toBeVisible();
  // The oldest synthetic stories are beyond the newest 40 and are not laid out on the front page.
  await expect(page.getByRole('link', { name: 'Front Test Story 1', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Older stories are in the Archive' })).toBeVisible();

  await page.getByRole('link', { name: 'Older stories are in the Archive' }).click();
  await expect(page).toHaveURL(/\/news\/archive$/);
  await expect(page.getByRole('link', { name: 'Front Test Story 1', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: `Front Test Story ${COUNT}`, exact: true })).toBeVisible();
});
