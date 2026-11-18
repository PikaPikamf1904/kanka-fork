import path from 'node:path';
import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, signInAsDm } from './support.ts';

// DM Player Insights and the DM desk overview, from synthetic journal entries and feedback.

const docsShots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');
const SLUG = 'zz-insights-smith';

test.describe('Player insights', () => {
  test.beforeEach(async () => {
    await db(`delete from public.journal_entries where title like 'Zzinsight%'`);
    await db(`delete from public.feedback where body like 'Zzinsight%'`);
    await db('delete from public.articles where slug = $1', [SLUG]);
  });
  test.afterEach(async () => {
    await db(`delete from public.journal_entries where title like 'Zzinsight%'`);
    await db(`delete from public.feedback where body like 'Zzinsight%'`);
    await db('delete from public.articles where slug = $1', [SLUG]);
  });

  test('the DM sees goals, questions, suspicions and often-mentioned characters, labelled as speculation; players cannot open it', async ({ page, browser }) => {
    const ctx = await browser.newContext();
    const player = await ctx.newPage();
    await enrollAsPlayer(player, 'Insight Writer');
    const [member] = await db<{ user_id: string }>(`select user_id from public.campaign_members where display_name = 'Insight Writer' order by created_at desc limit 1`);
    const [smith] = await db<{ id: string }>(`insert into public.articles (slug, type, title, summary, visibility, status, published_at) values ($1, 'character', 'Zzinsight Smith', 'Synthetic.', 'players', 'published', now()) returning id`, [SLUG]);
    const entries = await db<{ id: string }>(`insert into public.journal_entries (user_id, title, body, entry_date, tags) values
      ($1, 'Zzinsight Find my brother', '', current_date, '{goal}'),
      ($1, 'Zzinsight Who paid the smith?', '', current_date, '{question,suspicion}') returning id`, [member!.user_id]);
    await db(`insert into public.journal_entry_links (entry_id, article_id) values ($1, $3), ($2, $3)`, [entries[0]!.id, entries[1]!.id, smith!.id]);
    await db(`insert into public.feedback (category, body, mode, author_id, author_name) values ('comfort', 'Zzinsight please less gore', 'named', $1, 'Insight Writer')`, [member!.user_id]);

    // Players get the not-found page.
    await player.goto('/dm/insights');
    await expect(player.getByRole('heading', { name: 'Player insights' })).toHaveCount(0);
    await ctx.close();

    await signInAsDm(page);
    await page.goto('/dm/insights');
    await expect(page.getByText('None of it is campaign fact.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Character goals' })).toContainText('Zzinsight Find my brother');
    await expect(page.getByRole('region', { name: 'Unanswered questions' })).toContainText('Zzinsight Who paid the smith?');
    await expect(page.getByRole('region', { name: /Suspicions/ })).toContainText('Insight Writer');
    await expect(page.getByRole('region', { name: 'Characters players keep writing about' }).getByRole('link', { name: 'Zzinsight Smith' })).toBeVisible();
    // Feedback is never an input.
    await expect(page.getByText('please less gore')).toHaveCount(0);
    if (process.env.SAVE_DOC_SHOTS === '1') await page.screenshot({ path: path.join(docsShots, 'dm-insights.png'), fullPage: true });

    // The DM desk overview counts, without showing feedback text.
    await page.goto('/dm');
    const overview = page.getByRole('region', { name: 'Players at a glance' });
    await expect(overview.getByRole('link', { name: /new boundaries or discomfort reports/ })).toContainText(/[1-9]/);
    await expect(overview).not.toContainText('gore');
  });
});
