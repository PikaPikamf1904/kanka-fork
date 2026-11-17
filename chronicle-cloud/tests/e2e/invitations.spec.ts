import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { db } from './db.ts';
import { noHorizontalOverflow, signInAsDm } from './support.ts';

// Personal invitation links: the DM invites a player, the player joins on a phone without email
// or password, adds a second device to the same account, the DM signs one device out, and a shared
// device switches between two players. Synthetic names only.

const docsShots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');
const A = 'Zzinvite Eliza';
const B = 'Zzinvite Sybil';

async function cleanup() {
  const users = await db<{ user_id: string }>(`select user_id from public.campaign_members where display_name like 'Zzinvite %'`);
  await db(`delete from public.player_invitations where display_name like 'Zzinvite %'`);
  if (users.length) await db('delete from auth.users where id = any($1::uuid[])', [users.map((u) => u.user_id)]);
  await db(`delete from public.enrollment_attempts`);
}

async function makeLink(dm: Page, name: string): Promise<string> {
  await dm.goto('/dm/access');
  await dm.getByLabel('Player name').fill(name);
  await dm.getByRole('button', { name: 'Create invitation link' }).click();
  const link = await dm.getByLabel(`Invitation link for ${name}`).inputValue();
  expect(link).toMatch(/\/join#[0-9a-f]{64}$/);
  return link;
}

async function phone(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  return { context, page: await context.newPage() };
}

test.describe('Player invitations', () => {
  test.beforeEach(cleanup);
  test.afterEach(cleanup);

  test('invite, join on a phone, add a device, sign one device out, and switch players on a shared device', async ({ page: dm, browser }) => {
    await signInAsDm(dm);
    const first = await makeLink(dm, A);
    const origin = new URL(first).origin;
    const path1 = first.slice(origin.length);

    // Joining on a phone: a welcome screen, no email or password, and the token leaves the address bar.
    const p1 = await phone(browser);
    await p1.page.goto(path1);
    await expect(p1.page.getByRole('heading', { name: `Welcome, ${A}` })).toBeVisible();
    expect(p1.page.url()).not.toContain('#');
    await noHorizontalOverflow(p1.page);
    if (process.env.SAVE_DOC_SHOTS === '1') await p1.page.screenshot({ path: path.join(docsShots, 'join-welcome-phone.png') });
    await p1.page.getByRole('button', { name: `I’m ${A}, let me in` }).click();
    await expect(p1.page.locator('main#main')).toBeVisible();
    await p1.page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(p1.page.getByText(`Signed in as ${A}`)).toBeVisible();

    // The same link never works twice.
    const replay = await phone(browser);
    await replay.page.goto(path1);
    await expect(replay.page.getByRole('heading', { name: 'This link didn’t work' })).toBeVisible();
    await replay.context.close();

    // A link for another device signs the same player in; there is still one player.
    await dm.reload();
    await dm.getByRole('row', { name: new RegExp(A) }).getByRole('button', { name: 'Link for another device' }).click();
    const second = await dm.getByLabel(`Invitation link for ${A}`).inputValue();
    const p2 = await phone(browser);
    await p2.page.goto(second.slice(origin.length));
    await expect(p2.page.getByText('This link adds this device to your place in the Chronicle.')).toBeVisible();
    await p2.page.getByRole('button', { name: `I’m ${A}, let me in` }).click();
    await expect(p2.page.locator('main#main')).toBeVisible();
    const members = await db<{ user_id: string }>(`select user_id from public.campaign_members where display_name = $1`, [A]);
    expect(members).toHaveLength(1);
    const devices = await db<{ label: string }>(`select label from public.member_devices where user_id = $1`, [members[0]!.user_id]);
    expect(devices).toHaveLength(2);

    // The DM signs out the first device only.
    await dm.reload();
    const row = dm.getByRole('row', { name: new RegExp(A) });
    await expect(row.getByRole('button', { name: 'Sign out this device' })).toHaveCount(2);
    if (process.env.SAVE_DOC_SHOTS === '1') await dm.getByTestId('invite-table').screenshot({ path: path.join(docsShots, 'dm-invitations.png') });
    dm.once('dialog', (d) => void d.accept());
    await row.getByRole('button', { name: 'Sign out this device' }).first().click();
    await expect(row.getByText('signed out')).toBeVisible();
    await p1.page.reload();
    await expect(p1.page.getByText('This device no longer has access.')).toBeVisible();
    await p2.page.reload();
    await expect(p2.page.locator('main#main')).toBeVisible();

    // A shared device: a second player joins on p2, then switches back without any code.
    const sybil = await makeLink(dm, B);
    await p2.page.goto(sybil.slice(origin.length));
    await expect(p2.page.getByText(`This device is signed in as ${A}.`)).toBeVisible();
    await p2.page.getByRole('button', { name: `I’m ${B}, let me in` }).click();
    await p2.page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(p2.page.getByText(`Signed in as ${B}`)).toBeVisible();
    await p2.page.getByRole('button', { name: `Switch to ${A}` }).click();
    await expect(p2.page.getByText(`Signed in as ${A}`)).toBeAttached();
    // The session really is Eliza's, not just the label.
    const sessionUser = await p2.page.evaluate(() => (JSON.parse(localStorage.getItem('chronicle-auth') ?? '{}') as { user?: { id?: string } }).user?.id);
    expect(sessionUser).toBe(members[0]!.user_id);
    await p2.page.getByRole('button', { name: 'Menu', exact: true }).click();

    // Leaving signs out only this device's session for that player.
    p2.page.once('dialog', (d) => void d.accept());
    await p2.page.getByRole('button', { name: 'Leave on this device' }).click();
    await expect(p2.page.getByRole('button', { name: `Continue as ${B}` })).toBeVisible();
    await expect(p2.page.getByRole('button', { name: `Continue as ${A}` })).toHaveCount(0);

    await p1.context.close();
    await p2.context.close();
  });

  test('players and visitors cannot reach the invitation manager or its data', async ({ browser }) => {
    const { context, page } = await phone(browser);
    // A visitor with a made-up link is told it does not work and is not signed in.
    await page.goto(`/join#${'0'.repeat(64)}`);
    await expect(page.getByRole('heading', { name: 'This link didn’t work' })).toBeVisible();
    const res = await page.request.post('/api/join', { data: { token: 'not-a-token', action: 'join' }, headers: { origin: new URL(page.url()).origin } });
    expect(res.status()).toBe(400);
    await context.close();
  });
});
