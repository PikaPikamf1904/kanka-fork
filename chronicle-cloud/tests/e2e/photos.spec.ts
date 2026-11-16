import { devices, expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { assertDisposableDatabase, readLocalEnv } from '../../scripts/local-targets.mjs';
import { enrollAsPlayer, noHorizontalOverflow, screenshot, signInAsDm } from './support.ts';

// The whole photo workflow against the real local Storage, Auth and Data API services, with
// synthetic pictures drawn in the browser and the synthetic sample world.

async function db<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const url = readLocalEnv().DATABASE_URL!;
  await assertDisposableDatabase(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

async function photo(page: Page, label: string, width = 1600, height = 1200, colour = '#2e5c8a', type: 'image/png' | 'image/jpeg' = 'image/jpeg') {
  const dataUrl = await page.evaluate(({ label, width, height, colour, type }) => {
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
    x.font = `bold ${Math.round(height / 9)}px serif`;
    x.textAlign = 'center';
    x.fillText(label, width / 2, height / 2);
    return c.toDataURL(type, 0.9);
  }, { label, width, height, colour, type });
  const ext = type === 'image/png' ? 'png' : 'jpg';
  return { name: `${label.toLowerCase().replace(/\W+/g, '-')}.${ext}`, mimeType: type, buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') };
}

const dialog = (page: Page) => page.getByRole('dialog');
const loaded = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) => (els as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth > 0).length);
const storageFiles = async () => (await db<{ name: string }>("select name from storage.objects where bucket_id = 'chronicle-media' order by name")).map((r) => r.name);

async function openEditor(page: Page, slug: string, title: string) {
  await page.goto(`/dm/edit/${slug}`);
  await expect(page.getByLabel('Title', { exact: true }).first()).toHaveValue(title);
}
async function saveArticle(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.getByText('Saved.')).toBeVisible();
}

