// Mystery Studio and clues: nothing unreleased reaches a player, in any response, until the DM releases it.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, recordApi, signInAsDm } from './support.ts';

const PAGE = 'zz-myst-library';
const shotDir = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');
const shot = async (page: Page, name: string) => {
  if (process.env.SAVE_DOC_SHOTS !== '1') return;
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(shotDir, name) });
};
async function clean() {
  await db(`delete from public.mysteries where title like 'Zz%'`);
  await db('delete from public.board_items');
  await db('delete from public.board_activity');
  await db('delete from public.articles where slug = $1', [PAGE]);
}
test.beforeEach(async () => {
  await clean();
  await db(`insert into public.articles (slug, type, title, summary, visibility, status, published_at) values ($1, 'location', 'Zzmyst Library', 'A synthetic library.', 'players', 'published', now())`, [PAGE]);
});
test.afterEach(clean);

test('a clue reaches a player only once released, is discovered by opening it, and can be pinned', async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await signInAsDm(dm);
  await dm.goto('/dm/mysteries');
  await expect(dm.getByRole('heading', { name: 'Mystery Studio' })).toBeVisible();

  // A mystery and two clues.
  await dm.getByRole('button', { name: 'New mystery' }).click();
  const form = dm.getByRole('form', { name: 'New mystery' });
  await form.getByLabel('Working title (only you see this)').fill('Zz Missing Ship');
  await form.getByLabel('Title players see').fill('The Missing Ship');
  await form.getByLabel('Status', { exact: true }).selectOption('active');
  await form.getByRole('button', { name: 'Save mystery' }).click();
  await expect(dm.getByTestId('studio-mystery')).toContainText('Zz Missing Ship');
  await dm.getByRole('button', { name: 'Open Zz Missing Ship' }).click();

  const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 16);
  await dm.getByRole('button', { name: 'Add a clue' }).click();
  const clueForm = dm.getByRole('form', { name: 'New clue' });
  await clueForm.getByLabel('Kind', { exact: true }).selectOption('letter');
  await clueForm.getByLabel('Clue title').fill('Zz Torn Letter');
  await clueForm.getByLabel('Text (Markdown)').fill('ZZCLUEBODY the ship sank off the **reef**.');
  await clueForm.getByLabel('Source line (optional)').fill('Sealed with the mark of the Blue Wing');
  await clueForm.getByLabel('On a page').check();
  await clueForm.getByLabel('Find the page').fill('Zzmyst');
  await clueForm.getByRole('button', { name: 'Attach to Zzmyst Library' }).click();
  await expect(clueForm.getByText('Attached to:')).toContainText('Zzmyst Library');
  await clueForm.getByLabel('Release at a set time (optional)').fill(future);
  await clueForm.getByRole('button', { name: 'Save clue' }).click();
  await expect(dm.getByTestId('studio-clue')).toContainText('Scheduled for');

  await dm.getByRole('button', { name: 'Add a clue' }).click();
  const second = dm.getByRole('form', { name: 'New clue' });
  await second.getByLabel('Clue title').fill('Zz Second Clue');
  await second.getByLabel('Text (Markdown)').fill('ZZSECONDBODY the captain was never aboard.');
  await second.getByLabel('On a page').check();
  await second.getByLabel('Find the page').fill('Zzmyst');
  await second.getByRole('button', { name: 'Attach to Zzmyst Library' }).click();
  await second.getByLabel('Needs this clue found first').selectOption({ label: 'Zz Torn Letter' });
  await second.getByRole('button', { name: 'Save clue' }).click();
  await dm.getByRole('button', { name: 'Release Zz Second Clue now' }).click();
  await expect(dm.getByTestId('studio-clue').filter({ has: dm.locator('strong', { hasText: /^Zz Second Clue$/ }) })).toContainText('Released');
  await shot(dm, 'mystery-studio.png');

  // The DM desk shows what is waiting.
  await dm.goto('/dm');
  await expect(dm.getByTestId('mysteries-pending')).toContainText('1 clue is waiting to be released');

  // A player: scheduled in the future, so nothing on the page, nothing under Mysteries, nothing on the wire.
  const pCtx = await browser.newContext();
  const api = recordApi(pCtx);
  const player = await pCtx.newPage();
  await enrollAsPlayer(player, 'Mystery Player');
  await player.goto(`/wiki/${PAGE}`);
  await expect(player.getByRole('heading', { name: 'Zzmyst Library', level: 1 })).toBeVisible();
  await expect(player.getByText('Something catches your eye')).toHaveCount(0);
  await player.goto('/mysteries');
  await expect(player.getByText('Nothing to investigate yet.')).toBeVisible();
  await player.waitForLoadState('networkidle');
  const wire = () => api.map((r) => r.body).join('\n');
  for (const secret of ['ZZCLUEBODY', 'Zz Torn Letter', 'ZZSECONDBODY', 'Zz Second Clue', 'The Missing Ship', 'Zz Missing Ship', 'Blue Wing']) expect(wire(), secret).not.toContain(secret);

  // The DM releases the first clue. The player finds it on the page; the second waits for it.
  await dm.goto('/dm/mysteries');
  await dm.getByRole('button', { name: 'Open Zz Missing Ship' }).click();
  await dm.getByRole('button', { name: 'Release Zz Torn Letter now' }).click();
  await expect(dm.getByTestId('studio-clue').filter({ has: dm.locator('strong', { hasText: /^Zz Torn Letter$/ }) })).toContainText('Released');

  await player.goto(`/wiki/${PAGE}`);
  const finds = player.getByRole('button', { name: /Something catches your eye/ });
  await expect(finds).toHaveCount(1);
  await finds.click();
  const dialog = player.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Zz Torn Letter' })).toBeVisible();
  await expect(dialog).toContainText('ZZCLUEBODY the ship sank off the reef.');
  await expect(dialog).toContainText('Sealed with the mark of the Blue Wing');
  await expect.poll(async () => (await db<{ n: number }>('select count(*)::int as n from public.clue_discoveries')) [0]!.n).toBe(1);
  await shot(player, 'clue-dialog.png');
  await dialog.getByRole('button', { name: 'Pin to the board' }).click();
  await expect(dialog.getByRole('link', { name: 'On the board' })).toBeVisible();
  expect((await db<{ n: number }>(`select count(*)::int as n from public.board_items where kind = 'pin' and ref_type = 'clue'`))[0]!.n).toBe(1);
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Having found the first, the second turns up.
  await player.reload();
  await expect(player.getByRole('button', { name: /Something catches your eye/ })).toHaveCount(1);
  await expect(player.getByText('Zz Torn Letter')).toBeVisible();
  await player.goto('/mysteries');
  await expect(player.getByRole('heading', { name: 'The Missing Ship' })).toBeVisible();
  await expect(player.getByTestId('mystery-count')).toHaveText('1 clue found of 2 seen');
  await expect(player.getByText('ZZSECONDBODY')).toHaveCount(0);
  await noHorizontalOverflow(player);
  // The pinned clue shows on the board by its title.
  await player.goto('/board');
  await expect(player.getByTestId('board-card').filter({ hasText: 'Zz Torn Letter' })).toBeVisible();

  // The DM's "preview as a player" agrees.
  await dm.goto('/dm/mysteries');
  await dm.getByLabel('Player', { exact: true }).selectOption({ label: 'Mystery Player' });
  const list = dm.getByTestId('preview-list');
  await expect(list).toContainText('Zz Torn Letter · found');
  await expect(list).toContainText('Zz Second Clue · not found yet');
  await expect(dm.getByTestId('studio-discoveries')).toContainText('Mystery Player found Zz Torn Letter');

  // Archived (or draft) mysteries show nothing at all.
  await dm.getByRole('button', { name: 'Archive Zz Missing Ship' }).click();
  await expect(dm.getByRole('button', { name: 'Restore Zz Missing Ship as a draft' })).toBeVisible();
  await player.goto('/mysteries');
  await expect(player.getByText('Nothing to investigate yet.')).toBeVisible();
  await player.goto(`/wiki/${PAGE}`);
  await expect(player.getByRole('heading', { name: 'Zzmyst Library', level: 1 })).toBeVisible();
  await expect(player.getByText('Something catches your eye')).toHaveCount(0);
  await expect(player.getByText('Zz Torn Letter')).toHaveCount(0);

  await pCtx.close();
  await dmCtx.close();
});

