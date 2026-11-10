# Chronicle content import: human-first lore and secure MCP

## What works in this branch
A DM-only screen at `/dm/import` accepts Chronicle JSON packages of `{ "articles": [...] }`, previews titles and existing slugs, and creates private draft articles using the signed-in DM session with Supabase RLS. It never updates existing slugs and ignores any supplied publication/visibility flags. Artwork can then be uploaded individually via the existing editor. The process is not transactional across pages: if a save fails, stop, inspect the named article, and retry; previously created slugs are skipped.

## Editorial rules
Write natural in-world narrative without inventing facts. Distinguish transcript-derived claims, confirmed play, and planned/unplayed homebrew. Include a private editor's ledger identifying uncertainty. Never copy extensive published adventure text. Player visibility requires explicit manual DM action.

## Future custom MCP (NOT deployed or connected)
For direct ChatGPT/Claude editing, build a separate Cloudflare Worker MCP server with OAuth 2.1 and an authorization-code/PKCE flow. Require explicit DM consent for each connected client. Do not use an unauthenticated MCP endpoint or hardcoded bearer tokens. The OAuth resource server must validate user and scope on every request; confirm their authenticated Supabase user has an active `campaign_members.role='dm'` and completed MFA if enrolled. Prefer delegated, user-scoped DB access with RLS. Never expose a Supabase secret/service-role key to browsers, MCP clients, repositories, or logs.

Suggested tools with narrow permissions:
- `list_articles`: read metadata for DM-accessible pages
- `get_article`: read an article and its sections
- `preview_lore_import`: validate a JSON pack without writing
- `create_dm_drafts`: new private drafts only, no duplicates
- `update_dm_draft`: edit only existing unpublished DM-only articles, with revision ID / optimistic concurrency
- `suggest_links`: propose relationships for DM review
- `publish_lore`: **not exposed** in initial MCP release; publish via human-reviewed DM UI

Do not grant tools arbitrary SQL, role changes, access-code administration, media URL disclosure, or deletion. Validate 1–200 articles, schema, sizes, and links. Use rate limits and audit trails. Test with anonymous, player, DM without required MFA, revoked DM, malicious file, repeated imports, and version conflicts. Never deploy an insecure scaffold.

## Connection availability
The ChatGPT account must support custom MCP server connections with write capabilities. The existing Supabase plugin currently returns a permissions error for this project; signing into Supabase in a browser is not the same as authorizing the plugin. Reconnect/authorize the project-scoped Supabase plugin or deploy the dedicated OAuth-protected Worker, then connect it in ChatGPT Plugins on the web.

This branch is independent of Cloudflare's production deployment branch. Do not merge or deploy until the UI is tested with a local disposable database and DM session.