test.describe('Photos', () => {
  test('upload, crop, assign, save, refresh, adjust again, reuse, and players see only what they may', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const tag = Date.now().toString(36);
    await signInAsDm(page);

    // 1–4. Upload a photo, crop it, make it Merrin's portrait, save the page.
    await openEditor(page, 'captain-merrin-vael', 'Captain Merrin Vael');
    const portrait = page.getByTestId('main-picture');
    await portrait.getByRole('button', { name: /^(Add|Change) photo$/ }).click();
    await expect(dialog(page).getByRole('button', { name: 'Choose from device' })).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Choose from library' })).toBeVisible();
    await dialog(page).getByTestId('image-file-input').setInputFiles(await photo(page, `Merrin ${tag}`, 1800, 1200));
    await expect(dialog(page).getByRole('button', { name: 'Portrait 3:4', pressed: true })).toBeVisible();
    await dialog(page).getByRole('slider', { name: 'Zoom' }).fill('1.5');
    const frame = dialog(page).getByTestId('crop-frame');
    const box = (await frame.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await dialog(page).getByLabel('Description for screen readers').fill(`Merrin ${tag}`);
    await screenshot(page, 'photos-desktop-adjust');
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(portrait.locator('img')).toBeVisible();
    await saveArticle(page);

    const [first] = await db<{ id: string; path: string; source_id: string; crop: { aspect: string; w: number } }>(
      `select m.id, m.path, p.source_media_id as source_id, p.crop from public.media m join public.media_private p on p.media_id = m.id
       join public.articles a on a.hero_media_id = m.id where a.slug = 'captain-merrin-vael'`);
    expect(first!.crop.aspect).toBe('portrait');
    expect(first!.crop.w).toBeLessThan(1);
    const files = await storageFiles();
    expect(files).toContain(first!.path);
    const [source] = await db<{ path: string; role: string; visibility: string; width: number }>('select path, role, visibility, width from public.media where id = $1', [first!.source_id]);
    expect(source).toMatchObject({ role: 'source', visibility: 'dm', width: 1800 }); // full frame kept, private
    expect(files).toContain(source!.path);

    // 5–6. It appears on the page, and after a refresh.
    await page.goto('/wiki/captain-merrin-vael');
    await expect.poll(() => loaded(page, '.profile-portrait img')).toBe(1);
    await page.reload();
    await expect.poll(() => loaded(page, '.profile-portrait img')).toBe(1);
    await screenshot(page, 'photos-desktop-portrait');

    // 7. Adjust it again: the crop starts from the private full-frame copy; no second copy is stored.
    await openEditor(page, 'captain-merrin-vael', 'Captain Merrin Vael');
    await portrait.getByRole('button', { name: 'Adjust' }).click();
    await expect(dialog(page).getByTestId('crop-frame')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Square' }).click();
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    await saveArticle(page);
    const [second] = await db<{ id: string; source_id: string; crop: { aspect: string } }>(
      `select m.id, p.source_media_id as source_id, p.crop from public.media m join public.media_private p on p.media_id = m.id
       join public.articles a on a.hero_media_id = m.id where a.slug = 'captain-merrin-vael'`);
    expect(second!.id).not.toBe(first!.id);
    expect(second!.source_id).toBe(first!.source_id);
    expect(second!.crop.aspect).toBe('square');
    expect((await db('select 1 from public.media where id = $1', [first!.id])).length).toBe(1); // the earlier crop stays in the library

    // 8. Reuse it elsewhere from the library, unchanged: Port Vellmoor's main picture.
    await openEditor(page, 'port-vellmoor', 'Port Vellmoor');
    await page.getByTestId('main-picture').getByRole('button', { name: /^(Add|Change) photo$/ }).click();
    await dialog(page).getByRole('button', { name: 'Choose from library' }).click();
    await dialog(page).getByRole('button', { name: `Merrin ${tag}` }).first().click();
    await expect(dialog(page).getByRole('button', { name: 'Use as is', pressed: true })).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    await saveArticle(page);
    const [reused] = await db<{ hero_media_id: string }>("select hero_media_id from public.articles where slug = 'port-vellmoor'");
    expect([first!.id, second!.id]).toContain(reused!.hero_media_id);

    // 9. A player sees the portrait on the published page...
    const player = await (await browser.newContext()).newPage();
    await enrollAsPlayer(player, 'Photo Player');
    await player.goto('/wiki/captain-merrin-vael');
    await expect.poll(() => loaded(player, '.profile-portrait img')).toBe(1);
    // ...but never the private full-frame copy, even by asking Storage directly.
    const blocked = await player.evaluate(async (path) => {
      const raw = localStorage.getItem('chronicle-auth');
      const token = raw ? (JSON.parse(raw) as { access_token: string }).access_token : '';
      const base = (window as unknown as { __chronicleSupabaseUrl?: string }).__chronicleSupabaseUrl ?? 'http://127.0.0.1:54321';
      const r = await fetch(`${base}/storage/v1/object/sign/chronicle-media/${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"expiresIn":60}' });
      return r.status;
    }, source!.path);
    expect(blocked).not.toBe(200);
    // Hiding the page takes the portrait away from players.
    await openEditor(page, 'captain-merrin-vael', 'Captain Merrin Vael');
    await page.getByLabel('Article status').selectOption('draft');
    page.once('dialog', (d) => void d.accept());
    await saveArticle(page);
    // The current portrait is private again unless Port Vellmoor (still published) reused that same crop.
    const [vis] = await db<{ visibility: string }>('select visibility from public.media where id = $1', [second!.id]);
    expect(vis!.visibility).toBe(reused!.hero_media_id === second!.id ? 'players' : 'dm');
    const [old] = await db<{ visibility: string }>('select visibility from public.media where id = $1', [first!.id]);
    expect(old!.visibility).toBe(reused!.hero_media_id === first!.id ? 'players' : 'dm');
    await player.goto('/wiki/captain-merrin-vael');
    await expect(player.getByRole('heading', { name: 'Nothing written here yet' })).toBeVisible();
    await openEditor(page, 'captain-merrin-vael', 'Captain Merrin Vael');
    await page.getByLabel('Article status').selectOption('published');
    await saveArticle(page);

    // 10. Anonymous visitors cannot fetch any picture file.
    const anon = await (await browser.newContext()).newPage();
    await anon.goto('/');
    const anonStatus = await anon.evaluate(async (path) => (await fetch(`http://127.0.0.1:54321/storage/v1/object/authenticated/chronicle-media/${path}`)).status, first!.path);
    expect(anonStatus).not.toBe(200);
  });

  test('a failed upload is cleaned up, explained, and can be retried; double clicks save once', async ({ page }) => {
    const tag = Date.now().toString(36);
    await signInAsDm(page);
    await openEditor(page, 'lantern-of-seven-stars', 'Lantern of Seven Stars');
    const before = await storageFiles();
    // The files upload, then registration fails (as if the connection dropped at that moment).
    let fail = true;
    await page.route('**/rest/v1/rpc/register_photo', (route) => (fail ? route.fulfill({ status: 503, body: '{"message":"unavailable"}' }) : route.continue()));
    await page.getByTestId('main-picture').getByRole('button', { name: /^(Add|Change) photo$/ }).click();
    await dialog(page).getByTestId('image-file-input').setInputFiles(await photo(page, `Lantern ${tag}`, 1200, 900, '#a8742a', 'image/png'));
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog(page).getByRole('alert').first()).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Try again' })).toBeVisible();
    // Nothing half-saved: the uploaded files were removed again and nothing was registered.
    await expect.poll(async () => (await storageFiles()).length).toBe(before.length);
    expect((await db("select 1 from public.media_private where original_name = $1", [`lantern ${tag}`])).length).toBe(0);
    // Retry works; a burst of clicks still saves exactly one photo.
    fail = false;
    // Two clicks in the same instant, before the page can redraw the button as busy.
    await dialog(page).getByRole('button', { name: 'Try again' }).evaluate((b: HTMLButtonElement) => { b.click(); b.click(); });
    await expect(dialog(page)).toHaveCount(0);
    expect((await db("select 1 from public.media_private where original_name = $1 and source_media_id is not null", [`lantern ${tag}`])).length).toBe(1);
    await saveArticle(page);
    await page.goto('/wiki/lantern-of-seven-stars');
    await expect.poll(() => loaded(page, '.infobox img')).toBe(1);
  });

  test('ambiguous failures: an upload that arrived but lost its answer is cleaned up; a lost registration answer still succeeds', async ({ page }) => {
    const tag = Date.now().toString(36);
    await signInAsDm(page);
    await openEditor(page, 'lantern-of-seven-stars', 'Lantern of Seven Stars');
    const before = await storageFiles();

    // 1. The full-size copy really reaches Storage, but the browser sees a network error.
    await page.route('**/storage/v1/object/chronicle-media/sources/**', async (route) => {
      await route.fetch(); // the file arrives
      await route.abort('failed'); // the answer is lost
    });
    await page.getByTestId('main-picture').getByRole('button', { name: /^(Add|Change) photo$/ }).click();
    await dialog(page).getByTestId('image-file-input').setInputFiles(await photo(page, `Ambiguous ${tag}`, 1000, 800));
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog(page).getByRole('alert').filter({ hasText: 'upload failed' })).toBeVisible();
    await expect.poll(async () => (await storageFiles()).length).toBe(before.length); // nothing left behind
    await page.unroute('**/storage/v1/object/chronicle-media/sources/**');

    // 2. The registration commits, but its answer is lost: the photo is found and used, not deleted.
    await page.route('**/rest/v1/rpc/register_photo', async (route) => {
      await route.fetch();
      await route.abort('failed');
    });
    await dialog(page).getByRole('button', { name: 'Try again' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await page.unroute('**/rest/v1/rpc/register_photo');
    await saveArticle(page);
    const [row] = await db<{ path: string }>(`select m.path from public.articles a join public.media m on m.id = a.hero_media_id where a.slug = 'lantern-of-seven-stars'`);
    expect(await storageFiles()).toContain(row!.path);
    expect((await db("select 1 from public.media_private where original_name = $1 and source_media_id is not null", [`ambiguous ${tag}`])).length).toBe(1);
  });

  test('a cleanup that Storage refuses is reported, and the Media Library removes the leftover later', async ({ page }) => {
    const tag = Date.now().toString(36);
    await signInAsDm(page);
    await openEditor(page, 'lantern-of-seven-stars', 'Lantern of Seven Stars');
    const before = await storageFiles();
    await page.route('**/rest/v1/rpc/register_photo', (route) => route.fulfill({ status: 503, body: '{"message":"unavailable"}' }));
    // Storage answers the cleanup with an error result (not a thrown exception).
    await page.route('**/storage/v1/object/chronicle-media', (route) =>
      route.request().method() === 'DELETE' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"statusCode":"500","error":"Internal","message":"synthetic failure"}' }) : route.continue());
    await page.getByTestId('main-picture').getByRole('button', { name: /^(Add|Change) photo$/ }).click();
    await dialog(page).getByTestId('image-file-input').setInputFiles(await photo(page, `Leftover ${tag}`, 900, 700));
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog(page).getByRole('alert').filter({ hasText: 'Unfinished uploads can remove it later' })).toBeVisible();
    const leftover = (await storageFiles()).filter((f) => !before.includes(f));
    expect(leftover.length).toBe(2); // the full-size copy and the picture, neither in the library
    await page.unroute('**/rest/v1/rpc/register_photo');
    await page.unroute('**/storage/v1/object/chronicle-media');
    // Age them past the ten-minute safety window, then clean up from the library.
    await db(`update storage.objects set created_at = now() - interval '1 hour' where name = any($1)`, [leftover]);
    await page.goto('/dm/media');
    const panel = page.getByRole('region', { name: 'Unfinished uploads' });
    await expect(panel).toContainText('2 stored files');
    await panel.getByRole('button', { name: 'Remove unfinished uploads' }).click();
    await expect(page.getByText('Unfinished uploads removed.')).toBeVisible();
    expect(await storageFiles()).toEqual(before);
  });

  test('non-pictures and unreadable files get a clear message, and nothing is uploaded', async ({ page }) => {
    await signInAsDm(page);
    await openEditor(page, 'lantern-of-seven-stars', 'Lantern of Seven Stars');
    const before = await storageFiles();
    await page.getByTestId('main-picture').getByRole('button', { name: /^(Add|Change) photo$/ }).click();
    await dialog(page).getByTestId('image-file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic notes') });
    await expect(dialog(page).getByRole('alert')).toContainText('not a picture Chronicle can use');
    await dialog(page).getByTestId('image-file-input').setInputFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not really a jpeg') });
    await expect(dialog(page).getByRole('alert')).toContainText('could not be opened');
    await dialog(page).getByTestId('image-file-input').setInputFiles({ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: Buffer.from('synthetic heic bytes') });
    await expect(dialog(page).getByRole('alert')).toContainText('HEIC');
    expect(await storageFiles()).toEqual(before);
  });

  test('galleries, journals and the banner take photos; pictures in text can be adjusted; the library protects pictures in use', async ({ page }) => {
    test.setTimeout(120_000);
    const tag = Date.now().toString(36);
    await signInAsDm(page);

    // A gallery section on a character page.
    await openEditor(page, 'kaela-brightwind', 'Kaela Brightwind');
    await page.getByRole('button', { name: 'Add gallery section' }).click();
    await page.getByRole('toolbar', { name: 'Gallery text: pictures' }).getByRole('button', { name: 'Add gallery' }).click();
    await dialog(page).getByTestId('image-file-input').setInputFiles([await photo(page, `Ship ${tag}`, 900, 600, '#3b7a57'), await photo(page, `Map ${tag}`, 700, 900, '#7a6a3b')]);
    await dialog(page).getByRole('button', { name: 'Save 2 photos' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await page.getByLabel('Gallery status').selectOption('published');
    await saveArticle(page);
    await page.goto('/wiki/kaela-brightwind');
    await expect.poll(() => loaded(page, '.prose-gallery img')).toBe(2);

    // A picture in text can be adjusted later, and the text follows.
    await openEditor(page, 'kaela-brightwind', 'Kaela Brightwind');
    const text = page.getByRole('textbox', { name: 'Gallery text', exact: true });
    const oldText = await text.inputValue();
    await page.getByRole('button', { name: 'Adjust picture 1' }).click();
    await dialog(page).getByRole('button', { name: 'Square' }).click();
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(text).not.toHaveValue(oldText);
    await saveArticle(page);

    // A session journal shows its main picture.
    await openEditor(page, 'session-1-smoke-over-vellmoor', 'Session 1: Smoke over Vellmoor');
    await page.getByTestId('main-picture').getByRole('button', { name: /^(Add|Change) photo$/ }).click();
    await dialog(page).getByTestId('image-file-input').setInputFiles(await photo(page, `Smoke ${tag}`, 1600, 900, '#5a4a3a'));
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await saveArticle(page);
    await page.goto('/wiki/session-1-smoke-over-vellmoor');
    await expect.poll(() => loaded(page, '.journal-hero')).toBe(1);

    // The banner warns that players see it.
    await page.goto('/dm/settings');
    await expect(page.getByTestId('banner-picture').getByRole('note')).toContainText('Every player can see the banner');

    // The library: search, usage, and pictures in use cannot be deleted.
    await page.goto('/dm/media');
    await page.getByRole('searchbox', { name: 'Search pictures' }).fill(`ship ${tag}`);
    // Adjusting made a new crop; the earlier one stays in the library too. The newest is listed first.
    const ship = page.getByRole('listitem', { name: `ship ${tag}` }).first();
    await expect(ship.getByRole('link', { name: 'In the text of “Kaela Brightwind”' })).toBeVisible();
    await expect(ship.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await screenshot(page, 'photos-desktop-library');
  });

  test('phone: choose a photo, crop it and save it as a portrait', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await context.newPage();
    const tag = Date.now().toString(36);
    await signInAsDm(page);
    await openEditor(page, 'doran-ashforge', 'Doran Ashforge');
    await page.getByTestId('main-picture').getByRole('button', { name: /^(Add|Change) photo$/ }).click();
    await expect(dialog(page).getByText('Drop a photo here')).toBeHidden(); // touch screens get the buttons only
    await noHorizontalOverflow(page);
    await screenshot(page, 'photos-phone-choose');
    await dialog(page).getByTestId('image-file-input').setInputFiles(await photo(page, `Doran ${tag}`, 3000, 4000, '#9e2a2b'));
    const frame = dialog(page).getByTestId('crop-frame');
    await expect(frame).toBeVisible();
    const box = (await frame.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await dialog(page).getByRole('slider', { name: 'Zoom' }).fill('1.3');
    await noHorizontalOverflow(page);
    await screenshot(page, 'photos-phone-adjust');
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    await saveArticle(page);
    await page.goto('/wiki/doran-ashforge');
    await expect.poll(() => loaded(page, '.profile-portrait img')).toBe(1);
    await noHorizontalOverflow(page);
    await screenshot(page, 'photos-phone-portrait');
    // The full-frame copy was downsized for storage, not kept at camera size.
    const [src] = await db<{ width: number; height: number }>(
      `select s.width, s.height from public.articles a join public.media_private p on p.media_id = a.hero_media_id join public.media s on s.id = p.source_media_id where a.slug = 'doran-ashforge'`);
    expect(Math.max(src!.width, src!.height)).toBe(2560);
    await context.close();
  });
});
