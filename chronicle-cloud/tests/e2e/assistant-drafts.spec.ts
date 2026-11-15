// Assistant drafts end to end: the MCP Worker (local runtime, over HTTP) prepares a Gazette story;
// the DM pastes it into the news desk, which fills the form only; saving makes a private draft
// that is not printed. Uses a locally signed OAuth-style token for the seeded DM. Synthetic data.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { readLocalEnv } from '../../scripts/local-targets.mjs';
import { localCredentials, signInAsDm } from './support.ts';

const root = path.resolve(import.meta.dirname, '../..');

async function dmToken() {
  const env = readLocalEnv();
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  const id = (await client.query<{ id: string }>('select id from auth.users where email = $1', [localCredentials().dmEmail])).rows[0]!.id;
  await client.end();
  const secret = fs.readFileSync(path.join(root, '.local/jwt_secret'), 'utf8').trim();
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: id, role: 'authenticated', aud: 'authenticated', iss: `${env.SUPABASE_URL}/auth/v1`, aal: 'aal1', client_id: 'synthetic-e2e-client', iat: now, exp: now + 600 });
  return `${head}.${body}.${crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}

test('an assistant proposes a Gazette story; the DM accepts it on the news desk as a private draft; nothing is printed', async ({ page }) => {
  const run = Date.now().toString(36);
  const headline = `Zz Goats Elect a Mayor ${run}`;
  const res = await fetch('http://127.0.0.1:8789/mcp', {
    method: 'POST', headers: { authorization: `Bearer ${await dmToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'chronicle_draft_gazette_story', arguments: {
      headline, deck: 'The vote was close.', opening: 'A synthetic opening.', body: 'The goats voted. See [[port-vellmoor|the port]].',
      section: 'rumors', reliability: 'rumor', reporter: 'pinchcheek', based_on: ['port-vellmoor'] } } }),
  });
  const json = (await res.json()) as { result: { structuredContent: { data: { proposal_id: string; review_url: string } }; isError: boolean } };
  expect(json.result.isError).toBe(false);
  expect(json.result.structuredContent.data.review_url).toMatch(/\/dm\/news#proposals$/);

  await signInAsDm(page);
  await page.goto('/dm/news');
  const proposal = page.getByTestId('news-proposal').filter({ hasText: headline });
  await expect(proposal).toBeVisible();
  await expect(proposal.locator('.gz-stamp', { hasText: 'Unconfirmed' })).toBeVisible();
  await proposal.getByRole('button', { name: 'Read it' }).click();
  await expect(proposal.getByText('The goats voted.')).toBeVisible();
  await proposal.getByRole('button', { name: 'Accept as a private draft' }).click();
  await expect(page).toHaveURL(new RegExp(`/dm/news/edit/zz-goats-elect-a-mayor-${run}$`));
  await expect(page.getByLabel('Headline', { exact: true })).toHaveValue(headline);
  await expect(page.getByLabel('Kind of reporting')).toHaveValue('rumor');
  await expect(page.getByLabel('Reporter')).toHaveValue('pinchcheek');
  await expect(page.getByText('Draft: players cannot see this story.')).toBeVisible();
  await page.goto('/dm/news');
  await expect(page.getByTestId('news-proposal').filter({ hasText: headline })).toHaveCount(0);
});
