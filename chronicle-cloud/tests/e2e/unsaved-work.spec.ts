// Unsaved work is never silently replaced, and review actions never act on text the DM has not
// saved or has not seen. Synthetic sample content only.
import { expect, test } from '@playwright/test';
import { signInAsDm } from './support.ts';

test.describe('Unsaved work', () => {
  test('adding a note or a connection while editing keeps the unsaved article text, and it still saves', async ({ page }) => {
    const marker = `Unsaved title ${Date.now().toString(36)}`;
    await signInAsDm(page);
    await page.goto('/dm/edit/port-vellmoor');
    const title = page.getByLabel('Title', { exact: true }).first();
    await expect(title).toHaveValue('Port Vellmoor');
    await title.fill(marker);
    await expect(page.getByText('Unsaved changes')).toBeVisible();

    // A secondary operation that reloads the page data and moves the article's version.
    await page.getByLabel('Note', { exact: true }).fill('Synthetic private note.');
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByText('Synthetic private note.')).toBeVisible();
    await page.getByLabel('Connected article').selectOption({ label: 'Captain Merrin Vael' });
    await page.getByLabel('Connection note').fill('Synthetic connection');
    await page.getByRole('button', { name: 'Add connection' }).click();
    await expect(page.getByText('Synthetic connection')).toBeVisible();

    await expect(title).toHaveValue(marker);
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Title', { exact: true }).first()).toHaveValue(marker);
    await page.getByLabel('Title', { exact: true }).first().fill('Port Vellmoor');
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  });

  test('Gazette: review buttons refuse unsaved text, leaving asks first, and a stale tab cannot approve', async ({ page, context }) => {
    await signInAsDm(page);
    await page.goto('/dm/news/edit/harbourmaster-secret-talks');
    const headline = page.getByLabel('Headline', { exact: true });
    await expect(headline).toHaveValue(/Harbourmaster in Secret Talks/);
    await expect(page.getByText('In review: players cannot see this story.')).toBeVisible();
    const original = await headline.inputValue();

    // A second tab opens the same story before anything changes.
    const stale = await context.newPage();
    await stale.goto('/dm/news/edit/harbourmaster-secret-talks');
    await expect(stale.getByLabel('Headline', { exact: true })).toHaveValue(original);

    await headline.fill(`${original} (edited)`);
    await expect(page.getByText('Save before sending for review, approving or printing.')).toBeVisible();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Save your changes first.' })).toBeVisible();
    await expect(headline).toHaveValue(`${original} (edited)`);
    await expect(page.getByText('In review: players cannot see this story.')).toBeVisible();

    // Leaving with unsaved text asks first; declining keeps the text.
    page.once('dialog', (d) => void d.dismiss());
    await page.getByRole('link', { name: 'Back to the desk' }).click();
    await expect(page).toHaveURL(/\/dm\/news\/edit\/harbourmaster-secret-talks$/);
    await expect(headline).toHaveValue(`${original} (edited)`);

    await page.getByRole('button', { name: 'Save story' }).click();
    await expect(page.getByText('Saved. Players cannot see it until you print it.')).toBeVisible();

    // The stale tab still shows the old text: it must not be able to move the story on.
    await stale.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(stale.getByRole('alert').filter({ hasText: 'changed somewhere else' })).toBeVisible();
    await stale.reload();
    await expect(stale.getByText('In review: players cannot see this story.')).toBeVisible();
    await expect(stale.getByLabel('Headline', { exact: true })).toHaveValue(`${original} (edited)`);

    // Put the sample story back.
    await stale.getByLabel('Headline', { exact: true }).fill(original);
    await stale.getByRole('button', { name: 'Save story' }).click();
    await expect(stale.getByText('Saved. Players cannot see it until you print it.')).toBeVisible();
  });
});
