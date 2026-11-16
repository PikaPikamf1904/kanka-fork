import { readStatus, writeStatus, type StatusEnv } from '../_lib/status.ts';

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

export const onRequest: PagesFunction<StatusEnv> = async ({ request, env }) => {
  if (request.method === 'GET') return new Response(JSON.stringify(await readStatus(env)), { headers });
  if (request.method === 'POST') {
    let body: unknown;
    try {
      const text = await request.text();
      body = text.length <= 1024 ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const r = await writeStatus(env, request.headers.get('authorization'), body);
    return new Response(JSON.stringify(r.body), { status: r.status, headers });
  }
  return new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405, headers: { ...headers, allow: 'GET, POST' } });
};
