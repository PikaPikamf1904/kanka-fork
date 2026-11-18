import { readJsonBody } from '../_lib/enroll.ts';
import { handleJoin, joinDeps, type JoinEnv } from '../_lib/join.ts';

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export const onRequest: PagesFunction<JoinEnv> = async ({ request, env }) => {
  for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'IP_HASH_SECRET'] as const) {
    if (!env[key]) {
      console.error(`join: ${key} is not configured`);
      return new Response(JSON.stringify({ error: 'Invitations are not configured.' }), { status: 503, headers });
    }
  }
  const readable =
    request.method === 'POST' &&
    request.headers.get('origin') === new URL(request.url).origin &&
    (request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json');
  const body = readable ? await readJsonBody(request) : null;
  try {
    const result = await handleJoin(
      {
        method: request.method,
        url: request.url,
        origin: request.headers.get('origin'),
        contentType: request.headers.get('content-type'),
        ip: request.headers.get('cf-connecting-ip'),
        userAgent: request.headers.get('user-agent'),
        body,
      },
      env,
      joinDeps(env),
    );
    return new Response(JSON.stringify(result.body), { status: result.status, headers });
  } catch (error) {
    // Never log the token or the body; the cause only.
    console.error('join failed', error instanceof Error ? error.message : 'unknown error');
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.' }), { status: 500, headers });
  }
};
