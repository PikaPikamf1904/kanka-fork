import path from 'node:path';
import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, recordApi, signInAsDm } from './support.ts';

// Knowledge Studio: a player builds a collection with topics, a quote, a note and a cited summary,
// exports it, shares it read-only, and a page hidden later is no longer named. Synthetic pages.

const docsShots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');
const S = { a: 'zz-studio-alder', b: 'zz-studio-birch', c: 'zz-studio-cedar' };

test.describe('Knowledge Studio', () => {
  test.beforeEach(async () => {
    await db(`delete from public.research_collections where title like 'Zzstudio%'`);
    await db('delete from public.articles where slug = any($1)', [Object.values(S)]);
    const ins = (slug: string, title: string) =>
      db<{ id: string }>(`insert into public.articles (slug, type, title, summary, visibility, status) values ($1, 'character', $2, 'A synthetic page.', 'players', 'published') returning id`, [slug, title]);
    const [a] = await ins(S.a, 'Zzstudio Alder');
    await ins(S.b, 'Zzstudio Birch');
    const [c] = await ins(S.c, 'Zzstudio Cedar');
    await db(`insert into public.relations (source_article_id, target_article_id, kind, label, visibility) values ($1, $2, 'ally_of', '', 'players')`, [a!.id, c!.id]);
  });
  test.afterEach(async () => {
    await db(`delete from public.research_collections where title like 'Zzstudio%'`);
    await db('delete from public.articles where slug = any($1)', [Object.values(S)]);
  });

  test('build, cite, export and share a collection; hidden pages are never named', async ({ browser }) => {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    await enrollAsPlayer(page, 'Studio Researcher');
    await page.goto('/studio');
    await page.getByLabel('New collection').fill('Zzstudio Who funds the cult?');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Zzstudio Who funds the cult?' })).toBeVisible();

    for (const name of ['Zzstudio Alder', 'Zzstudio Birch']) {
      await page.getByLabel('Add a page').fill(name);
      await page.getByRole('button', { name: new RegExp(`^Add ${name}`) }).click();
      await expect(page.getByTestId('studio-source').filter({ hasText: name })).toBeVisible();
    }
    // Related pages come from connections, and only readable ones.
    await expect(page.getByRole('region', { name: 'Related pages' }).getByRole('link', { name: 'Zzstudio Cedar' })).toBeVisible();

    const alder = page.getByTestId('studio-source').filter({ hasText: 'Zzstudio Alder' });
    await alder.getByText('Topic, quote and note').click();
    await alder.getByLabel('Topic').fill('Suspects');
    await alder.getByLabel('Quote from the page').fill('A synthetic page.');
    await alder.getByLabel('Your note').fill('Seen near the docks twice.');
    await alder.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { level: 3, name: 'Suspects' })).toBeVisible();
    await expect(page.getByText('From Zzstudio Alder')).toBeVisible();

    await page.getByLabel('New summary').fill('What we know');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const summary = page.getByTestId('studio-summary').filter({ hasText: 'What we know' });
    await summary.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel(/Summary \(cite sources/).fill('Alder is involved [1], perhaps with Birch [2].');
    await page.getByRole('button', { name: 'Save', exact: true }).last().click();
    await expect(page.getByText('Cites sources 1, 2.')).toBeVisible();

    await page.getByLabel('Search this collection').fill('docks');
    await expect(page.getByTestId('studio-source')).toHaveCount(1);
    await page.getByLabel('Search this collection').fill('');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export (Markdown)' }).click();
    const file = await download;
    const text = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
    expect(text).toContain('# Zzstudio Who funds the cult?');
    expect(text).toContain('Seen near the docks twice.');
    if (process.env.SAVE_DOC_SHOTS === '1') await page.screenshot({ path: path.join(docsShots, 'knowledge-studio.png'), fullPage: true });

    // Share it; another player reads it but cannot change it.
    await page.getByText('About this collection').click();
    await page.getByLabel(/Share with the party/).check();
    await expect(page.getByLabel(/Share with the party/)).toBeChecked();
    const url = page.url();

    const otherCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const bodies = recordApi(otherCtx);
    const other = await otherCtx.newPage();
    await enrollAsPlayer(other, 'Studio Reader');
    await other.goto('/studio');
    await other.getByRole('link', { name: 'Zzstudio Who funds the cult?' }).click();
    await expect(other.getByText('Shared with the party · read-only')).toBeVisible();
    await expect(other.getByLabel('Add a page')).toHaveCount(0);
    await noHorizontalOverflow(other);

    // The DM hides Birch: nobody's collection names it any more, and its title is in no response.
    await db(`update public.articles set visibility = 'dm' where slug = $1`, [S.b]);
    bodies.length = 0;
    await other.reload();
    await expect(other.getByText('A source that is no longer available')).toBeVisible();
    await expect(other.getByText('Zzstudio Birch')).toHaveCount(0);
    for (const b of bodies) expect(b.body, b.url).not.toContain('Zzstudio Birch');
    await otherCtx.close();

    // The DM cannot read private collections; can read this shared one.
    const dmCtx = await browser.newContext();
    const dm = await dmCtx.newPage();
    await signInAsDm(dm);
    await dm.goto(url);
    await expect(dm.getByRole('heading', { level: 1, name: 'Zzstudio Who funds the cult?' })).toBeVisible();
    await dmCtx.close();
    await ctx.close();
  });
});
