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

## Phase B addition: atomic editor save (local_verified)

Migration `…1000_atomic_save_and_mcp.sql`: `save_article` performs the editor's whole save in one
transaction with a version check. The editor uses it, so the old multi-request save path and its
partial-write risk are gone. A second tab with a stale copy gets a conflict message and nothing is
written.

## Phase C: MCP server (local_verified, not deployed, no real client yet)

`chronicle-cloud/mcp/` (see `CONNECT-CHRONICLE-MCP.md`). 14 tools. Tokens from the project's
Supabase Auth OAuth server; caller's own token for all database calls; fresh identity check per
call. Website pages: `/dm/review/:id` (approve a proposal) and `/dm/connect` (OAuth consent).

## Phase D: character encyclopedia (local_verified)

PR #20 merged in. Added: portrait cards with race and class, party badge, letter headings only for
long lists, fuller character template, no empty infobox rows or empty section headings, dates
written out. Screenshots from the running app with synthetic characters:
`docs/chronicle/screenshots-characters/`.

## Acceptance matrix coverage

| Section | Covered by | Not covered |
|---|---|---|
| 1 Protocol | `tests/db/mcp.test.ts` (401 challenge, metadata, tool list, calls) | Real OAuth flow, real clients |
| 2 AUTH-01..10, 12, 13, 15, 16, 17 | `mcp.test.ts`, `mcp/src/auth.test.ts`, `characters.spec.ts` | AUTH-11 (grant revocation: needs hosted OAuth), AUTH-14 (covered for storage by `media-sync.test.ts`, not through MCP), AUTH-18 |
| 3 DATA-01..19 | `change-sets.test.ts`, `save-article.test.ts`, `mcp.test.ts` | DATA-20 (transcript import: not built) |
| 4 Browser | `characters.spec.ts`, `import.spec.ts`, existing suite | Image crop/credit workflow, screen-reader audit |
| 5 Import | `import.spec.ts`, `lorePackage.test.ts` | Transcript candidate extraction (not built) |
| 6 Rollout | Docs only | Everything live |

## Not started

- Transcript-to-suggestions workflow (Phase E). Needs a speech-to-text or document pipeline that
  does not exist here.
- Artwork credit and focal-point fields; gallery.
- Live verification of anything.
