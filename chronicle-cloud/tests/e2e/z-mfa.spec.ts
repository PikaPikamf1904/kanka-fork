// Runs last (file name): turns two-step sign-in on for the local DM, proves the second step is
// required, then turns it off again so other runs can sign in with a password.
import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { localCredentials } from './support.ts';

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of input.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP, SHA-1, 6 digits, 30 s. */
function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

async function nextWindow() {
  await new Promise((r) => setTimeout(r, 30000 - (Date.now() % 30000) + 500));
}

test('two-step sign-in is required for the DM once enabled', async ({ page }) => {
  test.setTimeout(150_000);
  const { dmEmail, dmPassword } = localCredentials();
  const signIn = async () => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(dmEmail);
    await page.getByLabel('Password').fill(dmPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('main#main').or(page.getByLabel('Code from your authenticator app'))).toBeVisible();
  };

  await signIn();
  await page.goto('/dm/settings');
  await page.getByRole('button', { name: 'Set up two-step sign-in' }).click();
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  const secret = (await page.locator('.panel code').innerText()).trim();
  await page.getByLabel('Code from the app').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and turn on' }).click();
  await expect(page.getByText('Two-step sign-in is on.').first()).toBeVisible();

  // Sign out and back in: the password alone now stops at the code screen.
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Access code')).toBeVisible();
  await signIn();
  await expect(page.getByLabel('Code from your authenticator app')).toBeVisible();
  await page.goto('/dm/notes');
  await expect(page.getByLabel('Code from your authenticator app')).toBeVisible();

  await nextWindow();
  await page.getByLabel('Code from your authenticator app').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.locator('main#main')).toBeVisible();
  await page.goto('/dm/notes');
  await expect(page.getByRole('heading', { name: /Private notes/ })).toBeVisible();

  // Clean up for the next run.
  await page.goto('/dm/settings');
  await page.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByRole('button', { name: 'Set up two-step sign-in' })).toBeVisible();
});
