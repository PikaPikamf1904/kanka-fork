import path from 'node:path';
import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, recordApi, signInAsDm } from './support.ts';

// Feedback Center: a player sends signed and anonymous feedback, another player sees none of it,
// and the DM triages and replies. Synthetic text only.

const docsShots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');
const NAMED = 'Zzfeedback: could the map load faster?';
const ANON = 'Zzfeedback: the spider scene was too much for me';

test.describe('Feedback Center', () => {
  test.beforeEach(() => db(`delete from public.feedback where body like 'Zzfeedback%'`));
  test.afterEach(() => db(`delete from public.feedback where body like 'Zzfeedback%'`));

  test('signed and anonymous feedback reach only the DM; the DM replies to the signed one', async ({ browser }) => {
    const playerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const player = await playerContext.newPage();
    const name = `Feedback Writer ${Date.now().toString(36)}`;
    await enrollAsPlayer(player, name);
    await player.goto('/feedback');

    await player.getByLabel('What is it about?').selectOption('improvement');
    await player.getByLabel('Your message').fill(NAMED);
    await player.getByRole('button', { name: 'Send to the DM' }).click();
    await expect(player.getByRole('status').filter({ hasText: 'Sent. Thank you!' })).toBeVisible();
    await expect(player.getByText(NAMED)).toBeVisible();

    await player.getByLabel('What is it about?').selectOption('comfort');
    await expect(player.getByText('You don’t need to explain or justify anything')).toBeVisible();
    await player.getByLabel('Your message').fill(ANON);
    await player.getByLabel(/Anonymously/).check();
    await expect(player.getByTestId('anonymity-note')).toContainText('complete anonymity cannot be promised');
    await noHorizontalOverflow(player);
    if (process.env.SAVE_DOC_SHOTS === '1') await player.screenshot({ path: path.join(docsShots, 'feedback-phone.png'), fullPage: true });
    await player.getByRole('button', { name: 'Send to the DM' }).click();
    await expect(player.getByRole('status').filter({ hasText: 'Sent anonymously' })).toBeVisible();
    // Anonymous feedback is not listed back, even to its writer.
    await player.reload();
    await expect(player.getByText(ANON)).toHaveCount(0);

    // The stored anonymous row carries no account or name.
    const rows = await db<{ author_id: string | null; author_name: string | null }>(`select author_id, author_name from public.feedback where body = $1`, [ANON]);
    expect(rows).toEqual([{ author_id: null, author_name: null }]);

    // Another player sees none of it, on screen or in any response.
    const otherContext = await browser.newContext();
    const bodies = recordApi(otherContext);
    const other = await otherContext.newPage();
    await enrollAsPlayer(other, 'Feedback Bystander');
    await other.goto('/feedback');
    await expect(other.getByText('Nothing yet.')).toBeVisible();
    for (const b of bodies) {
      expect(b.body, b.url).not.toContain('Zzfeedback');
    }
    await otherContext.close();

    // The DM: boundaries first, anonymous shown as such, a reply to the signed one.
    const dmContext = await browser.newContext();
    const dm = await dmContext.newPage();
    await signInAsDm(dm);
    await dm.goto('/dm/feedback');
    const comfort = dm.getByRole('region', { name: /Boundaries and discomfort/ });
    const anonItem = comfort.getByTestId('feedback-item').filter({ hasText: ANON });
    await expect(anonItem).toContainText('Anonymous');
    await expect(anonItem).not.toContainText(name);
    if (process.env.SAVE_DOC_SHOTS === '1') await dm.screenshot({ path: path.join(docsShots, 'feedback-inbox.png'), fullPage: true });
    const named = dm.getByTestId('feedback-item').filter({ hasText: NAMED });
    await expect(named).toContainText(`From ${name}`);
    await named.getByText('Notes and reply').click();
    await named.getByLabel(/Reply to/).fill('Thanks, looking into it.');
    await named.getByRole('button', { name: 'Send reply' }).click();
    await named.getByLabel('Status').selectOption('in_progress');
    await expect(named.getByLabel('Status')).toHaveValue('in_progress');

    await player.reload();
    await expect(player.getByText('Thanks, looking into it.')).toBeVisible();
    await expect(player.getByText('Being worked on')).toBeVisible();
    await dmContext.close();
    await playerContext.close();
  });

  test('players cannot open the DM inbox', async ({ page }) => {
    await enrollAsPlayer(page, 'Inbox Probe');
    await page.goto('/dm/feedback');
    await expect(page.getByRole('heading', { name: 'Player feedback' })).toHaveCount(0);
  });
});
