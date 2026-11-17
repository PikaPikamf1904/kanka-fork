// Staged lore import in the browser: choose many Markdown and JSON files, stage them, review the
// analysis (new pages, additions, duplicates, conflicts, connections), approve and reject, save in
// parts with an interruption, and check that players see nothing. Synthetic lore only.
import { expect, test, type Page } from '@playwright/test';
import { enrollAsPlayer, noHorizontalOverflow, screenshot, signInAsDm } from './support.ts';

const run = Date.now().toString(36);
const files = [
  { name: `zz-${run}-ferryman.md`, text: `---\ntitle: Zz Ferryman ${run}\ntype: npc\ncanon: confirmed\ntags: [Zz Sea Folk ${run}]\n---\nRows boats to [[Port Vellmoor]] and knows [[Zz Lighthouse ${run}]].\n\n## Facts\n- Race: Human\n\n## History\nZZSECRET${run} rowed for years.\n\n## DM notes\nOwes money.` },
  { name: `zz-${run}-places.md`, text: `# Zz Lighthouse ${run}\nA tall light by the sea. ZZSECRET${run}\n\n# Session 99: Zz Storm ${run}\nThe party sheltered from the storm.\n\n# Zz Odd Thing ${run}\nNobody knows.` },
  { name: `zz-${run}-port.md`, text: `---\ntitle: Port Vellmoor\ncanon: rumor\n---\nPeople say the port is cursed.\n\n## Facts\n- Population: Countless\n- Ruler: A goblin, they say` },
  { name: `zz-${run}-broken.json`, text: '{nope' },
];
const asFiles = files.map((f) => ({ name: f.name, mimeType: f.name.endsWith('.json') ? 'application/json' : 'text/markdown', buffer: Buffer.from(f.text) }));

async function stage(page: Page) {
  await page.goto('/dm/import/batches');
  await page.getByTestId('lore-files').setInputFiles(asFiles);
  await expect(page.getByTestId('stage-summary')).toContainText('5 entries read from 4 files');
  await expect(page.getByRole('alert')).toContainText(`zz-${run}-broken.json: This file is not valid JSON.`);
  await page.getByLabel('Name for this import').fill(`Zz import ${run}`);
  await page.getByRole('button', { name: 'Stage for review' }).click();
  await expect(page.getByRole('heading', { name: `Review import: Zz import ${run}` })).toBeVisible();
}

test.describe('Staged lore import', () => {
  test('review shows what would happen; approved entries are saved once as DM-only drafts; existing pages untouched unless chosen', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await signInAsDm(page);
    await stage(page);
    const totals = page.getByTestId('import-totals');
    await expect(totals).toContainText('New pages4');
    await expect(totals).toContainText('Additions to existing pages1');
    await expect(totals).toContainText('Conflicting facts');
    await expect(page.getByText('Approved now: 4 entries')).toBeVisible();
    await screenshot(page, 'lore-import-review');

    // The existing page is not approved by default and its conflicting facts are listed.
    const port = page.getByTestId('import-item-port-vellmoor');
    await expect(port).toContainText('Adds to Port Vellmoor');
    await expect(port.getByRole('checkbox')).not.toBeChecked();
    await expect(port).toContainText('Rumour (in-world, not canon)');
    // Guessed types are labelled, and can be changed.
    const odd = page.getByTestId(`import-item-zz-odd-thing-${run}`);
    await expect(odd).toContainText('guess');
    await odd.getByLabel(`Type of Zz Odd Thing ${run}`).selectOption('item');
    // Reject one entry; filters narrow the list.
    await page.getByTestId(`import-item-session-99-zz-storm-${run}`).getByRole('checkbox').uncheck();
    await page.getByLabel('Show entries').selectOption('conflicts');
    await expect(page.locator('.import-item')).toHaveCount(1);
    await page.getByLabel('Show entries').selectOption('all');
    await expect(page.getByText('Choices not saved')).toBeVisible();
    // A category the files name but the wiki lacks: created only because it is ticked here.
    await page.getByRole('region', { name: 'Categories that do not exist yet' }).getByRole('checkbox', { name: `Zz Sea Folk ${run}` }).check();

    // The first saved part reaches Chronicle but its answer is lost: the retry saves it once.
    let dropped = 0;
    await page.route('**/rest/v1/rpc/apply_change_set', async (route) => {
      if (dropped === 0) {
        dropped++;
        await route.fetch();
        return route.abort();
      }
      return route.continue();
    });
    await page.getByRole('button', { name: 'Save approved entries as DM-only drafts' }).click();
    await expect(page.getByText(/Saved \d+ parts?\. Every new page and section is a DM-only draft\. Nothing was published\./)).toBeVisible({ timeout: 30_000 });
    expect(dropped).toBe(1);
    await expect(page.getByTestId(`import-item-zz-ferryman-${run}`)).toContainText('Saved');
    await expect(page.getByTestId('import-totals')).toContainText('Already saved3');
    await noHorizontalOverflow(page);

    // Saving again finds nothing new to do.
    await expect(page.getByRole('button', { name: /Save approved entries|Continue saving/ })).toBeDisabled();

    await page.goto(`/category/zz-sea-folk-${run}`);
    await expect(page.getByRole('link', { name: `Zz Ferryman ${run}` })).toBeVisible();
    // The saved pages are drafts; the existing page was not changed; the type choice was used.
    await page.goto(`/wiki/zz-odd-thing-${run}`);
    await expect(page.getByText('Item', { exact: true }).first()).toBeVisible();
    await page.goto('/wiki/port-vellmoor');
    await expect(page.getByText('People say the port is cursed.')).toHaveCount(0);

    const player = await (await browser.newContext()).newPage();
    await enrollAsPlayer(player, `Import Watcher ${run}`);
    await player.goto(`/wiki/zz-ferryman-${run}`);
    await expect(player.getByRole('heading', { name: 'Nothing written here yet' })).toBeVisible();
    await player.goto(`/search?q=ZZSECRET${run}`);
    // The heading repeats the reader's own query; the results must be empty.
    await expect(player.getByText('No pages match.')).toBeVisible();
    // Only the results list is checked: the player's own recent-searches list shows their query, which contains the run id.
    await expect(player.locator('ol.search-results').getByRole('link', { name: new RegExp(run) })).toHaveCount(0);
  });

  test('works on a phone without sideways scrolling', async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true })).newPage();
    await signInAsDm(page);
    await stage(page);
    await noHorizontalOverflow(page);
    await page.getByTestId(`import-item-zz-lighthouse-${run}`).getByRole('checkbox').uncheck();
    await noHorizontalOverflow(page);
    await screenshot(page, 'lore-import-review-phone');
    await page.getByRole('button', { name: 'Discard import' }).click().catch(() => undefined);
  });
});
