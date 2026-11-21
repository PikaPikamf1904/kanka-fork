import { readStatus, type StatusEnv } from '../_lib/status.ts';

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

export const onRequest: PagesFunction<StatusEnv> = ({ request, env }) => {
  if (request.method === 'GET') return new Response(JSON.stringify(readStatus(env)), { headers });
  return new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405, headers: { ...headers, allow: 'GET' } });
};
