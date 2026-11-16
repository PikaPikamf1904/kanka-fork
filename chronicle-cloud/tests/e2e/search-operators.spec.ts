import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, signInAsDm } from './support.ts';

// Search operators: type:, category:, quoted phrases and exclusions, on pages made and removed here
// (one public character, one public location, one DM-only character, all mentioning "zzopquill").

const SLUGS = ['zz-op-scribe', 'zz-op-library', 'zz-op-spy'];

async function make(slug: string, title: string, type: string, visibility: 'players' | 'dm', body: string) {
  const [a] = await db<{ id: string }>(`insert into public.articles (slug, type, title, summary, visibility, status) values ($1, $2, $3, '', $4, 'published') returning id`, [slug, type, title, visibility]);
  await db(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 1, 'About', $2, $3, 'published')`, [a!.id, body, visibility]);
  return a!.id;
}

test.describe('Search operators', () => {
  test.beforeEach(async () => {
    await db('delete from public.articles where slug = any($1)', [SLUGS]);
    await db(`delete from public.categories where slug = 'zz-op-guild'`);
    const scribe = await make(SLUGS[0]!, 'Zzop Scribe', 'character', 'players', 'The zzopquill guild scribe writes in red ink.');
    await make(SLUGS[1]!, 'Zzop Library', 'location', 'players', 'Home of the zzopquill guild archive.');
    await make(SLUGS[2]!, 'Zzop Spy', 'character', 'dm', 'A zzopquill guild spy in red.');
    const [cat] = await db<{ id: string }>(`insert into public.categories (slug, name, kind, visibility) values ('zz-op-guild', 'Zzop Guild', 'category', 'players') returning id`);
    await db(`insert into public.article_categories (article_id, category_id) values ($1, $2)`, [scribe, cat!.id]);
  });
  test.afterEach(async () => {
    await db('delete from public.articles where slug = any($1)', [SLUGS]);
    await db(`delete from public.categories where slug = 'zz-op-guild'`);
  });

  test('kinds, categories, phrases and exclusions narrow the results', async ({ page, browser }) => {
    await signInAsDm(page);
    const titles = () => page.locator('.search-results .search-title').allTextContents();
    await page.goto('/search?q=zzopquill');
    await expect(page.locator('.search-results li')).toHaveCount(3);
    // Kind chips with counts, then the operator they add.
    await page.getByRole('link', { name: /Characters \(2\)/ }).click();
    await expect(page).toHaveURL(/type%3Acharacter/);
    await expect.poll(titles).toEqual(expect.arrayContaining(['Zzop Scribe', 'Zzop Spy']));
    await expect(page.locator('.search-results li')).toHaveCount(2);

    const form = page.locator('main#main').getByRole('search');
    await form.getByLabel('Search the wiki').fill('zzopquill -archive category:"Zzop Guild"');
    await form.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.search-results li')).toHaveCount(1);
    await expect(page.locator('.search-results .search-title')).toHaveText('Zzop Scribe');

    await page.goto('/search?q=' + encodeURIComponent('"red ink"'));
    await expect.poll(titles).toEqual(['Zzop Scribe']);
    await page.goto('/search?q=' + encodeURIComponent('type:dragons zzopquill'));
    await expect(page.getByText('Not understood: type:dragons')).toBeVisible();

    // Filters only ever narrow what Row Level Security returned: the player never sees the spy.
    const player = await (await browser.newContext()).newPage();
    await enrollAsPlayer(player, 'Operator Probe');
    await player.goto('/search?q=' + encodeURIComponent('zzopquill type:character'));
    await expect(player.locator('.search-results .search-title')).toHaveText(['Zzop Scribe']);
    await expect(player.getByText('Zzop Spy')).toHaveCount(0);
  });
});
