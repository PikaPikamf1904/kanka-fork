// LOCAL DEVELOPMENT ONLY: mint a long-lived HS256 role token (anon or service_role) from the
// local stack's random secret. Hosted Supabase uses publishable/secret API keys instead.
import crypto from 'node:crypto';

const [secret, role] = process.argv.slice(2);
if (!secret || !['anon', 'service_role'].includes(role)) {
  console.error('usage: mint-local-jwt.mjs <secret> anon|service_role');
  process.exit(2);
}
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = b64({ alg: 'HS256', typ: 'JWT' });
const payload = b64({ role, iss: 'chronicle-local', iat: now, exp: now + 365 * 86400 });
const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
console.log(`${header}.${payload}.${signature}`);
