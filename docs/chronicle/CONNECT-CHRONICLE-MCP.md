# Connecting an assistant to Chronicle (MCP)

**Status (2026-11-11): deployed, not yet connected.**
- The Worker is live at the endpoint below.
- Hosted migrations `…0900` and `…1000` are applied.
- Supabase's OAuth server is on, with authorization path `/dm/connect` and Site URL `https://chronicle-wiki-preview.pages.dev`.
- The website is deployed to production from `claude/chronicle-chatgpt-mcp` (`e24cac649`).

A ChatGPT or Codex connection counts as verified only once a real tool call has succeeded.

Rollback, if needed:
- **Website:** roll production back to Pages deployment `46b201b0` (`f94f85066`).
- **Database:** run the statements in each migration's header.
- **OAuth:** turn the OAuth server off in Supabase.

Endpoint: `https://chronicle-mcp.life-line-gaming-solutions.workers.dev/mcp`

There are three separate pieces:

1. **The Chronicle website** (Cloudflare Pages). It hosts the sign-in consent page `/dm/connect`
   and the approval page `/dm/review/<id>`.
2. **The MCP server** (`chronicle-cloud/mcp/`, Cloudflare Worker `chronicle-mcp`). It exposes the
   tools. Only this gives ChatGPT access to Chronicle.
3. **The Chronicle skill** (`plugins/chronicle/`). It teaches ChatGPT and Codex how to use the tools
   (preview before write, provenance, no invented facts). It grants no access by itself.

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

Read (any member, limited to what they may see):
- `chronicle_campaign_overview` — where the party is, the current situation, the party, the
  latest sessions, open quests (start here);
- `chronicle_topic` — everything about one subject: page, facts, connections, pages linking to
  it, timeline, other mentions;
- `chronicle_list_quests` — open, finished or unknown, from each quest's recorded Status;
- `chronicle_search`, `chronicle_get_article` (by slug or stable id), `chronicle_list_characters`,
  `chronicle_get_character`, `chronicle_list_sessions`, `chronicle_get_timeline`, `chronicle_whoami`.

Read (DM): `chronicle_session_prep` (recorded material for the next session; no predictions),
`chronicle_wiki_health` (duplicates, broken links, orphans, contradictions; suggestions only),
`chronicle_list_drafts`, `chronicle_get_provenance`, `chronicle_find_duplicates`,
`chronicle_get_revisions`, `chronicle_audit_links`, `chronicle_suggest_connections`,
`chronicle_list_import_batches`, `chronicle_get_import_batch`.

Propose (DM, saves no content): `chronicle_preview_changes`, `chronicle_preview_import`,
`chronicle_create_character_draft`, `chronicle_draft_session_journal`, `chronicle_add_dm_note`,
`chronicle_restore_revision`, and `chronicle_draft_gazette_story` (returns a draft the DM pastes
into the news desk under **Start from an assistant draft**; it never saves or prints).

Stage (DM, writes nothing to the wiki): `chronicle_stage_import` — the DM reviews and saves the
batch at `/dm/import/<id>`. See [LORE-IMPORT.md](LORE-IMPORT.md).

Save (DM, after approval in Chronicle): `chronicle_apply_changes`.

All tools except `chronicle_apply_changes` and `chronicle_stage_import` carry `readOnlyHint`, so
ChatGPT asks for confirmation only before those. There is no publish, print, delete, member,
access-code, SQL or URL-fetch tool.

### Things to ask

| You ask | The assistant uses |
|---|---|
| "Where is the party?" / "What happened last session?" | `chronicle_campaign_overview`, then `chronicle_get_article` on the session |
| "Who is Swift Claw?" | `chronicle_get_character` |
| "Find everything about Kalaman." | `chronicle_topic` |
| "What quests are unfinished?" | `chronicle_list_quests` |
| "Show me this faction." | `chronicle_topic` or `chronicle_get_article` |
| "Find contradictions in my campaign notes." | `chronicle_wiki_health` |
| "Help me prepare next session." | `chronicle_session_prep` |
| "Prepare an update to this character's page." | `chronicle_get_article`, then `chronicle_preview_changes` (you approve at the review link) |
| "Draft a Goblin Gazette article about …" | `chronicle_draft_gazette_story` (you paste it into the news desk) |
| "Review these session notes and propose wiki updates." | `chronicle_draft_session_journal`, `chronicle_find_duplicates`, `chronicle_preview_changes` |
| "Import these notes." | `chronicle_stage_import` (you review and save at the batch link) |

## How a change gets saved

1. The assistant calls a propose tool and receives a diff, a `preview_id`, a `digest` and a
   `review_url`.
2. The DM opens the review link in Chronicle (`/dm/review/<id>`), reads the before/after table and
   clicks **Approve these changes**. There is no time limit; leaving it unapproved refuses it. If a page
   changes before approval is used, saving is refused with a conflict.
3. The assistant calls `chronicle_apply_changes`. Without step 2 it is refused, whatever it claims.
   Everything is saved in one transaction as DM-only drafts, or not at all.

## Scopes

Supabase's OAuth server issues standard scopes, not Chronicle-specific ones, so scopes are assigned
per client by the Worker setting `MCP_CLIENT_SCOPES`, for example
`{"<client id>": ["chronicle:read"]}` for a read-only connection. Without the setting a client
receives all four (`chronicle:read`, `chronicle:preview`, `chronicle:draft_write`,
`chronicle:revision_restore`); the database still requires the DM for everything but reading.

