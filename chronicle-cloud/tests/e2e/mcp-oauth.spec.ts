// A real MCP client connection, end to end on the local stack: discovery from the MCP server,
// dynamic client registration, PKCE authorisation with the DM's consent in the browser, token
// exchange and refresh, MCP calls over HTTP to the Worker (Cloudflare's local runtime), and a
// proposal that is saved only after the DM approves it on the website. Synthetic data only.
import crypto from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { signInAsDm } from './support.ts';

const MCP = 'http://127.0.0.1:8789';
const REDIRECT = 'http://127.0.0.1:8790/callback';
const b64url = (buf: Buffer) => buf.toString('base64url');

interface Tokens { access_token: string; refresh_token: string; token_type: string; expires_in: number }

async function rpc(token: string, method: string, params: Record<string, unknown> = {}, id = 1) {
  const res = await fetch(`${MCP}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  expect(res.status, `${method} status`).toBe(200);
  return (await res.json()) as { result?: Record<string, unknown>; error?: { message: string } };
}
async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const r = await rpc(token, 'tools/call', { name, arguments: args });
  const result = r.result as { structuredContent: Record<string, unknown>; isError: boolean };
  return { ...result.structuredContent, isError: result.isError } as Record<string, unknown> & { isError: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
}

/** The authorisation server, found exactly the way an MCP client finds it. */
async function discover() {
  const challenge = await fetch(`${MCP}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(challenge.status).toBe(401);
  const header = challenge.headers.get('www-authenticate') ?? '';
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(header)?.[1];
  expect(metadataUrl).toBe(`${MCP}/.well-known/oauth-protected-resource`);
  const resource = (await (await fetch(metadataUrl!)).json()) as { resource: string; authorization_servers: string[] };
  expect(resource.resource).toBe(`${MCP}/mcp`);
  const issuer = new URL(resource.authorization_servers[0]!);
  // RFC 8414: /.well-known/oauth-authorization-server inserted before the issuer's path.
  const meta = (await (await fetch(`${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`)).json()) as Record<string, string>;
  expect(meta.issuer).toBe(resource.authorization_servers[0]);
  return meta;
}

async function connect(page: Page, meta: Record<string, string>, clientName: string) {
  const reg = await fetch(meta.registration_endpoint!, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: clientName, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
  expect(reg.status, await reg.clone().text()).toBeLessThan(300);
  const client = (await reg.json()) as { client_id: string };

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(12));
  const authorize = new URL(meta.authorization_endpoint!);
  for (const [k, v] of Object.entries({ response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state })) authorize.searchParams.set(k, v);

  // The browser lands on Chronicle's consent page; the redirect back to the client is caught here.
  let callback: URL | null = null;
  await page.route(`${REDIRECT}*`, (route) => {
    callback = new URL(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Connected. You can close this window.' });
  });
  await page.goto(authorize.toString());
  await expect(page).toHaveURL(/\/dm\/connect\?authorization_id=/);
  await expect(page.locator('p', { hasText: 'is asking to connect to this wiki as you.' })).toContainText(clientName);
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect.poll(() => callback?.toString() ?? '').toContain(REDIRECT);
  const cb = callback as unknown as URL;
  expect(cb.searchParams.get('state')).toBe(state);
  const code = cb.searchParams.get('code');
  expect(code).toBeTruthy();

  const tokenRes = await fetch(meta.token_endpoint!, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: code!, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier }),
  });
  expect(tokenRes.status, await tokenRes.clone().text()).toBe(200);
  return { client, tokens: (await tokenRes.json()) as Tokens };
}

