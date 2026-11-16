import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, recordApi, signInAsDm } from './support.ts';

// Infobox field browse: three synthetic characters share "Race: Zzfactkin"; on the third the field
// is DM-only. The DM finds three pages, a player two, and never receives the hidden field.

const SLUGS = ['zz-facts-one', 'zz-facts-two', 'zz-facts-three'];

async function character(slug: string, title: string, fieldVisibility: 'players' | 'dm') {
  const [a] = await db<{ id: string }>(
    `insert into public.articles (slug, type, title, summary, visibility, status) values ($1, 'character', $2, 'Synthetic.', 'players', 'published') returning id`,
    [slug, title],
  );
  await db(`insert into public.infobox_fields (article_id, position, label, value, visibility) values ($1, 1, 'Race', 'Zzfactkin', $2)`, [a!.id, fieldVisibility]);
}

test.describe('Infobox field browse', () => {
  test.beforeEach(async () => {
    await db('delete from public.articles where slug = any($1)', [SLUGS]);
    await character(SLUGS[0]!, 'Zzfacts First', 'players');
    await character(SLUGS[1]!, 'Zzfacts Second', 'players');
    await character(SLUGS[2]!, 'Zzfacts Third', 'dm');
  });
  test.afterEach(() => db('delete from public.articles where slug = any($1)', [SLUGS]));

  test('a fact links to every page sharing it, as far as the reader may see', async ({ page, browser }) => {
    await signInAsDm(page);
    await page.goto(`/wiki/${SLUGS[0]}`);
    await page.getByRole('link', { name: 'Other pages with Race: Zzfactkin' }).click();
    await expect(page).toHaveURL(/\/facts\?label=Race&value=Zzfactkin$/);
    await expect(page.getByRole('heading', { name: 'Race: Zzfactkin' })).toBeVisible();
    await expect(page.locator('.facts-list li')).toHaveCount(3);

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const bodies = recordApi(context);
    const player = await context.newPage();
    await enrollAsPlayer(player, 'Facts Probe');
    await player.goto('/facts?label=race&value=zzfactkin');
    await expect(player.locator('.facts-list li')).toHaveCount(2);
    await expect(player.getByText('Zzfacts Third')).toHaveCount(0);
    await noHorizontalOverflow(player);
    // The third page itself is public; only its Race field is DM-only. No field of it may arrive.
    const [third] = await db<{ id: string }>('select id from public.articles where slug = $1', [SLUGS[2]]);
    const fieldResponses = bodies.filter((b) => b.url.includes('/infobox_fields'));
    expect(fieldResponses.length).toBeGreaterThan(0);
    for (const b of fieldResponses) expect(b.body, b.url).not.toContain(third!.id);
  });
});
