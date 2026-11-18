// "Who's at the table?" and the DM screen passcode, end to end against the local stack.
import { expect, test } from '@playwright/test';
import { E2E_DM_PASSCODE, localCredentials, noHorizontalOverflow, openOtherForm, passDmScreen, recordApi, resetLocalDmGate, screenshot } from './support.ts';
import pg from 'pg';
import { assertDisposableDatabase, readLocalEnv } from '../../scripts/local-targets.mjs';

async function clearEnrollmentLimit() {
  const url = readLocalEnv().DATABASE_URL!;
  await assertDisposableDatabase(url);
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { await c.query('delete from public.enrollment_attempts'); } finally { await c.end(); }
}

const SEATS = [['Weston', 'Bob'], ['Sybil', 'Swift Claw'], ['Charity', 'Gears/Robo'], ['Eliza', 'Frost']] as const;

test.describe('who is at the table', () => {
  test('shows the four players and the DM in order, as large cards that fit a phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: /who.s at the table/i })).toBeVisible();
    const seats = page.getByRole('list', { name: 'Seats at the table' }).getByRole('button');
    await expect(seats).toHaveCount(5);
    for (const [i, [player, character]] of SEATS.entries()) {
      await expect(seats.nth(i)).toHaveAccessibleName(`${player}, playing ${character}`);
      await expect(seats.nth(i)).toContainText(player);
      await expect(seats.nth(i)).toContainText(character);
    }
    await expect(seats.nth(4)).toHaveAccessibleName('Dungeon Master');
    for (let i = 0; i < 5; i += 1) expect((await seats.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await noHorizontalOverflow(page);
    await screenshot(page, 'table-phone');
  });

  test('choosing a name never signs anyone in: it asks for the table code, and a wrong code is refused', async ({ page }) => {
    await clearEnrollmentLimit();
    await page.goto('/');
    await page.getByRole('button', { name: 'Weston, playing Bob' }).click();
    await expect(page.getByRole('form', { name: 'Join as Weston' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Join as Weston' })).toBeVisible();
    await page.getByLabel('Table code').fill('definitely-not-the-code');
    await page.getByRole('button', { name: 'Enter as Weston' }).click();
    await expect(page.getByRole('alert')).toContainText('not accepted');
    await expect(page.locator('main#main')).toHaveCount(0); // still on the first screen
    // Nothing was stored for Weston on this device.
    expect(await page.evaluate(() => localStorage.getItem('chronicle-accounts'))).toBeNull();
  });

  test('players join with the code, then switch between each other on a shared device without a code', async ({ page }) => {
    await clearEnrollmentLimit();
    const { playerCode } = localCredentials();
    const join = async (player: string, character: string) => {
      await page.goto('/table');
      await page.getByRole('button', { name: `${player}, playing ${character}` }).click();
      await page.getByLabel('Table code').fill(playerCode);
      await page.getByRole('button', { name: `Enter as ${player}` }).click();
      await expect(page.locator('main#main')).toBeVisible();
      await expect(page.getByText(`Signed in as ${player}`)).toBeVisible();
    };
    await join('Weston', 'Bob');
    await join('Sybil', 'Swift Claw');

    // Back at the table: both are known here, so a tap switches (no code), and says who is current.
    await page.goto('/table');
    await expect(page.getByRole('button', { name: 'Sybil, playing Swift Claw' })).toContainText('This is you');
    await expect(page.getByRole('button', { name: 'Weston, playing Bob' })).toContainText('Signed in on this device');
    await expect(page.getByRole('button', { name: 'Eliza, playing Frost' })).toContainText('Tap to join');
    await page.getByRole('button', { name: 'Weston, playing Bob' }).click();
    await expect(page.locator('main#main')).toBeVisible();
    await expect(page.getByText('Signed in as Weston')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Signed in as Weston')).toBeVisible();

    // The menu offers the same switch.
    await page.getByRole('link', { name: 'Who’s at the table?' }).first().click();
    await expect(page).toHaveURL(/\/table$/);
  });

  test('a player never sees DM content or DM pages, and the DM card does not sign them in as the DM', async ({ page, context }) => {
    await clearEnrollmentLimit();
    const api = recordApi(context);
    const { playerCode } = localCredentials();
    await page.goto('/');
    await page.getByRole('button', { name: 'Eliza, playing Frost' }).click();
    await page.getByLabel('Table code').fill(playerCode);
    await page.getByRole('button', { name: 'Enter as Eliza' }).click();
    await expect(page.locator('main#main')).toBeVisible();
    await page.goto('/dm');
    await expect(page.getByRole('heading', { name: 'Nothing written here yet' })).toBeVisible();
    await page.goto('/table');
    await page.getByRole('button', { name: 'Dungeon Master' }).click();
    await expect(page.getByLabel('DM passcode')).toBeVisible();
    for (const b of api) expect(b.body).not.toContain('Masked Broker');
  });

  test('another name still works through "Someone else" with the access code', async ({ page }) => {
    await clearEnrollmentLimit();
    const { playerCode } = localCredentials();
    await page.goto('/');
    await openOtherForm(page);
    await page.getByLabel('Access code').fill(playerCode);
    await page.getByLabel('Your name at the table').fill('Guest Tester');
    await page.getByRole('button', { name: 'Enter Chronicle' }).click();
    await expect(page.getByText('Signed in as Guest Tester')).toBeVisible();
  });
});

test.describe('the DM screen', () => {
  test.beforeEach(async () => { await resetLocalDmGate(); });

  test('the passcode alone signs the DM in; a wrong passcode opens nothing; there is no email or password', async ({ page, context }) => {
    const api = recordApi(context);
    await page.goto('/');
    await page.getByRole('button', { name: 'Dungeon Master' }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByLabel('Email')).toHaveCount(0);
    await expect(page.getByLabel('Password')).toHaveCount(0);
    await page.getByLabel('DM passcode').fill('11111');
    await page.getByRole('button', { name: 'Open the DM screen' }).click();
    await expect(page.getByRole('alert')).toContainText('not accepted');
    await expect(page.locator('main#main')).toHaveCount(0);
    // A wrong passcode never reached the database as the DM.
    expect(api.filter((b) => b.url.includes('/rest/v1/dm_notes'))).toHaveLength(0);

    await page.getByLabel('DM passcode').fill(E2E_DM_PASSCODE);
    await page.getByRole('button', { name: 'Open the DM screen' }).click();
    await expect(page.locator('main#main')).toBeVisible();
    await page.goto('/dm');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.goto('/dm/notes');
    await expect(page.locator('main#main')).toBeVisible();
    await expect(page.getByLabel('DM passcode')).toHaveCount(0);
  });

  test('wrong guesses are limited, and the right passcode is refused while the limit holds', async ({ page }) => {
    await page.goto('/sign-in');
    for (let i = 0; i < 5; i += 1) {
      await page.getByLabel('DM passcode').fill(`9999${i}`);
      await page.getByRole('button', { name: 'Open the DM screen' }).click();
      await expect(page.getByRole('alert')).toContainText('not accepted');
    }
    await page.getByLabel('DM passcode').fill(E2E_DM_PASSCODE);
    await page.getByRole('button', { name: 'Open the DM screen' }).click();
    await expect(page.getByRole('alert')).toContainText('Too many attempts');
    await expect(page.locator('main#main')).toHaveCount(0);
  });

  test('a signed-in DM without the passcode in this browser sees the lock, not the DM pages', async ({ page, context }) => {
    await page.goto('/sign-in');
    await passDmScreen(page);
    await expect(page.locator('main#main')).toBeVisible();

    await context.clearCookies(); // the DM screen's cookie is gone; the account's sign-in remains
    await page.goto('/dm/notes');
    await expect(page.getByLabel('DM passcode')).toBeVisible();
    await expect(page.locator('main#main')).toHaveCount(0);
    await page.getByLabel('DM passcode').fill(E2E_DM_PASSCODE);
    await page.getByRole('button', { name: 'Open the DM screen' }).click();
    await expect(page.locator('main#main')).toBeVisible();

    // "Lock the DM screen" closes it again.
    await page.getByRole('button', { name: 'Lock the DM screen' }).click();
    await expect(page.getByLabel('DM passcode')).toBeVisible();
  });

  test('the server never reveals the passcode, and a forged cookie opens nothing', async ({ page, request }) => {
    const scripts: string[] = [];
    page.on('response', async (res) => {
      if (res.request().resourceType() === 'script') scripts.push(await res.text().catch(() => ''));
    });
    await page.goto('/sign-in');
    await expect(page.getByLabel('DM passcode')).toBeVisible();
    // Load the lazily split bundles too.
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(scripts.length).toBeGreaterThan(0);
    for (const js of scripts) expect(js).not.toContain(E2E_DM_PASSCODE);

    const url = new URL(page.url()).origin;
    expect(await (await request.get(`${url}/api/dm-gate`)).json()).toEqual({ configured: true, open: false });
    const forged = await request.get(`${url}/api/dm-gate`, { headers: { cookie: `chronicle_dm_gate=${Math.floor(Date.now() / 1000) + 3600}.${'a'.repeat(64)}` } });
    expect(await forged.json()).toEqual({ configured: true, open: false });
    // Another site cannot submit a passcode on a DM's behalf.
    const cross = await request.post(`${url}/api/dm-gate`, { headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, data: { passcode: E2E_DM_PASSCODE } });
    expect(cross.status()).toBe(403);
  });
});