test.describe('MCP: a real OAuth client connection', () => {
  test('discover, register, consent, exchange, call tools over HTTP, refresh, and save a proposal only after website approval', async ({ page }) => {
    test.setTimeout(120_000);
    const meta = await discover();
    expect(meta.code_challenge_methods_supported).toContain('S256');

    await signInAsDm(page);
    const { client, tokens } = await connect(page, meta, 'Synthetic Assistant');
    const claims = JSON.parse(Buffer.from(tokens.access_token.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
    expect(claims.client_id).toBe(client.client_id);

    // MCP over HTTP with the real token.
    const init = await rpc(tokens.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'synthetic', version: '1' } });
    expect((init.result as { serverInfo: { name: string } }).serverInfo.name).toBe('chronicle-mcp');
    const list = await rpc(tokens.access_token, 'tools/list');
    const names = ((list.result as { tools: { name: string }[] }).tools).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['chronicle_search', 'chronicle_apply_changes']));

    const who = await tool(tokens.access_token, 'chronicle_whoami');
    expect(who.isError).toBe(false);
    expect(who.data).toMatchObject({ role: 'dm', mfa_satisfied: true });

    const found = await tool(tokens.access_token, 'chronicle_search', { query: 'Vellmoor' });
    expect(found.isError).toBe(false);
    expect(JSON.stringify(found.data)).toContain('port-vellmoor');

    // The same token cannot write directly to the Data API (assistant write boundary).
    const direct = await fetch('http://127.0.0.1:54321/rest/v1/articles?slug=eq.port-vellmoor', {
      method: 'PATCH', headers: { authorization: `Bearer ${tokens.access_token}`, apikey: 'unused', 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify({ summary: 'Changed by an assistant directly.' }),
    });
    expect(direct.status).toBe(403);

    // A proposal: nothing is saved until the DM approves it on the website.
    const slug = `synthetic-ally-${Date.now().toString(36)}`;
    const preview = await tool(tokens.access_token, 'chronicle_create_character_draft', { source_kind: 'dm_confirmed', draft: { title: 'Synthetic Ally', slug, summary: 'A synthetic test character.' } });
    expect(preview.isError, JSON.stringify(preview)).toBe(false);
    const p = preview.data as { preview_id: string; digest: string; review_url: string };
    const early = await tool(tokens.access_token, 'chronicle_apply_changes', { preview_id: p.preview_id, digest: p.digest, idempotency_key: `oauth-e2e-${slug}` });
    expect(early.isError).toBe(true);
    expect(early.error?.code).toBe('FORBIDDEN');

    await page.goto(new URL(p.review_url).pathname);
    await page.getByRole('button', { name: 'Approve these changes' }).click();
    await expect(page.getByText('Approved. Waiting for the assistant to save them.')).toBeVisible();

    // Refresh the access token, as a client does when it expires, and apply with the new one.
    const refreshed = await fetch(meta.token_endpoint!, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id }),
    });
    expect(refreshed.status, await refreshed.clone().text()).toBe(200);
    const next = (await refreshed.json()) as Tokens;
    // A refresh always rotates the refresh token. The access token is not compared: one issued in
    // the same second with the same claims can be byte-identical, which made this check flaky.
    expect(next.access_token).toBeTruthy();
    expect(next.refresh_token).toBeTruthy();
    expect(next.refresh_token).not.toBe(tokens.refresh_token);

    const applied = await tool(next.access_token, 'chronicle_apply_changes', { preview_id: p.preview_id, digest: p.digest, idempotency_key: `oauth-e2e-${slug}` });
    expect(applied.isError, JSON.stringify(applied)).toBe(false);
    const again = await tool(next.access_token, 'chronicle_apply_changes', { preview_id: p.preview_id, digest: p.digest, idempotency_key: `oauth-e2e-${slug}` });
    expect(again.isError).toBe(false); // the same key returns the stored result

    await page.goto(`/wiki/${slug}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Synthetic Ally' })).toBeVisible();
    await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();

    // A bad or tampered token is refused at the door.
    const bad = await fetch(`${MCP}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${next.access_token.slice(0, -4)}AAAA`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(bad.status).toBe(401);
  });

  test('refusing the connection gives the client no code and no token', async ({ page }) => {
    const meta = await discover();
    await signInAsDm(page);
    const reg = await fetch(meta.registration_endpoint!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Refused Assistant', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }) });
    const client = (await reg.json()) as { client_id: string };
    const verifier = b64url(crypto.randomBytes(32));
    const authorize = new URL(meta.authorization_endpoint!);
    for (const [k, v] of Object.entries({ response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', state: 's' })) authorize.searchParams.set(k, v);
    let callback: URL | null = null;
    await page.route(`${REDIRECT}*`, (route) => {
      callback = new URL(route.request().url());
      return route.fulfill({ status: 200, body: 'refused' });
    });
    await page.goto(authorize.toString());
    await page.getByRole('button', { name: 'Refuse' }).click();
    await expect.poll(() => callback?.toString() ?? '').toContain(REDIRECT);
    const cb = callback as unknown as URL;
    expect(cb.searchParams.get('code')).toBeNull();
    expect(cb.searchParams.get('error')).toBeTruthy();
  });
});
