import { devices, expect, test, type Page } from '@playwright/test';
import { enrollAsPlayer, noHorizontalOverflow, screenshot, signInAsDm } from './support.ts';

// Synthetic pictures drawn in the browser: a coloured gradient with a label, as PNG bytes.
async function picture(page: Page, label: string, width = 900, height = 600, colour = '#8a3b2e') {
  const dataUrl = await page.evaluate(({ label, width, height, colour }) => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const x = c.getContext('2d')!;
    const g = x.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, colour);
    g.addColorStop(1, '#1d2448');
    x.fillStyle = g;
    x.fillRect(0, 0, width, height);
    x.fillStyle = '#f6efdc';
    x.font = `bold ${Math.round(height / 8)}px serif`;
    x.textAlign = 'center';
    x.fillText(label, width / 2, height / 2);
    return c.toDataURL('image/png');
  }, { label, width, height, colour });
  return { name: `${label.toLowerCase().replace(/\W+/g, '-')}.png`, mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') };
}

const dialog = (page: Page) => page.getByRole('dialog');

/** Images that actually loaded (a signed URL the reader was allowed to fetch). */
async function loadedImages(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((els) => (els as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth > 0).length);
}

test.describe('Pictures', () => {
  test('desktop: the DM adds a portrait, a captioned picture and a gallery; players see only what is published to them', async ({ page, browser }) => {
    await signInAsDm(page);
    await page.goto('/dm/edit/captain-merrin-vael');
    await expect(page.getByLabel('Title', { exact: true }).first()).toHaveValue('Captain Merrin Vael');
    const tag = Date.now().toString(36);

    // 1. Portrait: Upload → Adjust (drag, zoom) → Save.
    const portrait = page.getByTestId('main-picture');
    await portrait.getByRole('button', { name: /^(Add|Change) photo$/ }).click();
    await expect(dialog(page).getByText('1. Choose')).toBeVisible();
    await dialog(page).getByTestId('image-file-input').setInputFiles(await picture(page, 'Portrait', 900, 1200, '#2e5c8a'));
    const frame = dialog(page).getByTestId('crop-frame');
    await expect(frame).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Portrait 3:4', pressed: true })).toBeVisible();
    await dialog(page).getByRole('slider', { name: 'Zoom' }).fill('1.6');
    const box = (await frame.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    await dialog(page).getByLabel('Description for screen readers').fill('A sea captain in a blue coat (synthetic)');
    await screenshot(page, 'images-desktop-crop');
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(portrait.locator('img')).toBeVisible();
    await expect(portrait.getByRole('button', { name: 'Change photo' })).toBeVisible();

    // 2. A captioned picture in a player section, placed without typing Markdown.
    const history = page.getByRole('toolbar', { name: 'Known history text: pictures' });
    await history.getByRole('button', { name: /Add photo/ }).click();
    await dialog(page).getByTestId('image-file-input').setInputFiles(await picture(page, `Harbour ${tag}`));
    await dialog(page).getByLabel('Caption (shown under the picture)').fill(`The harbour after the fire ${tag}`);
    await dialog(page).getByLabel('Description for screen readers').fill('Smoke over a harbour');
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    const historyText = page.getByRole('textbox', { name: 'Known history text', exact: true });
    await expect(historyText).toHaveValue(new RegExp(`!\\[Smoke over a harbour\\]\\(media:media/[0-9a-f-]+\\.webp "The harbour after the fire ${tag}"\\)`));

    // 3. A gallery of two uploads, dropped in together.
    await history.getByRole('button', { name: 'Add gallery' }).click();
    await dialog(page).getByTestId('image-file-input').setInputFiles([await picture(page, 'Ship', 800, 600, '#3b7a57'), await picture(page, 'Ledger', 600, 800, '#7a6a3b')]);
    await expect(dialog(page).getByRole('button', { name: 'Save 2 photos' })).toBeVisible();
    await dialog(page).getByLabel('Caption (shown under the picture)').nth(0).fill(`The ship ${tag}`);
    await dialog(page).getByLabel('Caption (shown under the picture)').nth(1).fill(`The ledger ${tag}`);
    await dialog(page).getByRole('button', { name: 'Save 2 photos' }).click();
    await expect(dialog(page)).toHaveCount(0);
    const cards = page.getByRole('list', { name: 'Pictures in Known history text' }).getByRole('listitem');
    await expect(cards).toHaveCount(3);
    // Caption edits rewrite the text for the DM.
    await page.getByRole('textbox', { name: 'Caption of picture 3' }).fill(`The ledger, closed ${tag}`);
    await expect(historyText).toHaveValue(new RegExp(`"The ledger, closed ${tag}"`));

    // 4. A picture in the DM-only "Secrets" section, re-used from the library (no new copy).
    await page.getByRole('toolbar', { name: 'Secrets text: pictures' }).getByRole('button', { name: /Add photo/ }).click();
    await dialog(page).getByRole('button', { name: 'Choose from library' }).click();
    await dialog(page).getByRole('button', { name: 'Smoke over a harbour' }).first().click();
    await expect(dialog(page).getByRole('button', { name: 'Use as is', pressed: true })).toBeVisible();
    await dialog(page).getByLabel('Caption (shown under the picture)').fill(`Secret plan ${tag}`);
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await screenshot(page, 'images-desktop-editor');

    // The DM sees all four pictures on the page.
    await page.goto('/wiki/captain-merrin-vael');
    await expect(page.getByText(`Secret plan ${tag}`)).toBeVisible();
    await expect(page.locator('.prose-gallery .prose-figure')).toHaveCount(2);

    // A player sees the portrait, the captioned picture and the gallery, never the DM-only picture.
    const player = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
    await enrollAsPlayer(player, 'Picture Viewer');
    await player.goto('/wiki/captain-merrin-vael');
    await expect(player.getByText(`The harbour after the fire ${tag}`)).toBeVisible();
    await expect(player.getByText(`The ship ${tag}`)).toBeVisible();
    await expect(player.getByText(`The ledger, closed ${tag}`)).toBeVisible();
    await expect.poll(() => loadedImages(player, '.profile-portrait img')).toBe(1);
    await expect.poll(() => loadedImages(player, '.prose-figure img')).toBe(3);
    await expect(player.getByText(`Secret plan ${tag}`)).toHaveCount(0);
    await expect(player.getByText('Secrets', { exact: true })).toHaveCount(0);
    await screenshot(player, 'images-desktop-player');

    // Unpublishing the page hides every picture on it from players again.
    await page.goto('/dm/edit/captain-merrin-vael');
    await expect(page.getByLabel('Title', { exact: true }).first()).toHaveValue('Captain Merrin Vael');
    await page.getByLabel('Article status').selectOption('draft');
    page.once('dialog', (d) => void d.accept()); // "This hides the article from players. Continue?"
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.goto('/dm/media');
    const harbour = page.getByRole('listitem', { name: `harbour ${tag}` });
    await expect(harbour.getByText('DM only')).toBeVisible();
    await page.goto('/dm/edit/captain-merrin-vael');
    await expect(page.getByLabel('Title', { exact: true }).first()).toHaveValue('Captain Merrin Vael');
    await page.getByLabel('Article status').selectOption('published');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect(page.getByText('Saved.')).toBeVisible();

    // The library shows usage, keeps files in use, and deletes an unused upload.
    await page.goto('/dm/media');
    await expect(harbour.getByText('Players can see')).toBeVisible();
    await expect(harbour.getByRole('link', { name: 'In the text of “Captain Merrin Vael”' })).toBeVisible();
    await expect(harbour.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await page.getByTestId('library-file-input').setInputFiles(await picture(page, `Spare ${tag}`));
    await expect(page.getByText('1 picture added.')).toBeVisible();
    const spare = page.getByRole('listitem', { name: `spare-${tag}` });
    await expect(spare.getByText('Not used on any page.')).toBeVisible();
    page.once('dialog', (d) => void d.accept());
    await spare.getByRole('button', { name: 'Delete' }).click();
    await expect(spare).toHaveCount(0);
    await noHorizontalOverflow(page);
  });

  test('phone: the DM adds a story picture and a picture in the text of a Gazette story', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await context.newPage();
    await signInAsDm(page);
    const headline = `Lanterns Photographed ${Date.now().toString(36)}`;
    await page.goto('/dm/news/new');
    await page.getByLabel('Headline', { exact: true }).fill(headline);

    await page.getByTestId('story-picture').getByRole('button', { name: 'Add photo' }).click();
    await expect(dialog(page).getByText('Drop a photo here')).toBeHidden(); // touch screens get the button only
    await dialog(page).getByTestId('image-file-input').setInputFiles(await picture(page, 'Lanterns', 1200, 700, '#a8742a'));
    const frame = dialog(page).getByTestId('crop-frame');
    await expect(frame).toBeVisible();
    await noHorizontalOverflow(page);
    const box = (await frame.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await frame.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('+');
    await screenshot(page, 'images-phone-crop');
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByTestId('story-picture').locator('img')).toBeVisible();

    await page.getByRole('toolbar', { name: 'Story: pictures' }).getByRole('button', { name: /Add photo/ }).click();
    await dialog(page).getByTestId('image-file-input').setInputFiles(await picture(page, 'Witness', 700, 700));
    await dialog(page).getByLabel('Caption (shown under the picture)').fill('A witness, sketched by our reporter');
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Pictures in Story' }).getByRole('listitem')).toHaveCount(1);
    await noHorizontalOverflow(page);
    await screenshot(page, 'images-phone-editor');

    await page.getByRole('button', { name: 'Save story' }).click();
    await expect(page.getByText('Saved. Players cannot see it until you print it.')).toBeVisible();
    await page.getByRole('button', { name: 'Preview as printed' }).click();
    await expect.poll(() => loadedImages(page, '.gz-art img')).toBe(1);
    await expect(page.getByText('A witness, sketched by our reporter')).toBeVisible();
    await noHorizontalOverflow(page);
    await screenshot(page, 'images-phone-preview');

    // The unprinted story's pictures stay private.
    const player = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
    await enrollAsPlayer(player, 'Phone Reader');
    const slug = new URL(page.url()).pathname.split('/').pop()!;
    await player.goto(`/news/${slug}`);
    await expect(player.getByRole('heading', { name: 'Nothing written here yet' })).toBeVisible();
    await context.close();
  });
});
