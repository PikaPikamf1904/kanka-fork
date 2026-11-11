import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { enrollAsPlayer, localCredentials, noHorizontalOverflow, signInAsDm } from './support.ts';

// Synthetic sample characters only. Screenshots go to docs/chronicle/screenshots-characters/.
const shots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots-characters');
async function shot(page: Page, name: string) {
  fs.mkdirSync(shots, { recursive: true });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
}

test.describe('Character encyclopedia', () => {
  test('directory: portrait cards with known facts, groups, search and letters (desktop)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await enrollAsPlayer(page, 'Directory Reader');
    await page.goto('/browse/character');
    const cards = page.locator('.character-grid .card-portrait');
    await expect(cards.first()).toBeVisible();
    const total = await cards.count();
    expect(total).toBeGreaterThanOrEqual(6);
    await expect(page.locator('.card-meta').first()).toContainText(/\w/);
    // Short list: one grid, several cards per row.
    const [c0, c1] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
    expect(Math.abs(c0!.y - c1!.y)).toBeLessThan(4);
    await shot(page, 'directory-desktop');

    await page.getByRole('button', { name: 'Party members' }).click();
    const party = await cards.count();
    expect(party).toBeGreaterThan(0);
    expect(party).toBeLessThan(total);
    await expect(page.locator('.badge-party').first()).toBeVisible();
    await page.getByRole('button', { name: 'All characters' }).click();

    // Keyboard: the filter box is reachable and filters as you type.
    const filter = page.getByRole('searchbox', { name: 'Filter characters' });
    await filter.fill('zzzz-no-such-character');
    await expect(page.getByText('No characters match those filters.')).toBeVisible();
    await filter.fill('merrin');
    await expect(cards).toHaveCount(1);
    await cards.first().click();
    await expect(page).toHaveURL(/\/wiki\/captain-merrin-vael$/);
  });

  test('directory and profile on a phone: two columns, no sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enrollAsPlayer(page, 'Phone Reader');
    await page.goto('/browse/character');
    const cards = page.locator('.character-grid .card-portrait');
    await expect(cards.nth(1)).toBeVisible();
    // Cards are grouped by first letter, so check the column width rather than neighbours.
    const box = await cards.nth(0).boundingBox();
    expect(box!.width).toBeLessThan(195); // half of a 390px screen: two columns
    await noHorizontalOverflow(page);
    await shot(page, 'directory-phone');
    await page.goto('/wiki/captain-merrin-vael');
    await expect(page.getByRole('heading', { level: 1, name: 'Captain Merrin Vael' })).toBeVisible();
    await noHorizontalOverflow(page);
    await shot(page, 'profile-phone');
  });

  test('profile: facts without empty rows; DM-only material is absent from the player page and its data', async ({ page, browser }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bodies: string[] = [];
    page.on('response', async (res) => { if (res.url().includes(':54321/')) bodies.push(await res.text().catch(() => '')); });
    await enrollAsPlayer(page, 'Profile Reader');
    await page.goto('/wiki/captain-merrin-vael');
    const box = page.getByRole('complementary', { name: /at a glance/ });
    await expect(box).toContainText('Human');
    await expect(box.locator('dd', { hasText: /^—$/ })).toHaveCount(0);
    await page.goto('/wiki/aella-test-smith');
    await expect(page.getByRole('heading', { name: 'Personality' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'History' })).toHaveCount(0); // empty section: no dead heading
    await expect(page.getByRole('complementary', { name: /at a glance/ })).not.toContainText('Status'); // empty fact: no row
    await page.goto('/wiki/captain-merrin-vael');
    await expect(page.getByRole('navigation', { name: 'On this character page' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const html = await page.content();
    for (const secret of ['True identity', 'Masked Broker', 'Secrets', 'rigged to sink']) {
      expect(html, secret).not.toContain(secret);
      expect(bodies.join('\n'), secret).not.toContain(secret);
    }
    await shot(page, 'profile-desktop-player');

    const dmContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const dm = await dmContext.newPage();
    await signInAsDm(dm);
    await dm.goto('/wiki/captain-merrin-vael');
    await expect(dm.getByRole('complementary', { name: /at a glance/ })).toContainText('True identity');
    await shot(dm, 'profile-desktop-dm');
    await dm.goto('/dm/edit/captain-merrin-vael');
    await expect(dm.getByLabel('Title', { exact: true }).first()).toHaveValue('Captain Merrin Vael');
    await shot(dm, 'editor-desktop-dm');
    await dmContext.close();
  });

  test('two editor tabs: the second save is refused with a conflict and loses nothing already saved', async ({ browser }) => {
    const context = await browser.newContext();
    const a = await context.newPage();
    await signInAsDm(a);
    await a.goto('/dm/edit/kaela-brightwind');
    const b = await context.newPage();
    await b.goto('/dm/edit/kaela-brightwind');
    await expect(b.getByLabel('Summary').first()).toBeVisible();
    const stamp = Date.now().toString(36);
    await a.getByLabel('Summary').first().fill(`Saved from tab A ${stamp}`);
    await a.getByRole('button', { name: 'Save' }).first().click();
    await expect(a.getByText('Saved.')).toBeVisible();
    await b.getByLabel('Summary').first().fill(`Stale tab B ${stamp}`);
    await b.getByRole('button', { name: 'Save' }).first().click();
    await expect(b.getByText('This article was changed somewhere else')).toBeVisible();
    await a.goto('/wiki/kaela-brightwind');
    await expect(a.getByText(`Saved from tab A ${stamp}`)).toBeVisible();
    await context.close();
  });

  test('review page: the DM sees a proposed change field by field and approves it', async ({ page }) => {
    await signInAsDm(page);
    const slug = `review-test-${Date.now().toString(36)}`;
    const preview = await page.evaluate(async (s) => {
      const key = Object.keys(localStorage).find((k) => k.includes('auth'))!;
      const session = JSON.parse(localStorage.getItem(key)!);
      const token = session.access_token ?? session.currentSession?.access_token;
      const base = (performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/rest/v1/')) ?? '').split('/rest/v1/')[0];
      const res = await fetch(`${base}/rest/v1/rpc/preview_change_set`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, apikey: token },
        body: JSON.stringify({ p_change_set: { label: 'Synthetic proposal', changes: [
          { operation: 'create_article', slug: s, title: 'Aella Test-Smith', type: 'character', summary: 'A cautious inventor.' },
          { operation: 'upsert_infobox_field', article_slug: s, label: 'Race', value: 'Gnome' },
          { operation: 'upsert_section', article_slug: s, heading: 'Personality', body: 'Talks quickly.' }] } }) });
      return (await res.json()) as { preview_id: string };
    }, slug);
    expect(preview.preview_id).toBeTruthy();
    await page.goto(`/dm/review/${preview.preview_id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Synthetic proposal' })).toBeVisible();
    await expect(page.getByText('Nothing has been saved.')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Gnome' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Personality: Talks quickly.' })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Approve these changes' }).click();
    await expect(page.getByTestId('review-status')).toContainText('Approved. Waiting for the assistant to save them.');
    await page.goto(`/wiki/${slug}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Aella Test-Smith' })).toHaveCount(0); // approval alone saves nothing
    await page.goto('/dm/review/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('heading', { name: 'Review not found' })).toBeVisible();
  });
});

test.describe('Assistant sign-in', () => {
  test('signing in from the access screen returns to the consent request instead of the home page', async ({ page }) => {
    const { dmEmail, dmPassword } = localCredentials();
    const consent = '/dm/connect?authorization_id=synthetic-request';
    await page.goto(consent);
    await page.getByRole('link', { name: 'Sign in with an account' }).click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fdm%2Fconnect%3Fauthorization_id%3Dsynthetic-request$/);
    await page.getByLabel('Email').fill(dmEmail);
    await page.getByLabel('Password').fill(dmPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(new RegExp(`${consent.replace(/[?]/g, '\\?')}$`));
  });

  test('a next address pointing at another site is ignored', async ({ page }) => {
    await page.goto('/sign-in?next=//evil.example/steal');
    await expect(page.getByLabel('Email')).toBeVisible();
    const { dmEmail, dmPassword } = localCredentials();
    await page.getByLabel('Email').fill(dmEmail);
    await page.getByLabel('Password').fill(dmPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  });
});