test('the DM does not see unreleased clues on pages, and a draft mystery shows nothing', async ({ browser }) => {
  const [mystery] = await db<{ id: string }>(`insert into public.mysteries (title, player_title, status) values ('Zz Draft Mystery', 'Draft', 'draft') returning id`);
  const [art] = await db<{ id: string }>('select id from public.articles where slug = $1', [PAGE]);
  await db(`insert into public.clues (mystery_id, title, body, attach_article_id, released_at) values ($1, 'Zz Draft Clue', 'ZZDRAFTBODY', $2, now())`, [mystery!.id, art!.id]);
  const ctx = await browser.newContext();
  const api = recordApi(ctx);
  const player = await ctx.newPage();
  await enrollAsPlayer(player, 'Draft Player');
  await player.goto(`/wiki/${PAGE}`);
  await expect(player.getByRole('heading', { name: 'Zzmyst Library', level: 1 })).toBeVisible();
  await player.goto('/mysteries');
  await expect(player.getByText('Nothing to investigate yet.')).toBeVisible();
  await player.waitForLoadState('networkidle');
  expect(api.map((r) => r.body).join('\n')).not.toContain('ZZDRAFTBODY');
  await ctx.close();

  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await signInAsDm(dm);
  await dm.goto(`/wiki/${PAGE}`);
  await expect(dm.getByRole('heading', { name: 'Zzmyst Library', level: 1 })).toBeVisible();
  await expect(dm.getByText('Something catches your eye')).toHaveCount(0);
  await dm.goto('/mysteries');
  await expect(dm.getByText('Nothing to investigate yet.')).toBeVisible();
  await dmCtx.close();
});
