# Connecting an assistant to Chronicle (MCP)

**Status: `local_verified`.** The server passes its tests against the local stack with locally
signed tokens. It has **not** been deployed, and no real MCP client (Claude, ChatGPT, MCP
Inspector) has connected to it yet. Nothing below has been done on the hosted project.

## What it is

`chronicle-cloud/mcp/` is a small Cloudflare Worker that speaks the Model Context Protocol over
HTTP (`POST /mcp`). It holds **no database secret**. Every request must carry a token issued by
this project's own Supabase Auth OAuth 2.1 server, and the Worker uses that same token for every
database call, so the wiki's existing privacy rules decide what the assistant can read or change.

| Path | Purpose |
|---|---|
| `POST /mcp` | MCP: `initialize`, `tools/list`, `tools/call`, `ping` |
| `GET /.well-known/oauth-protected-resource` | Tells a client to sign in at the project's Supabase Auth |
| `GET /health` | Name and version only |

## Sign-in and identity

1. The client is refused with `401` and a pointer to the metadata above.
2. It discovers Supabase Auth, registers (or uses a pre-registered client) and sends the DM to
   Supabase's authorization address, which redirects to Chronicle's consent page (`/dm/connect`).
3. The DM, signed in to Chronicle, clicks Allow. Supabase issues the client a token for **that
   same Supabase user**, carrying the client's id.
4. On every call the Worker verifies the token (signature against the project's published keys,
   expiry, issuer, audience, subject, client id) and then asks the database who the caller is
   *now*. A DM who was revoked, or who has two-step sign-in enabled but did not complete it for
   this token, is refused on the next call even if the token has not expired.

Website session tokens are refused (they have no client id), so a stolen browser session cannot be
replayed through the MCP endpoint to approve its own changes.

## Tools

Read (any member, limited to what they may see): `chronicle_whoami`, `chronicle_search`,
`chronicle_get_article`, `chronicle_list_characters`, `chronicle_get_character`.
Read (DM): `chronicle_get_revisions`, `chronicle_audit_links`, `chronicle_suggest_connections`.
Propose (DM, saves nothing): `chronicle_preview_changes`, `chronicle_preview_import`,
`chronicle_create_character_draft`, `chronicle_add_dm_note`, `chronicle_restore_revision`.
Save (DM): `chronicle_apply_changes`.

There is no publish, delete, member, access-code, SQL or URL-fetch tool.

## How a change gets saved

1. The assistant calls a propose tool and receives a diff, a `preview_id`, a `digest` and a
   `review_url`.
2. The DM opens the review link in Chronicle (`/dm/review/<id>`), reads the before/after table and
   clicks **Approve these changes**. Closing the page refuses; the proposal expires in 20 minutes.
3. The assistant calls `chronicle_apply_changes`. Without step 2 it is refused, whatever it claims.
   Everything is saved in one transaction as DM-only drafts, or not at all.

## Scopes

Supabase's OAuth server issues standard scopes, not Chronicle-specific ones, so scopes are assigned
per client by the Worker setting `MCP_CLIENT_SCOPES`, for example
`{"<client id>": ["chronicle:read"]}` for a read-only connection. Without the setting a client
receives all four (`chronicle:read`, `chronicle:preview`, `chronicle:draft_write`,
`chronicle:revision_restore`); the database still requires the DM for everything but reading.

## To go live (each step needs the DM's approval; none has been done)

1. Apply migrations `…0900_change_sets` and `…1000_atomic_save_and_mcp` to the hosted project.
2. Deploy this branch of the website (it contains the consent and review pages).
3. In the Supabase dashboard: Authentication → OAuth Server → enable; set the authorization path to
   `/dm/connect`; decide whether to allow dynamic client registration.
4. Copy `mcp/wrangler.example.jsonc` to `wrangler.jsonc`, fill in the three public values, and
   deploy the Worker (`npx wrangler deploy` from `chronicle-cloud/mcp/`). It needs no secrets.
5. Connect a client to `https://<worker>/mcp`. Claude Code: `claude mcp add --transport http
   chronicle https://<worker>/mcp`. ChatGPT custom connectors depend on the account's plan and
   workspace settings; check that at connection time.
6. Test with a real client before trusting it: sign-in, `chronicle_whoami`, a search, one proposal
   approved and applied.

To disconnect: revoke the client's grant in the Supabase dashboard (takes effect when its current
token expires, about an hour), or revoke at once by removing the Worker or its route.

## Not verified

- A real OAuth round trip (the local Auth service predates the OAuth server feature).
- Interoperability with MCP Inspector, Claude or ChatGPT.
- Whether Supabase OAuth tokens carry the `aal` claim the two-step check reads; if they do not, a
  DM with two-step enabled will be refused DM tools (fails closed) until this is resolved.
- Rate limiting: none in the Worker; use a Cloudflare rate-limiting rule on `/mcp`.
