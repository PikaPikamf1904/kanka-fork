# Decision log: Chronicle cloud

| # | Decision | Why | Alternatives |
|---|---|---|---|
| 1 | Build a new app in `chronicle-cloud/`; keep Kanka untouched | Pages cannot run Laravel/PHP; Kanka stays the migration source and rollback | Port Laravel to Workers (not possible); keep VPS hosting (Oracle capacity failed) |
| 2 | Base on `audit/chronicle-integration` (`cbcc485fe`) | Most complete verified history, includes all earlier work | `chronicle/main` (32 commits behind) |
| 3 | React + TypeScript + Vite, react-router, supabase-js | Requested; small, static, fits Pages | Next.js (needs more Functions) |
| 4 | All privacy rules in PostgreSQL RLS; player/DM material in separate rows | Release-blocking privacy; a hidden component is not security | JSON fields filtered in the browser (rejected) |
| 5 | New content defaults to DM-only drafts | Unknown or unfinished means private | Public by default (rejected) |
| 6 | Player access = shared code → one Auth user per device, created by a Pages Function | Simple for players, server-verified, individually revocable, no shared account | One shared account (rejected); Supabase anonymous sign-in (blocked by "sign-ups off" and abusable) |
| 7 | Sign-ups and anonymous sign-in disabled | Only enrollment and the DM create accounts | — |
| 8 | Session stored by supabase-js (localStorage), strict CSP, no raw HTML | Static app on free Functions quota | HttpOnly-cookie proxy for every call (costs Function requests, more code) |
| 9 | TOTP for the DM, enforced in the database (aal2) | Free; protects against a stolen password | SMS MFA (paid) |
| 10 | Supabase publishable/secret keys, secret only in the Function, sent as `apikey` | Legacy JWT keys are being retired by late 2026 | Legacy anon/service_role keys |
| 11 | PostgreSQL full-text search | Free, respects RLS | Meilisearch/Algolia (extra service, privacy risk) |
| 12 | Images resized to WebP in the browser; bucket refuses SVG | No image transformations on Free; SVG can carry script | Store originals (quota) |
| 13 | Keep 30 revisions per article | 500 MB database | Unlimited history |
| 14 | Import from Kanka's export, DM-only unless trusted | Export lacks role permissions; never touch the source DB | Direct DB reads (riskier) |
| 15 | No keep-alive for the pause; document restore | Provider rules; honesty | Cron pings (rejected by brief) |
| 16 | Markdown with `[[links]]` instead of a rich editor | Small, safe, testable | Tiptap port (large) |
| 17 | Two roles only (player, DM) | Matches the table; simpler RLS | Kanka's role matrix |
| 18 | Local stack built from Supabase's official images and init scripts | Real RLS/Auth/Storage tests without an account | Mocks (would not prove privacy) |
| 19 | Pin Vitest 4.0.18 (4.1.x crashed npm's resolver), ESLint 10, TypeScript 5.9 | Working, maintained versions | Latest of each |
