import { expect, test, type Page } from '@playwright/test';
import { enrollAsPlayer, noHorizontalOverflow, signInAsDm } from './support.ts';

const run = Date.now().toString(36);
const slugs = { a: `import-alpha-${run}`, b: `import-beta-${run}`, c: `import-gamma-${run}` };
const SECRET = `IMPORTSECRET${run}`;

const pack = {
  visibility: 'players',
  articles: [
    { slug: slugs.a, title: `Import Alpha ${run}`, type: 'character', visibility: 'players', status: 'published',
      summary: `Alpha ${SECRET}`, sections: [{ heading: 'Overview', body: `Knows [[${slugs.b}|Beta]]. ${SECRET}`, visibility: 'players', status: 'published' }],
      infobox: [{ label: 'Role', value: 'Tester', visibility: 'players' }], notes: [{ title: 'Provenance', body: 'Synthetic test data.' }] },
    { slug: slugs.b, title: `Import Beta ${run}`, type: 'location', sections: [{ heading: 'Overview', body: `A place. ${SECRET}` }] },
    { slug: slugs.c, title: `Import Gamma ${run}`, type: 'quest', sections: [{ heading: 'Plan', body: `Planned. ${SECRET}` }] },
    { slug: 'Not A Slug', title: 'Broken entry', type: 'character', sections: [{ heading: 'x', body: 'y' }] },
    { slug: `import-bad-type-${run}`, title: 'Bad type', type: 'spell', sections: [{ heading: 'x', body: 'y' }] },
  ],
  relations: [{ source: slugs.a, target: slugs.b, kind: 'located_in', label: 'Lives there', visibility: 'players' }],
};

async function choosePack(page: Page) {
  await page.goto('/dm/import');
  await page.getByLabel('Package (.json)').setInputFiles({ name: 'pack.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack)) });
  await expect(page.getByTestId('import-summary')).toBeVisible();
}

async function importNow(page: Page) {
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: /^Import \d+ private drafts?$/ }).click();
  await expect(page.getByTestId('import-result')).toBeVisible();
}

test.describe('Lore import', () => {
  test.describe.configure({ mode: 'serial' });

  test('refuses files that are not packages', async ({ page }) => {
    await signInAsDm(page);
    await page.goto('/dm/import');
    await page.getByLabel('Package (.json)').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{not json') });
    await expect(page.getByText('This file is not valid JSON.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Import/ })).toHaveCount(0);
    await page.getByLabel('Package (.json)').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from('{"articles":[]}') });
    await expect(page.getByText('The package has no articles.')).toBeVisible();
  });

  test('previews, reports bad entries, and a failed page leaves nothing behind', async ({ page }) => {
    await signInAsDm(page);
    await choosePack(page);
    await expect(page.getByTestId('import-summary')).toContainText('3 readable pages · 3 to import · 0 already in the wiki · 1 connections');
    await expect(page.getByRole('heading', { name: '2 entries will not be imported' })).toBeVisible();
    await expect(page.getByText('imported as a DM-only draft')).toBeVisible();
    await noHorizontalOverflow(page);

    // Deselect Gamma; make saving Beta's sections fail.
    await page.getByLabel(`Import Import Gamma ${run}`).uncheck();
    let failed = 0;
    await page.route('**/rest/v1/article_sections*', async (route) => {
      const body = route.request().postData() ?? '';
      if (route.request().method() === 'POST' && body.includes('A place.') && failed === 0) {
        failed++;
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic failure' }) });
      } else await route.continue();
    });
    await importNow(page);
    await expect(page.getByTestId('import-result')).toContainText('1 created · 0 skipped · 1 failed');
    await expect(page.getByRole('heading', { name: 'Import finished with problems' })).toBeVisible();
    await expect(page.getByText('synthetic failure')).toBeVisible();
    await page.unroute('**/rest/v1/article_sections*');

    // The failed page was cleaned up: the preview offers it again, and Alpha is now left alone.
    await choosePack(page);
    await expect(page.getByTestId('import-summary')).toContainText('2 to import · 1 already in the wiki');
    await expect(page.getByRole('row', { name: new RegExp(`Import Beta ${run}`) })).toContainText('Create private draft');
    await expect(page.getByRole('row', { name: new RegExp(`Import Alpha ${run}`) })).toContainText('Already in the wiki');
  });

  test('a page left unfinished by a crash is replaced, and a repeat import creates nothing', async ({ page }) => {
    await signInAsDm(page);
    await choosePack(page);
    // Simulate the browser dying after the page row was created: sections fail AND cleanup fails.
    await page.route('**/rest/v1/article_sections*', async (route) => {
      if (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('A place.')) await route.abort();
      else await route.continue();
    });
    await page.route('**/rest/v1/articles*', async (route) => {
      if (route.request().method() === 'DELETE') await route.abort();
      else await route.continue();
    });
    await page.getByLabel(`Import Import Gamma ${run}`).uncheck();
    await importNow(page);
    await expect(page.getByTestId('import-result')).toContainText('0 created · 0 skipped · 1 failed');
    await page.unroute('**/rest/v1/article_sections*');
    await page.unroute('**/rest/v1/articles*');

    await choosePack(page);
    await expect(page.getByRole('row', { name: new RegExp(`Import Beta ${run}`) })).toContainText('Unfinished from an earlier import (replace)');
    await importNow(page);
    await expect(page.getByTestId('import-result')).toContainText('2 created · 0 skipped · 0 failed · 1 connections added');
    await expect(page.getByRole('heading', { name: 'Import finished', exact: true })).toBeVisible();

    // Third run: everything exists, nothing to do.
    await choosePack(page);
    await expect(page.getByTestId('import-summary')).toContainText('0 to import · 3 already in the wiki');
    await expect(page.getByRole('button', { name: 'Import 0 private drafts' })).toBeDisabled();

    // The imported page opens in the editor as a DM-only draft with its private note.
    await page.goto(`/dm/edit/${slugs.a}`);
    await expect(page.getByLabel('Title', { exact: true }).first()).toHaveValue(`Import Alpha ${run}`);
    await expect(page.getByText('Synthetic test data.').first()).toBeAttached();
  });

  test('a player sees none of the imported pages, by list, address, search or connection', async ({ page }) => {
    await enrollAsPlayer(page, 'Import Checker');
    const bodies: string[] = [];
    page.on('response', async (res) => {
      if (res.url().includes(':54321/')) bodies.push(await res.text().catch(() => ''));
    });
    for (const path of ['/', '/characters', '/locations', '/quests', '/connections', `/wiki/${slugs.a}`, `/wiki/${slugs.c}`, `/search?q=${SECRET}`, `/search?q=Import%20Alpha`]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }
    const all = bodies.join('\n');
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(`Import Alpha ${run}`);
    expect(all).not.toContain(slugs.b);
    await page.goto('/dm/import');
    await expect(page.getByLabel('Package (.json)')).toHaveCount(0);
  });
});
