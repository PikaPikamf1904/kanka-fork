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

async function checkAndImport(page: Page) {
  await page.getByRole('button', { name: /^Check \d+ pages? with Chronicle$/ }).click();
  await expect(page.getByTestId('import-preview')).toBeVisible();
  await page.getByRole('button', { name: /^(Import \d+ private drafts?|Retry import)$/ }).click();
}

test.describe('Lore import', () => {
  test.describe.configure({ mode: 'serial' });

  test('refuses files that are not packages', async ({ page }) => {
    await signInAsDm(page);
    await page.goto('/dm/import');
    await page.getByLabel('Package (.json)').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{not json') });
    await expect(page.getByText('This file is not valid JSON.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Check/ })).toHaveCount(0);
    await page.getByLabel('Package (.json)').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from('{"articles":[]}') });
    await expect(page.getByText('The package has no articles.')).toBeVisible();
  });

  test('previews, reports bad entries, and an import whose answer is lost is saved exactly once', async ({ page }) => {
    await signInAsDm(page);
    await choosePack(page);
    await expect(page.getByTestId('import-summary')).toContainText('3 readable pages · 3 selected · 1 connections');
    await expect(page.getByRole('heading', { name: '2 entries will not be imported' })).toBeVisible();
    await expect(page.getByText('imported as a DM-only draft')).toBeVisible();
    await noHorizontalOverflow(page);

    // The first apply reaches Chronicle and is saved, but the browser never hears back.
    let dropped = 0;
    await page.route('**/rest/v1/rpc/apply_change_set', async (route) => {
      if (dropped === 0) {
        dropped++;
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await checkAndImport(page);
    await expect(page.getByText('The connection was lost')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry import' })).toBeVisible();
    await page.getByRole('button', { name: 'Retry import' }).click();
    await expect(page.getByTestId('import-result')).toContainText('3 created · 0 left alone (this import had already been saved)');
    await page.unroute('**/rest/v1/rpc/apply_change_set');

    // A second run finds everything already there and creates nothing.
    await choosePack(page);
    await expect(page.getByTestId('import-summary')).toContainText('0 selected');
    await page.getByLabel(`Import Import Alpha ${run}`).check();
    await page.getByRole('button', { name: 'Check 1 page with Chronicle' }).click();
    await expect(page.getByTestId('import-preview')).toContainText('0 pages will be created');
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
