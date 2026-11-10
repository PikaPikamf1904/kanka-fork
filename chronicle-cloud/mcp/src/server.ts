// Chronicle MCP server: a stateless Streamable-HTTP JSON-RPC endpoint for Cloudflare Workers.
//
//   POST /mcp                                    MCP (initialize, tools/list, tools/call, ping)
//   GET  /.well-known/oauth-protected-resource   where to sign in (the project's Supabase Auth)
//   GET  /health                                 version only
//
// Every /mcp request needs a bearer token issued by the Supabase Auth OAuth 2.1 server of this
// project to an OAuth client. On every request the token is verified, then the DATABASE is asked
// who the caller is now (role, revoked or not, two-step state), so a revoked DM is refused on the
// next call even while the token is still unexpired.
import { AuthError, verifyToken, type AuthEnv } from './auth.ts';
import { makeDb, ToolError } from './db.ts';
import { SCOPES, TOOLS, toolErrorCode, type Ctx, type Scope, type Whoami } from './tools.ts';

export interface Env extends AuthEnv {
  SUPABASE_PUBLISHABLE_KEY: string;
  /** Address of the Chronicle website, for review links. */
  CHRONICLE_URL: string;
  /** Optional JSON: { "<client_id>": ["chronicle:read", ...], "*": [...] }. Default: all scopes. */
  MCP_CLIENT_SCOPES?: string;
}

export const SERVER = { name: 'chronicle-mcp', version: '0.1.0' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 1_100_000;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
const rpcError = (id: unknown, code: number, message: string, status = 200) => json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, status);

function scopesFor(clientId: string, env: Env): Scope[] {
  if (!env.MCP_CLIENT_SCOPES) return [...SCOPES];
  try {
    const map = JSON.parse(env.MCP_CLIENT_SCOPES) as Record<string, unknown>;
    const list = map[clientId] ?? map['*'];
    return Array.isArray(list) ? SCOPES.filter((s) => list.includes(s)) : [];
  } catch {
    return []; // A broken setting grants nothing.
  }
}

async function readBody(request: Request): Promise<unknown> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.byteLength; }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

export async function handleRequest(request: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const metadataUrl = `${url.origin}/.well-known/oauth-protected-resource`;

  if (url.pathname === '/health') return json({ ok: true, ...SERVER, protocol: PROTOCOLS[0] });
  if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') {
    return json({
      resource: `${url.origin}/mcp`,
      authorization_servers: [`${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`],
      bearer_methods_supported: ['header'],
      scopes_supported: SCOPES,
      resource_name: 'Chronicle campaign wiki',
    });
  }
  if (url.pathname !== '/mcp') return json({ error: 'Not found' }, 404);
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, { allow: 'POST' });

  const challenge = { 'www-authenticate': `Bearer resource_metadata="${metadataUrl}"` };
  const header = request.headers.get('authorization') ?? '';
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!token) return json({ error: 'UNAUTHENTICATED' }, 401, challenge);
  let claims;
  try {
    claims = await verifyToken(token, env, fetchImpl);
  } catch (error) {
    if (!(error instanceof AuthError)) console.error('mcp: token check failed');
    return json({ error: 'UNAUTHENTICATED' }, 401, { 'www-authenticate': `Bearer error="invalid_token", resource_metadata="${metadataUrl}"` });
  }

  const msg = await readBody(request);
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return rpcError(null, -32700, 'Parse error', 400);
  const { id, method, params } = msg as { id?: unknown; method?: unknown; params?: Record<string, unknown> };
  if ((msg as { jsonrpc?: unknown }).jsonrpc !== '2.0' || typeof method !== 'string') return rpcError(id, -32600, 'Invalid request', 400);
  if (id === undefined) return new Response(null, { status: 202 }); // notifications

  if (method === 'ping') return json({ jsonrpc: '2.0', id, result: {} });
  if (method === 'initialize') {
    const asked = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '';
    return json({ jsonrpc: '2.0', id, result: {
      protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER,
      instructions: 'Chronicle is a private campaign wiki. Read tools return only what the signed-in person may see. Changes are proposed as previews; the DM approves each preview in Chronicle before it can be applied. Never invent campaign facts.',
    } });
  }
  if (method === 'tools/list') {
    return json({ jsonrpc: '2.0', id, result: { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) } });
  }
  if (method !== 'tools/call') return rpcError(id, -32601, 'Method not found');

  const requestId = crypto.randomUUID();
  const reply = (payload: Record<string, unknown>, isError: boolean) => json({ jsonrpc: '2.0', id, result: {
    content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload, isError } });
  const failure = (code: string, message: string, detail: Record<string, unknown> = {}) =>
    reply({ schema_version: '1', request_id: requestId, error: { code, message, ...detail } }, true);

  const tool = TOOLS.find((t) => t.name === params?.name);
  if (!tool) return rpcError(id, -32602, 'Unknown tool');
  const args = params?.arguments ?? {};
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return failure('VALIDATION_FAILED', 'arguments must be an object.');

  const scopes = scopesFor(claims.client_id, env);
  if (!scopes.includes(tool.scope)) return failure('INSUFFICIENT_SCOPE', `This connection is not allowed to use ${tool.name}.`, { required_scope: tool.scope });

  try {
    const db = makeDb(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, token, fetchImpl);
    // Asked fresh on every call: membership, role, revocation and two-step state as of now.
    const who = await db.rpc<Whoami>('mcp_whoami', {});
    if (!who.is_member) return failure('FORBIDDEN', 'This account has no access to Chronicle.');
    if (tool.dmOnly && !who.is_dm) {
      return who.role === 'dm' ? failure('MFA_REQUIRED', 'Complete two-step sign-in, then reconnect.') : failure('FORBIDDEN', 'Only the DM can use this tool.');
    }
    const ctx: Ctx = { db, who, scopes, reviewBase: env.CHRONICLE_URL.replace(/\/+$/, '') };
    const data = await tool.run(args as Record<string, unknown>, ctx);
    const meta = tool.name.startsWith('chronicle_preview') || ['chronicle_apply_changes', 'chronicle_create_character_draft', 'chronicle_add_dm_note', 'chronicle_restore_revision'].includes(tool.name)
      ? { change_set_id: (data.change_set_id as string | undefined) ?? null, warnings: (data.warnings as unknown[] | undefined) ?? [], review_required: tool.name !== 'chronicle_apply_changes' }
      : {};
    return reply({ schema_version: '1', request_id: requestId, ...meta, data }, false);
  } catch (error) {
    const e = toolErrorCode(error);
    // Log the code only: never tokens, arguments or lore.
    if (!(error instanceof ToolError)) console.error(`mcp: ${tool.name} failed (${requestId})`);
    return failure(e.code, e.message, e.detail);
  }
}
