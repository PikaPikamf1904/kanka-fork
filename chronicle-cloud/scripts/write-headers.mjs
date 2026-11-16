// Write dist/_headers for Cloudflare Pages with a Content Security Policy that names the
// Supabase project at build time. Run after `vite build` (see package.json "build").
import fs from 'node:fs';

const supabase = process.env.VITE_SUPABASE_URL;
if (!supabase) throw new Error('VITE_SUPABASE_URL is required to write security headers.');
const origin = new URL(supabase).origin;
const csp = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${origin}`,
  "font-src 'self'",
  `connect-src 'self' ${origin}`,
  'frame-src https://challenges.cloudflare.com',
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ');

const headers = `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Cross-Origin-Opener-Policy: same-origin
  X-Robots-Tag: noindex, nofollow

/index.html
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/api/*
  Cache-Control: no-store
`;
fs.writeFileSync('dist/_headers', headers);
console.log('Wrote dist/_headers');
