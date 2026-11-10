# Chronicle MCP V2: implementation status

Status labels: `local_verified` (tested on the local disposable stack), `untested`, `not_started`.
Nothing here is deployed, applied to the hosted database, or connected to any MCP client.

## Branches and pull requests (audited 2026-11-11)

| PR | Branch | Head | Contents | Relation to this work |
|---|---|---|---|---|
| #16 | `feature/chronicle-cloudflare-supabase` | `f94f85066` | Production app (deployed) | Base of everything |
| #17 | `fable/chronicle-overnight-lore` | `758e586e9` | Command-line lore loader, Kanka importer hardening, DM review queue | Included via #19 |
| #18 | `feature/chronicle-lore-import-review` | `cf9d26ad9` | First `/dm/import` screen, MCP note | Included via #19 |
| #19 | `fable/chronicle-human-first-overnight` | `1b5b065f3` | Safe import screen, lore pack v2, home states | **Base of this branch** |
| #20 | `codex/chronicle-character-wiki-20261110` | `8055fd385` | Character directory, profile layout, CI workflow (4 files) | Character phase; merges cleanly with this branch (checked with `git merge-tree`) |
| — | `claude/chronicle-editing-engine` | this branch | Editing engine (this phase) | — |

Conflict map: PR #20 touches `ArticlePage.tsx`, `BrowsePages.tsx`, `theme.css` and adds a CI
workflow. This branch touches none of those, so the two merge without conflict. PR #20 will be the
starting point of the character phase.

## Phase B: editing engine (local_verified)

Migration `chronicle-cloud/supabase/migrations/20261111000900_change_sets.sql` (**not applied to the
hosted project**). One path for structured edits, for the website now and the MCP server later:

- `preview_change_set(change_set)`: validates against the database, per-field diff, warnings
  (missing source, broken links, ignored visibility requests), conflicts. Stores a private preview
  for 20 minutes and returns `preview_id` and a server-computed `digest`. Writes no content.
- `approve_change_preview(preview_id)`: a human approval, refused for any request whose token
  carries an OAuth client id. An OAuth client cannot approve its own preview.
- `apply_change_set(preview_id, digest, idempotency_key)`: checks owner, client, expiry, digest,
  approval; locks and compares each article's version; snapshots it; applies everything; records the
  result. One transaction: any failure undoes all of it.
- `articles.version` bumps on any change to an article, its sections, fields, categories or relations.
- Operations: create_article, patch_article, upsert/remove_section, upsert/remove_infobox_field,
  add/remove_relation, add/remove_category_link, add_dm_note, restore_revision.
- New rows are always DM-only drafts; existing rows can only be narrowed; patch cannot change type,
  visibility, status, slug or source_ref; an OAuth client cannot edit text players can already read.
- Provenance (`table_confirmed`, `dm_confirmed`, `official_reference`, `planned_unplayed`,
  `transcript_uncertain`) per section and field, in a DM-only table.
- Guarded restore: always a draft, never widens a section or field that is DM-only now.
- Limits: 1 MB per change set, 100 articles, 30 sections and 50 fields and 100 KB of text per article.

Client: `src/lib/changeSets.ts` (calls and error mapping), `src/lib/changeSetTypes.ts` (shared types).
The lore import screen now uses the engine: the whole package in one transaction, retry-safe.

Remaining legacy risk: the article **editor** still saves through the old multi-request
`saveArticle()` path. Moving it to the engine is part of the character/editor phase.

### Rollback

The migration header lists the statements that remove everything it adds. Content is untouched.

## Not started

- Phase C: remote MCP Worker and OAuth. Design decision recorded: MCP clients should receive tokens
  issued by Supabase Auth's own OAuth 2.1 server, so identity, RLS and the DM/MFA check apply
  natively, and the engine recognises them by the token's `client_id` claim. **Must be verified
  against current Supabase and Cloudflare documentation before any code is written.**
- Website review page for approving an MCP preview (needed before MCP writes are useful).
- Phase D (characters), Phase E (transcript candidates), Phase F (adversarial pass, connection docs).
