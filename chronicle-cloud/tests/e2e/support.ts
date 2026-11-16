import fs from 'node:fs';
import path from 'node:path';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';
import { assertDisposableDatabase, readLocalEnv } from '../../scripts/local-targets.mjs';

const root = path.resolve(import.meta.dirname, '../..');

export function localCredentials() {
  const text = fs.readFileSync(path.join(root, '.local/dev-credentials'), 'utf8');
  const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '';
  return { dmEmail: get('DM_EMAIL'), dmPassword: get('DM_PASSWORD'), playerCode: get('PLAYER_CODE') };
}

/** Text that exists only in DM-only rows of the synthetic sample. A player must never receive it. */
export const SAMPLE_SECRETS = [
  'Masked Broker', 'on the orders of', 'Vessa Rook', 'smugglers', 'North watchtower', 'Villains',
  'Nest intelligence', 'betray the party', 'unseen moon', 'rigged to sink', 'Ambush at the docks',
  'invisible writing', 'blackmail', 'safehouse', 'the-firestarter', 'Inside the Dragon Nest',
  'Pacing', 'Campaign arc', 'two young dragons', 'Into the Caldera',
  'GAZETTEDRAFT', 'Secret Talks',
];

export const shotDir = path.join(root, 'test-results', 'screenshots');

export async function screenshot(page: Page, name: string) {
  fs.mkdirSync(shotDir, { recursive: true });
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.prose-loading')).toHaveCount(0);
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: false });
}

/** Record every Supabase API response body this context receives. */
export function recordApi(context: BrowserContext) {
  const bodies: { url: string; body: string }[] = [];
  context.on('response', async (res) => {
    if (!res.url().includes(':54321/')) return;
    if (res.request().resourceType() === 'image') return;
    try {
      bodies.push({ url: res.url(), body: await res.text() });
    } catch {
      // Redirects and aborted requests have no body.
    }
  });
  return bodies;
}

/**
 * Every synthetic player enrols from 127.0.0.1, so a full run would reach the real 20-per-hour
 * enrolment limit (tested separately in tests/db). Clear the LOCAL attempt log before each one.
 */
async function resetLocalEnrollmentLimit() {
  const url = readLocalEnv().DATABASE_URL;
  if (!url) throw new Error('Missing local database URL.');
  await assertDisposableDatabase(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('delete from public.enrollment_attempts');
  } finally {
    await client.end();
  }
}

export async function enrollAsPlayer(page: Page, name = 'Test Player') {
  await resetLocalEnrollmentLimit();
  const { playerCode } = localCredentials();
  await page.goto('/');
  await page.getByLabel('Access code').fill(playerCode);
  await page.getByLabel('Your name at the table').fill(name);
  await page.getByRole('button', { name: 'Enter Chronicle' }).click();
  await expect(page.locator('main#main')).toBeVisible();
}

export async function signInAsDm(page: Page) {
  const { dmEmail, dmPassword } = localCredentials();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(dmEmail);
  await page.getByLabel('Password').fill(dmPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('main#main')).toBeVisible();
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
