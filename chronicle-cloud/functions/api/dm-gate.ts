import { readJsonBody } from '../_lib/enroll.ts';
import { dmGateDeps, handleDmGate, type DmGateEnv } from '../_lib/dmGate.ts';

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export const onRequest: PagesFunction<DmGateEnv> = async ({ request, env }) => {
  for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'IP_HASH_SECRET'] as const) {
    if (!env[key]) {
      console.error(`dm-gate: ${key} is not configured`);
      return new Response(JSON.stringify({ error: 'The DM screen is not configured.' }), { status: 503, headers });
    }
  }
  const readable =
    request.method === 'POST' &&
    request.headers.get('origin') === new URL(request.url).origin &&
    (request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json');
  const body = readable ? await readJsonBody(request) : null;
  try {
    const result = await handleDmGate(
      {
        method: request.method,
        url: request.url,
        origin: request.headers.get('origin'),
        contentType: request.headers.get('content-type'),
        ip: request.headers.get('cf-connecting-ip'),
        cookie: request.headers.get('cookie'),
        body,
      },
      env,
      dmGateDeps(env),
    );
    const out = new Response(JSON.stringify(result.body), { status: result.status, headers });
    if (result.setCookie) out.headers.append('set-cookie', result.setCookie);
    return out;
  } catch (error) {
    // The passcode is never logged; only the cause.
    console.error('dm-gate failed', error instanceof Error ? error.message : 'unknown error');
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.' }), { status: 500, headers });
  }
};