## To go live

Owner steps, in order:

1. Apply the pending migration bundle to the hosted project, after the backup and restore
   rehearsal it requires: see [RELEASE-BUNDLE-2026-11-13.md](RELEASE-BUNDLE-2026-11-13.md).
2. Deploy the website from the reviewed branch (it contains the consent, review and import pages).
3. Supabase dashboard → Authentication → URL Configuration: set **Site URL** to
   `https://chronicle-wiki-preview.pages.dev` (it was `http://localhost:3000`, and the consent
   path is relative to it).
4. Supabase dashboard → Authentication → OAuth Server: **enable**, set the authorization path to
   `/dm/connect`. Leave dynamic client registration **off** unless you choose DCR in step 6.
5. Deploy the Worker from `chronicle-cloud/mcp/` with `npx wrangler deploy`. It needs no secrets;
   its three settings are public and committed in `mcp/wrangler.jsonc`.

### ChatGPT (web)

6. In ChatGPT: **Plugins → + → Add custom MCP server**. Name `Chronicle`, Server URL
   `https://chronicle-mcp.life-line-gaming-solutions.workers.dev/mcp`, authentication **OAuth**.
   - Recommended: create an OAuth client in Supabase (Authentication → OAuth Apps → Add), type
     *confidential*, **token endpoint authentication method `client_secret_post`**, with the
     redirect URI ChatGPT shows in the form, and paste its client id and secret into ChatGPT.
     ChatGPT sends the client secret in the token request body. Supabase's default for confidential
     clients, `client_secret_basic`, expects it in an HTTP header instead and refuses every code
     exchange with `invalid authentication method` (ChatGPT shows "Request is not valid").
   - Alternative: turn on dynamic client registration in Supabase (step 4) and choose DCR in
     ChatGPT. Anyone could then register a client, though each still needs a Chronicle sign-in
     and your consent.
7. Accept the risk notice, **Create as a plugin**, install it, and connect: ChatGPT opens
   Supabase, which sends you to Chronicle's `/dm/connect` page; sign in as the DM and click Allow.
8. In a new chat, type `@Chronicle` and ask, for example: "Use Chronicle's chronicle_whoami tool",
   then "Get Swift Claw's character profile from Chronicle".

### Codex

```
codex mcp add chronicle --url https://chronicle-mcp.life-line-gaming-solutions.workers.dev/mcp --oauth-client-id <client id>
codex mcp login chronicle
```

Register the callback `codex mcp add` prints (for example `http://127.0.0.1/callback`) as a
redirect URI of a *public* OAuth client in Supabase. The skill is offered through the repository
marketplace `.agents/plugins/marketplace.json` (plugin `chronicle`), or copy
`plugins/chronicle/skills/chronicle` to `~/.agents/skills/chronicle`.

### Test before trusting it

Sign in, `chronicle_whoami`, a search, then one proposal approved in Chronicle and applied.

To disconnect: revoke the client's grant in the Supabase dashboard (takes effect when its current
token expires, about an hour), or revoke at once by removing the Worker or its route.

## Troubleshooting

- **ChatGPT says "Request is not valid" after you click Allow, and no tools appear.** Look in
  Supabase → Logs → Auth for `POST /oauth/token` with status 400. If the message says
  `client is registered for 'client_secret_basic' but 'client_secret_post' was used`, edit the
  OAuth client and set its token endpoint authentication method to `client_secret_post`. The secret
  does not change. Then reconnect from ChatGPT.
- **The plugin shows as not installed.** In ChatGPT, open Plugins, find Chronicle under your
  personal plugins, select Install, then Connect.

## Testing it locally (verified)

`bash scripts/local-stack.sh up && bash scripts/local-stack.sh seed`, then
`bash scripts/e2e-local.sh tests/e2e/mcp-oauth.spec.ts`. The local stack runs Supabase Auth
2.182.1 with its OAuth 2.1 server, and the script runs the Worker in Cloudflare's local runtime
at `http://127.0.0.1:8789/mcp`. The test does what ChatGPT does: discovery from the Worker's 401
and protected-resource metadata, RFC 8414 server metadata, dynamic client registration, PKCE
authorisation with the DM's consent on `/dm/connect`, code exchange, MCP calls over HTTP, token
refresh, and a proposal saved only after approval on the website. It also checks that the same
token cannot write to the Data API directly, and that refusing the consent gives no code.

To try a real client locally (for example MCP Inspector): start the stack and the e2e servers as
above, point the client at `http://127.0.0.1:8789/mcp`, and sign in as the local DM from
`.local/dev-credentials` when the consent page opens.

## Not verified

- A connection from ChatGPT, Codex or MCP Inspector to the hosted Worker: it needs the owner's
  sign-in and the steps above. The same flow is verified locally with Supabase Auth 2.182.1
  (`tests/e2e/mcp-oauth.spec.ts`); the hosted Auth version may differ.
- Token audience: Supabase issues `aud: authenticated` and does not copy ChatGPT's `resource`
  parameter into the token. The Worker therefore checks issuer, signature, expiry, subject and
  OAuth client id instead of a Worker-specific audience.
- A DM with two-step sign-in connecting through OAuth: whether those tokens carry `aal2` was not
  tested. If they do not, DM tools are refused (fails closed) until this is resolved.
- Rate limiting: none in the Worker; use a Cloudflare rate-limiting rule on `/mcp`.
