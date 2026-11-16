import path from 'node:path';
import { expect, test } from '@playwright/test';
import { db } from './db.ts';
import { enrollAsPlayer, noHorizontalOverflow, recordApi, signInAsDm } from './support.ts';

// Faction organisation chart from "Member of" connections, made and removed here: a guild with a
// leader, a plain member, a sub-faction with a captain, and a DM-only spy and DM-only membership.

const docsShots = path.resolve(import.meta.dirname, '../../../docs/chronicle/screenshots');

const S = { guild: 'zz-org-guild', wing: 'zz-org-wing', lead: 'zz-org-lead', mem: 'zz-org-member', cap: 'zz-org-captain', spy: 'zz-org-spy', mole: 'zz-org-mole' };

async function make(slug: string, title: string, type: string, visibility: 'players' | 'dm' = 'players') {
  const [r] = await db<{ id: string }>(`insert into public.articles (slug, type, title, summary, visibility, status) values ($1, $2, $3, '', $4, 'published') returning id`, [slug, type, title, visibility]);
  return r!.id;
}

test.describe('Faction organisation chart', () => {
  test.beforeEach(async () => {
    await db('delete from public.articles where slug = any($1)', [Object.values(S)]);
    const guild = await make(S.guild, 'Zzorg Guild', 'faction');
    const wing = await make(S.wing, 'Zzorg Night Wing', 'faction');
    const lead = await make(S.lead, 'Zzorg Leader', 'character');
    const mem = await make(S.mem, 'Zzorg Member', 'character');
    const cap = await make(S.cap, 'Zzorg Captain', 'character');
    const spy = await make(S.spy, 'Zzorg Spy', 'character', 'dm');
    const mole = await make(S.mole, 'Zzorg Mole', 'character');
    const rel = (a: string, b: string, label: string, visibility = 'players') =>
      db(`insert into public.relations (source_article_id, target_article_id, kind, label, visibility) values ($1, $2, 'member_of', $3, $4)`, [a, b, label, visibility]);
    await rel(lead, guild, 'Guildmaster');
    await rel(mem, guild, '');
    await rel(wing, guild, '');
    await rel(cap, wing, 'Captain');
    await rel(spy, guild, 'Informant');
    await rel(mole, guild, 'Secret agent', 'dm');
  });
  test.afterEach(() => db('delete from public.articles where slug = any($1)', [Object.values(S)]));

  test('the DM sees every rank; a player never sees the hidden member or membership', async ({ page, browser }) => {
    await signInAsDm(page);
    await page.goto(`/wiki/${S.guild}`);
    const chart = page.getByTestId('org-chart');
    await expect(chart.locator('.org-rank').first()).toHaveText('Guildmaster');
    for (const name of ['Zzorg Leader', 'Zzorg Member', 'Zzorg Captain', 'Zzorg Spy', 'Zzorg Mole']) await expect(chart.getByRole('link', { name })).toBeVisible();
    await expect(chart.getByRole('link', { name: 'Zzorg Night Wing' })).toHaveAttribute('href', `/wiki/${S.wing}`);
    // Each rank's list is named for screen readers.
    await expect(chart.getByRole('list', { name: 'Guildmaster of Zzorg Guild' }).getByRole('link', { name: 'Zzorg Leader' })).toBeVisible();
    if (process.env.SAVE_DOC_SHOTS === '1') await chart.screenshot({ path: path.join(docsShots, 'org-chart.png') });

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const bodies = recordApi(context);
    const player = await context.newPage();
    await enrollAsPlayer(player, 'Org Probe');
    await player.goto(`/wiki/${S.guild}`);
    const pchart = player.getByTestId('org-chart');
    await expect(pchart.getByRole('link', { name: 'Zzorg Captain' })).toBeVisible();
    await expect(pchart.getByText('Zzorg Spy')).toHaveCount(0);
    await expect(pchart.getByText('Zzorg Mole')).toHaveCount(0);
    await expect(pchart.getByText('Secret agent')).toHaveCount(0);
    await noHorizontalOverflow(player);
    for (const b of bodies) {
      expect(b.body, b.url).not.toContain('Zzorg Spy');
      expect(b.body, b.url).not.toContain('Secret agent');
    }
  });
});
