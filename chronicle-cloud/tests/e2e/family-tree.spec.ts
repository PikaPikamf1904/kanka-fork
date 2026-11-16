import path from 'node:path';
import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, recordApi, signInAsDm } from './support.ts';

// A synthetic family across three generations, made and removed by this test. One relative is a
// DM-only page and one connection is DM-only: the DM sees both, a player sees neither, on screen or
// in any response. Documentation screenshots only with SAVE_DOC_SHOTS=1.

const docsShots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');
const P = (s: string) => `zz-fam-${s}`;
const PEOPLE: [string, string, 'players' | 'dm'][] = [
  ['elder', 'Zzfam Elder Ashby', 'players'],
  ['mother', 'Zzfam Mira Ashby', 'players'],
  ['father', 'Zzfam Tolan Reed', 'players'],
  ['hero', 'Zzfam Wren Ashby', 'players'],
  ['spouse', 'Zzfam Kael Thorn', 'players'],
  ['brother', 'Zzfam Bram Ashby', 'players'],
  ['child', 'Zzfam Lio Ashby', 'players'],
  ['secret', 'Zzfam Hidden Heir', 'dm'],
];
const SLUGS = PEOPLE.map(([k]) => P(k));

async function setUp() {
  await db('delete from public.articles where slug = any($1)', [SLUGS]);
  const id: Record<string, string> = {};
  for (const [k, title, visibility] of PEOPLE) {
    const [r] = await db<{ id: string }>(
      `insert into public.articles (slug, type, title, summary, visibility, status) values ($1, 'character', $2, 'A synthetic relative.', $3, 'published') returning id`,
      [P(k), title, visibility],
    );
    id[k] = r!.id;
  }
  const rel = (kind: string, a: string, b: string, visibility: 'players' | 'dm' = 'players') =>
    db(`insert into public.relations (source_article_id, target_article_id, kind, label, visibility) values ($1, $2, $3, '', $4)`, [id[a], id[b], kind, visibility]);
  await rel('parent_of', 'elder', 'mother');
  await rel('parent_of', 'mother', 'hero');
  await rel('parent_of', 'father', 'hero');
  await rel('parent_of', 'mother', 'brother');
  await rel('spouse_of', 'hero', 'spouse');
  await rel('parent_of', 'hero', 'child');
  await rel('parent_of', 'hero', 'secret'); // to a DM-only page
  await rel('sibling_of', 'brother', 'spouse', 'dm'); // a DM-only connection between readable people
}

test.describe('Family tree', () => {
  test.beforeEach(setUp);
  test.afterEach(() => db('delete from public.articles where slug = any($1)', [SLUGS]));

  test('the DM sees the whole family; a player never sees the hidden relative or connection', async ({ page, browser }) => {
    await signInAsDm(page);
    await page.goto(`/wiki/${P('hero')}`);
    const panel = page.getByRole('region', { name: 'Family' });
    await expect(panel.getByTestId('family-svg')).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Zzfam Hidden Heir, child of Zzfam Wren Ashby' })).toBeVisible();
    // On the child's page, the connection reads from the child's side.
    await page.goto(`/wiki/${P('child')}`);
    await expect(page.locator('.connections dt', { hasText: 'Child of' })).toBeVisible();

    await page.goto(`/family/${P('hero')}`);
    const tree = page.getByTestId('family-svg');
    for (const name of ['Zzfam Elder Ashby, grandparent of Zzfam Wren Ashby', 'Zzfam Mira Ashby, parent of Zzfam Wren Ashby', 'Zzfam Kael Thorn, spouse of Zzfam Wren Ashby', 'Zzfam Bram Ashby, sibling of Zzfam Wren Ashby', 'Zzfam Lio Ashby, child of Zzfam Wren Ashby']) {
      await expect(tree.getByRole('link', { name })).toBeVisible();
    }
    // The text list carries the same family for screen readers and small screens.
    await expect(page.getByRole('region', { name: 'Family of Zzfam Wren Ashby' }).getByRole('link', { name: 'Zzfam Elder Ashby' })).toBeVisible();

    // Zoom and reset change only the view.
    const canvas = page.getByTestId('family-canvas');
    const before = await canvas.getAttribute('transform');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(canvas).not.toHaveAttribute('transform', before!);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(canvas).toHaveAttribute('transform', before!);

    // Keyboard: Tab to a relative and press Enter to open their page.
    await tree.getByRole('link', { name: /^Zzfam Lio Ashby, child/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/wiki/${P('child')}$`));

    if (process.env.SAVE_DOC_SHOTS === '1') {
      await page.goto(`/family/${P('hero')}`);
      await expect(tree).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 860 });
      await page.screenshot({ path: path.join(docsShots, 'family-tree-desktop.png') });
    }

    // A player: the hidden relative and the hidden connection never arrive.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const bodies = recordApi(context);
    const player = await context.newPage();
    await enrollAsPlayer(player, 'Family Probe');
    await player.goto(`/family/${P('hero')}`);
    const ptree = player.getByTestId('family-svg');
    await expect(ptree.getByRole('link', { name: /^Zzfam Lio Ashby/ })).toBeVisible();
    await expect(ptree.getByRole('link', { name: /Hidden Heir/ })).toHaveCount(0);
    await expect(player.getByText('Zzfam Hidden Heir')).toHaveCount(0);
    // Bram and Kael are both readable, but the connection between them is DM-only: no sibling line.
    await expect(ptree.locator('.family-sibling_of')).toHaveCount(0);
    await noHorizontalOverflow(player);
    await player.goto(`/wiki/${P('hero')}`);
    await expect(player.getByRole('region', { name: 'Family' }).getByTestId('family-svg')).toBeVisible();
    for (const b of bodies) {
      expect(b.body, b.url).not.toContain('Hidden Heir');
      expect(b.body, b.url).not.toContain(P('secret'));
    }
    if (process.env.SAVE_DOC_SHOTS === '1') {
      await player.goto(`/family/${P('hero')}`);
      await expect(ptree).toBeVisible();
      await player.screenshot({ path: path.join(docsShots, 'family-tree-phone.png') });
    }
  });
});
