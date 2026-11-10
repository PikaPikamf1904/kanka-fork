import { handleEnroll, readJsonBody, supabaseDeps, type EnrollEnv } from '../_lib/enroll.ts';

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export const onRequest: PagesFunction<EnrollEnv> = async ({ request, env }) => {
  for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'IP_HASH_SECRET'] as const) {
    if (!env[key]) {
      console.error(`enroll: ${key} is not configured`);
      return new Response(JSON.stringify({ error: 'Enrollment is not configured.' }), { status: 503, headers });
    }
  }
  const body = request.method === 'POST' ? await readJsonBody(request) : null;
  try {
    const result = await handleEnroll(
      {
        method: request.method,
        url: request.url,
        origin: request.headers.get('origin'),
        contentType: request.headers.get('content-type'),
        ip: request.headers.get('cf-connecting-ip'),
        body,
      },
      env,
      supabaseDeps(env),
    );
    return new Response(JSON.stringify(result.body), { status: result.status, headers });
  } catch (error) {
    // Log the cause server-side only; the browser gets a generic message.
    console.error('enroll failed', error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.' }), { status: 500, headers });
  }
};
