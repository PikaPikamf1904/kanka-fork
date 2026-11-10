// LOCAL DEVELOPMENT ONLY: a tiny stand-in for Supabase's API gateway, so supabase-js can use one
// base URL. Routes /auth/v1 -> GoTrue, /rest/v1 -> PostgREST, /storage/v1 -> storage-api.
// Like the hosted gateway, a request without a user session is sent with the publishable (anon) key.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.local/env'), 'utf8')
    .split('\n').filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);

const routes = [
  ['/auth/v1', 54331],
  ['/rest/v1', 54330],
  ['/storage/v1', 54332],
];

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-upsert, prefer, range, accept-profile, content-profile, cache-control',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'access-control-expose-headers': 'content-range, content-length, content-type',
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    // Like the hosted gateway, accept whatever headers supabase-js asks to send.
    const requested = req.headers['access-control-request-headers'];
    res.writeHead(204, requested ? { ...cors, 'access-control-allow-headers': requested } : cors);
    res.end();
    return;
  }
  const route = routes.find(([prefix]) => req.url.startsWith(prefix + '/') || req.url === prefix);
  if (!route) {
    res.writeHead(404, cors);
    res.end('not found');
    return;
  }
  const headers = { ...req.headers, host: `127.0.0.1:${route[1]}` };
  // The publishable key stands in for the anon role when there is no user token.
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  if (!headers.authorization) headers.authorization = `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`;
  const upstream = http.request(
    { host: '127.0.0.1', port: route[1], method: req.method, path: req.url.slice(route[0].length) || '/', headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, { ...up.headers, ...cors });
      up.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    res.writeHead(502, cors);
    res.end(String(error));
  });
  req.pipe(upstream);
}).listen(54321, '127.0.0.1');
