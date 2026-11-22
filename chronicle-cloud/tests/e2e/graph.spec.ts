import path from 'node:path';
import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, recordApi, signInAsDm } from './support.ts';

// Knowledge graph, with pages made and removed here: two public pages joined by a connection, a
// third public page whose visible text links to a DM-only page, and that DM-only page connected to
// the first. The DM sees four pages; a player three, and never the hidden page's name.

const docsShots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');
const S = { a: 'zz-graph-alder', b: 'zz-graph-birch', c: 'zz-graph-cedar', h: 'zz-graph-hidden-vault', l: 'zz-graph-loner' };

async function pageRow(slug: string, title: string, type: string, visibility: 'players' | 'dm', body = '') {
  const [r] = await db<{ id: string }>(
    `insert into public.articles (slug, type, title, summary, visibility, status) values ($1, $2, $3, 'A synthetic page for the graph.', $4, 'published') returning id`,
    [slug, type, title, visibility],
  );
  if (body) await db(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 1, 'Notes', $2, $3, 'published')`, [r!.id, body, visibility]);
  return r!.id;
}

const clean = () => db('delete from public.articles where slug = any($1)', [Object.values(S)]);

test.describe('Knowledge graph', () => {
  test.beforeEach(async () => {
    await clean();
    const a = await pageRow(S.a, 'Zzgraph Alder', 'character', 'players');
    const b = await pageRow(S.b, 'Zzgraph Birch', 'location', 'players');
    await pageRow(S.c, 'Zzgraph Cedar', 'lore', 'players', `Rumours point to [[${S.h}]] and to [[${S.a}]].`);
    const h = await pageRow(S.h, 'Zzgraph Hidden Vault', 'location', 'dm');
    await db(`insert into public.relations (source_article_id, target_article_id, kind, label, visibility) values ($1, $2, 'resides_in', '', 'players'), ($1, $3, 'knows', '', 'dm')`, [a, b, h]);
  });
  test.afterEach(clean);

  test('the DM sees every page; filters, search, preview and the list view work', async ({ page }) => {
    await signInAsDm(page);
    await page.goto(`/wiki/${S.a}`);
    await page.getByRole('link', { name: 'Show in the knowledge graph' }).click();
    await expect(page).toHaveURL(new RegExp(`/graph\\?focus=${S.a}`));
    await expect(page.getByTestId('graph-canvas')).toBeVisible();
    await expect(page.getByTestId('graph-count')).toHaveText('4 pages, 4 lines shown.');

    // Search and Enter opens the preview card for the first match.
    await page.getByPlaceholder('Find a page…').fill('birch');
    await page.getByPlaceholder('Find a page…').press('Enter');
    const preview = page.getByTestId('graph-preview');
    await expect(preview.getByRole('heading', { name: 'Zzgraph Birch' })).toBeVisible();
    await expect(preview).toContainText('A synthetic page for the graph.');
    await expect(preview.getByRole('link', { name: 'Open the page' })).toHaveAttribute('href', `/wiki/${S.b}`);
    // The relationship summary is built from the received graph.
    await expect(preview.getByTestId('graph-summary')).toContainText('Zzgraph Alder (resides in this)');
    await expect(page.getByTestId('graph-key')).toContainText('Resides in');
    await expect(page.getByTestId('graph-key')).toContainText('Wiki link (mentions)');
    const highlight = page.getByRole('button', { name: 'Highlight connected' });
    await highlight.click();
    await expect(highlight).toHaveAttribute('aria-pressed', 'true');
    await highlight.click();
    await expect(highlight).toHaveAttribute('aria-pressed', 'false');

    // Keyboard: Tab into the canvas, arrow keys move between pages, Enter opens the preview.
    await preview.getByRole('button', { name: 'Close' }).click();
    await expect(preview).toHaveCount(0);
    const canvas = page.getByTestId('graph-canvas');
    await canvas.focus();
    const status = page.getByRole('status').filter({ hasText: 'Press Enter for details' });
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight']) {
      await page.keyboard.press(key);
      if (await status.count()) break;
    }
    await expect(status).toContainText('connection');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('graph-preview')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('graph-preview')).toHaveCount(0);

    // The list view is the text version of the same graph.
    await page.getByRole('button', { name: 'Show as a list' }).click();
    const list = page.getByTestId('graph-list');
    await expect(list.locator('.graph-list-head').getByRole('link', { name: 'Zzgraph Hidden Vault' })).toBeVisible();
    await expect(list).toContainText('Resides in');
    await expect(list.locator('.graph-list-summary').first()).toContainText(/Resides in|resides in this|knows|links to|mentioned by/i);

    // Kind filters are kept in the address and remembered after a reload.
    await page.getByRole('button', { name: 'Show as a graph' }).click();
    // With no filter, "All kinds" is the pressed choice and no single kind claims to be.
    await expect(page.getByRole('group', { name: 'Kinds of page shown' }).getByRole('button', { name: 'All kinds' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('group', { name: 'Kinds of page shown' }).getByRole('button', { name: 'Characters' })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('group', { name: 'Kinds of page shown' }).getByRole('button', { name: 'Characters' }).click();
    await expect(page).toHaveURL(/types=character/);
    await page.goto('/graph');
    await expect(page.getByRole('group', { name: 'Kinds of page shown' }).getByRole('button', { name: 'Characters' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('group', { name: 'Kinds of page shown' }).getByRole('button', { name: 'All kinds' })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('group', { name: 'Kinds of page shown' }).getByRole('button', { name: 'All kinds' }).click();
    await expect(page).not.toHaveURL(/types=/);

    if (process.env.SAVE_DOC_SHOTS === '1') {
      await page.setViewportSize({ width: 1280, height: 860 });
      await page.goto(`/graph?focus=${S.a}&depth=2`);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(docsShots, 'knowledge-graph.png') });
    }
  });

  test('unconnected pages sit in a ring when included, and are left out otherwise', async ({ page }) => {
    await pageRow(S.l, 'Zzgraph Loner', 'item', 'players');
    await signInAsDm(page);
    await page.goto('/graph');
    // Other specs may leave synthetic pages behind, so compare with the count we start from.
    const count = page.getByTestId('graph-count');
    await expect(count).toContainText('lines shown');
    await page.waitForLoadState('networkidle');
    const before = Number((await count.textContent())!.match(/^(\d+) pages/)![1]);
    await page.getByRole('button', { name: 'Include unconnected pages' }).click();
    // Including unconnected pages adds at least this test's own page (leftover fixtures may add more).
    await expect.poll(async () => Number((await count.textContent())!.match(/^(\d+) pages/)![1])).toBeGreaterThan(before);
    await expect(count).toContainText(`lines`);
    await expect(page.getByTestId('graph-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Show as a list' }).click();
    await expect(page.getByTestId('graph-list').getByText('Zzgraph Loner')).toBeVisible();
    await page.goto('/graph'); // the choice is remembered; put it back for other tests
    await page.getByRole('button', { name: 'Include unconnected pages' }).click();
    await expect(count).toContainText(`${before} pages`);
  });

  test('a player never receives the hidden page, its connection or its name', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const bodies = recordApi(context);
    const player = await context.newPage();
    await enrollAsPlayer(player, 'Graph Probe');
    await player.goto(`/graph?focus=${S.a}&view=list`);
    const heads = player.getByTestId('graph-list').locator('.graph-list-head');
    await expect(heads.getByRole('link', { name: 'Zzgraph Birch' })).toBeVisible();
    await expect(heads.getByRole('link', { name: 'Zzgraph Cedar' })).toBeVisible();
    await expect(player.getByText('Zzgraph Hidden Vault')).toHaveCount(0);
    await expect(player.getByTestId('graph-count')).toHaveText('3 pages, 2 lines shown.');
    await player.getByRole('button', { name: 'Show as a graph' }).click();
    await expect(player.getByTestId('graph-canvas')).toBeVisible();
    await player.getByPlaceholder('Find a page…').fill('alder');
    await player.getByPlaceholder('Find a page…').press('Enter');
    await expect(player.getByTestId('graph-summary')).toContainText('Zzgraph Birch');
    await expect(player.getByTestId('graph-summary')).not.toContainText('Hidden');
    await noHorizontalOverflow(player);
    for (const b of bodies) expect(b.body, b.url).not.toContain('Zzgraph Hidden Vault');
  });

  test('every saved connection is in the graph, with its own words, and DM-only ones never reach a player', async ({ browser, page }) => {
    const [a, b, h] = (await db<{ id: string }>(`select id from public.articles where slug = any($1) order by array_position($1, slug)`, [[S.a, S.b, S.h]])).map((r) => r.id);
    // Two more saved connections between the same two pages, one with a custom description.
    await db(`insert into public.relations (source_article_id, target_article_id, kind, label, visibility)
      values ($1, $2, 'related_to', 'Zzgraph shared the ferry', 'players'), ($1, $2, 'ally_of', '', 'players'),
             ($1, $3, 'related_to', 'Zzgraph secret tunnel', 'dm')`, [a, b, h]);
    const ours = (rows: string[]) => rows.filter((t) => t.includes('Zzgraph'));

    // The Connections page and the graph's directory list the same connections, for the DM...
    await signInAsDm(page);
    await page.goto('/connections');
    await expect(page.locator('.relation-list li').filter({ hasText: 'Zzgraph' })).toHaveCount(5);
    await page.goto(`/graph?focus=${S.a}&depth=1`);
    await expect(page.getByTestId('graph-count')).toContainText('lines shown');
    await page.getByRole('button', { name: /Browse saved connections/ }).click();
    const directory = page.getByTestId('graph-connections-directory');
    const dmRows = ours(await directory.locator('li').allTextContents());
    expect(dmRows).toHaveLength(5);
    expect(dmRows.some((t) => t.includes('(Zzgraph shared the ferry)'))).toBe(true);
    expect(dmRows.some((t) => t.includes('(Zzgraph secret tunnel)'))).toBe(true);
    // Each is a line in the focused graph too: three between Alder and Birch and two to the vault,
    // plus Cedar's two wiki links (4 + 3 extra connections).
    await expect(page.getByTestId('graph-count')).toHaveText('4 pages, 7 lines shown.');
    // Focus in graph goes to the connection's page.
    await directory.locator('li').filter({ hasText: 'Zzgraph shared the ferry' }).getByRole('button', { name: 'Focus in graph' }).click();
    await expect(page).toHaveURL(new RegExp(`focus=${S.a}`));

    // ...and for a player, who gets only the three visible ones and never the hidden words.
    const context = await browser.newContext();
    const bodies = recordApi(context);
    const player = await context.newPage();
    await enrollAsPlayer(player, 'Graph Parity Probe');
    await player.goto('/connections');
    await expect(player.locator('.relation-list li').filter({ hasText: 'Zzgraph' })).toHaveCount(3);
    await player.goto('/graph');
    await expect(player.getByTestId('graph-count')).toContainText('lines shown');
    await player.getByRole('button', { name: /Browse saved connections/ }).click();
    const playerRows = ours(await player.getByTestId('graph-connections-directory').locator('li').allTextContents());
    expect(playerRows).toHaveLength(3);
    expect(playerRows.some((t) => t.includes('(Zzgraph shared the ferry)'))).toBe(true);
    for (const t of playerRows) expect(t).not.toContain('Hidden Vault');
    for (const r of bodies) {
      expect(r.body, r.url).not.toContain('Zzgraph secret tunnel');
      expect(r.body, r.url).not.toContain('Zzgraph Hidden Vault');
    }
    await context.close();
  });

  test('a large wiki (800 pages) lays out off the main thread and stays usable', async ({ page }) => {
    await db(`insert into public.articles (slug, type, title, summary, visibility, status)
      select 'zz-bulk-' || g, 'location', 'Zzbulk Place ' || g, '', 'players', 'published' from generate_series(1, 800) g`);
    await db(`insert into public.relations (source_article_id, target_article_id, kind, label, visibility)
      select a.id, b.id, 'related_to', '', 'players'
      from generate_series(1, 1600) g
      join public.articles a on a.slug = 'zz-bulk-' || (1 + (g * 7) % 800)
      join public.articles b on b.slug = 'zz-bulk-' || (1 + (g * 13 + 5) % 800)
      where a.id <> b.id on conflict do nothing`);
    try {
      await signInAsDm(page);
      const started = Date.now();
      await page.goto('/graph?types=location');
      await expect(page.getByText('· arranging…')).toHaveCount(0, { timeout: 20_000 });
      const took = Date.now() - started;
      test.info().annotations.push({ type: 'layout', description: `800 pages ready in ${took} ms (load and layout)` });
      await expect(page.getByTestId('graph-count')).toContainText('pages');
      // The page answers input while and after laying out.
      await page.getByPlaceholder('Find a page…').fill('Zzbulk Place 42');
      await page.getByPlaceholder('Find a page…').press('Enter');
      await expect(page.getByTestId('graph-preview').getByRole('heading', { name: /Zzbulk Place 42/ })).toBeVisible();
    } finally {
      await db(`delete from public.articles where slug like 'zz-bulk-%'`);
    }
  });
});
