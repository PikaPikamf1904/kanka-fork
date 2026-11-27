// An assistant files Gazette proposals with suggested times; the DM reads them, approves and schedules
// them together; players see nothing until each time comes. Synthetic content only.
import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, screenshot, signInAsDm } from './support.ts';

const iso = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

/** Files a proposal the way an assistant's token does (the client id is what marks it as an assistant). */
async function file(title: string, at: string | null) {
  await db(
    `with c as (select set_config('request.jwt.claims', '{"client_id":"synthetic-mcp-client"}', true))
     insert into public.news_proposals (title, subtitle, body, section, reliability, reporter, suggested_publish_at)
     select $1, 'A deck', $2, 'war', 'rumor', 'gribble', $3::timestamptz from c`,
    [title, `BATCHE2E full text of ${title}.`, at],
  );
}

test.describe('Gazette batch approval', () => {
  test('the DM reads, approves and schedules several assistant stories at once; players see none until their time', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const tag = Date.now().toString(36);
    const A = `Batch Convoy ${tag}`, B = `Batch Falls Silent ${tag}`, C = `Batch Missed Date ${tag}`;
    await db("delete from public.news_proposals");
    await file(A, iso(48));
    await file(B, iso(72));
    await file(C, iso(-30)); // a suggestion that has already passed

    await signInAsDm(page);
    await page.goto('/dm/news');
    const panel = page.locator('#proposals');
    await expect(panel.getByTestId('news-proposal')).toHaveCount(3);
    await expect(panel.getByText('this time has passed')).toHaveCount(1);
    await expect(panel.getByText('by an assistant (synthetic-mcp-client)').first()).toBeVisible();

    // Choose all. Nothing can be approved before every chosen story has been read.
    await panel.getByRole('button', { name: 'Choose all' }).click();
    const approve = panel.getByRole('button', { name: /^Accept, approve and schedule/ });
    await expect(approve).toBeDisabled();
    await expect(panel.getByText('3 not read yet')).toBeVisible();
    for (const t of [A, B, C]) {
      await panel.getByTestId('news-proposal').filter({ hasText: t }).getByRole('button', { name: 'Read the whole story' }).click();
      await expect(panel.getByText(`BATCHE2E full text of ${t}.`)).toBeVisible();
    }
    await expect(approve).toBeDisabled(); // still needs the DM's explicit confirmation
    await panel.getByLabel(/I have read these 3 stories in full/).check();
    await expect(approve).toBeEnabled();
    await screenshot(page, 'gazette-batch-proposals');
    // The missed date is never printed silently: its default is "approve only".
    await expect(panel.getByTestId('news-proposal').filter({ hasText: C }).getByLabel('What happens')).toHaveValue('hold');
    await approve.click();
    await expect(page.getByText(/Approved 3: 2 scheduled, 0 printed now, 1 approved and waiting/)).toBeVisible();
    await expect(page.locator('#proposals')).toHaveCount(0); // nothing left to propose

    // The desk: two under Scheduled, the missed one approved and waiting.
    await expect(page.getByRole('row', { name: new RegExp(A) })).toContainText('Scheduled');
    await expect(page.getByRole('row', { name: new RegExp(B) })).toContainText('Scheduled');
    await expect(page.getByRole('row', { name: new RegExp(C) })).toContainText('Approved');
    const slugA = (await db<{ slug: string }>('select slug from public.articles where title = $1', [A]))[0]!.slug;
    const slugB = (await db<{ slug: string }>('select slug from public.articles where title = $1', [B]))[0]!.slug;

    // Audit: filed by an assistant, decided by the signed-in DM.
    const audit = await db<{ created_via: string; decided_by: string | null; status: string }>('select created_via, decided_by, status from public.news_proposals where title = $1', [A]);
    expect(audit[0]).toMatchObject({ created_via: 'synthetic-mcp-client', status: 'accepted' });
    expect(audit[0]!.decided_by).not.toBeNull();

    // Players: nothing yet, by front page, address, or search.
    const player = await (await browser.newContext()).newPage();
    await enrollAsPlayer(player, 'Batch Reader');
    await player.goto('/news');
    for (const t of [A, B, C]) await expect(player.getByText(t)).toHaveCount(0);
    await player.goto(`/news/${slugA}`);
    await expect(player.getByRole('heading', { name: 'Nothing written here yet' })).toBeVisible();
    await player.goto(`/search?q=${encodeURIComponent('BATCHE2E')}`);
    await expect(player.getByText(A)).toHaveCount(0);

    // Time passes for the first story: the next visit prints it; the second stays hidden.
    await db("update public.articles set publish_at = now() - interval '2 minutes' where slug = $1", [slugA]);
    await player.goto('/news');
    await expect(player.getByRole('link', { name: A })).toBeVisible();
    await expect(player.getByText(B)).toHaveCount(0);
    await player.goto(`/news/${slugB}`);
    await expect(player.getByRole('heading', { name: 'Nothing written here yet' })).toBeVisible();

    // A phone works too.
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    await signInAsDm(phone);
    await phone.goto('/dm/news');
    await noHorizontalOverflow(phone);

    await db("delete from public.articles where title = any($1)", [[A, B, C]]);
    await db("delete from public.news_proposals where title like 'Batch %'");
    await player.close();
    await phone.close();
  });
});
