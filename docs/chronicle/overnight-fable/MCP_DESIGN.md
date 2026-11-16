# MCP design (not built)

No MCP code exists. This page collects the decisions already made in PR #18's note and the work still
needed. **It has not been checked against the current MCP specification or ChatGPT's connector
requirements; do that before writing any code.**

## Fixed decisions

- A separate Cloudflare Worker, not part of the Pages app.
- Every request authenticated through OAuth 2.1 with authorization code and PKCE. No static tokens,
  no unauthenticated endpoint.
- The Worker acts **as the signed-in DM**, with the DM's own Supabase session, so the database's
  existing rules apply. No service-role key in the Worker's request path for content tools.
- Before every tool call: active `campaign_members` row with role `dm`, and two-step sign-in
  completed if the DM has a factor (the same rule as `private.is_dm()`).
- Write tools create and edit **DM-only drafts only**. Any `visibility` or `status` in a request is
  ignored. No publish tool, no delete tool, no SQL tool, no member or access-code tools.

## Tools (proposed)

Read: search articles, get article, list drafts, list by type, related articles.
Write: create drafts (reusing `src/lib/lorePackage.ts` validation and the pending-mark import
sequence), update a draft with a version check, add a section, link two pages (DM-only connection).

## Still needed before building

1. Current MCP authorization spec and ChatGPT custom-connector requirements (official docs).
2. How the Worker obtains and refreshes the DM's Supabase session through OAuth, and how to revoke it.
3. Rate limits and an audit table (needs a migration and tests).
4. Tests: anonymous, player, DM without two-step, revoked DM, injected visibility/status, replayed
   requests, oversized batches.
