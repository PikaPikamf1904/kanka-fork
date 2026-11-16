import path from 'node:path';
import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, signInAsDm } from './support.ts';

// The DM's "What players can see" audit, against probe pages this test adds and removes: a page
// players can read that links to and names a DM-only page, the DM-only page itself, a published
// player page whose only section is DM-only, and a player page still in draft.
// Documentation screenshots are written only with SAVE_DOC_SHOTS=1, so ordinary runs leave the tree clean.

const docsShots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');
const SLUGS = ['zz-vis-harbour-gossip', 'zz-vis-masked-regent', 'zz-vis-blank-shrine', 'zz-vis-coming-fair'];

async function page(slug: string, title: string, visibility: 'players' | 'dm', status: 'published' | 'draft', section?: { body: string; visibility: 'players' | 'dm' }) {
  const [a] = await db<{ id: string }>(
    `insert into public.articles (slug, type, title, summary, visibility, status) values ($1, 'location', $2, '', $3, $4) returning id`,
    [slug, title, visibility, status],
  );
  if (section) {
    await db(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 1, 'Gossip', $2, $3, 'published')`,
      [a!.id, section.body, section.visibility]);
  }
  return a!.id;
}

const clean = async () => {
  await db('delete from public.articles where slug = any($1)', [SLUGS]);
  await db(`delete from public.categories where slug = 'zz-vis-order'`);
};

test.describe('What players can see', () => {
  test.beforeEach(async () => {
    await clean();
    await page(SLUGS[1]!, 'Masked Regent Zzvis', 'dm', 'published', { body: 'Secret.', visibility: 'dm' });
    await page(SLUGS[0]!, 'Harbour Gossip Zzvis', 'players', 'published', {
      body: 'Sailors say [[zz-vis-masked-regent|someone]] pays the guards. Others whisper of the masked regent zzvis at night.',
      visibility: 'players',
    });
    await page(SLUGS[2]!, 'Blank Shrine Zzvis', 'players', 'published', { body: 'Only the DM knows.', visibility: 'dm' });
    await page(SLUGS[3]!, 'Coming Fair Zzvis', 'players', 'draft');
    const [cat] = await db<{ id: string }>(`insert into public.categories (slug, name, kind, visibility) values ('zz-vis-order', 'Zzvis Secret Order', 'category', 'players') returning id`);
    const [regent] = await db<{ id: string }>('select id from public.articles where slug = $1', [SLUGS[1]]);
    await db('insert into public.article_categories (article_id, category_id) values ($1, $2)', [regent!.id, cat!.id]);
  });
  test.afterEach(clean);

  test('the DM sees totals and possible leaks, with links to fix them; players cannot open it', async ({ page: dm, browser }) => {
    await signInAsDm(dm);
    await dm.goto('/dm');
    await dm.getByRole('link', { name: 'What players can see' }).first().click();
    await expect(dm).toHaveURL(/\/dm\/visibility$/);
    await expect(dm.getByRole('heading', { name: 'What players can see' })).toBeVisible();

    const links = dm.getByTestId('vis-link');
    await links.locator('summary').click();
    const leak = links.getByRole('listitem').filter({ hasText: 'Harbour Gossip Zzvis' });
    await expect(leak).toContainText('Gossip');
    await expect(leak.getByRole('link', { name: 'Masked Regent Zzvis', exact: true })).toHaveAttribute('href', `/wiki/${SLUGS[1]}`);
    await expect(leak.getByRole('link', { name: 'Edit Harbour Gossip Zzvis' })).toHaveAttribute('href', `/dm/edit/${SLUGS[0]}`);
    // The same hidden page is linked from that section, so it is not listed again as a mention.
    const mentions = dm.getByTestId('vis-mention');
    await mentions.locator('summary').click();
    await expect(mentions.getByRole('listitem').filter({ hasText: 'Harbour Gossip Zzvis' })).toHaveCount(0);

    const empty = dm.getByTestId('vis-empty');
    await empty.locator('summary').click();
    await expect(empty.getByRole('listitem').filter({ hasText: 'Blank Shrine Zzvis' })).toHaveCount(1);
    const draft = dm.getByTestId('vis-draft');
    await draft.locator('summary').click();
    await expect(draft.getByRole('listitem').filter({ hasText: 'Coming Fair Zzvis' })).toHaveCount(1);

    // A player-visible category whose only page is hidden is flagged by name.
    const category = dm.getByTestId('vis-category');
    await category.locator('summary').click();
    await expect(category.getByRole('listitem').filter({ hasText: 'Zzvis Secret Order' })).toHaveCount(1);

    // Totals are given as text, not only as coloured bars.
    await expect(dm.getByText(/\d+ players can read · \d+ players, draft · \d+ DM only/).first()).toBeVisible();

    // The kind filter keeps the address shareable and narrows the findings.
    await dm.getByLabel('Kind of page').selectOption('character');
    await expect(dm).toHaveURL(/type=character/);
    await expect(dm.getByTestId('vis-link').getByRole('listitem').filter({ hasText: 'Harbour Gossip Zzvis' })).toHaveCount(0);

    if (process.env.SAVE_DOC_SHOTS === '1') {
      await dm.getByLabel('Kind of page').selectOption('');
      for (const id of ['vis-link', 'vis-empty']) await dm.getByTestId(id).evaluate((el) => ((el as HTMLDetailsElement).open = true));
      await dm.setViewportSize({ width: 1280, height: 900 });
      await dm.screenshot({ path: path.join(docsShots, 'dm-visibility.png') });
    }

    // Phone width: nothing spills sideways.
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await signInAsDm(phone);
    await phone.goto('/dm/visibility');
    await expect(phone.getByTestId('vis-strip')).toBeVisible();
    await noHorizontalOverflow(phone);

    // A player gets nothing: no link, no page, no audit data.
    const player = await (await browser.newContext()).newPage();
    await enrollAsPlayer(player, 'Visibility Probe');
    await expect(player.getByRole('link', { name: 'What players can see' })).toHaveCount(0);
    await player.goto('/dm/visibility');
    await expect(player.getByRole('heading', { name: 'What players can see' })).toHaveCount(0);
    await expect(player.getByText('Masked Regent Zzvis')).toHaveCount(0);
  });
});
