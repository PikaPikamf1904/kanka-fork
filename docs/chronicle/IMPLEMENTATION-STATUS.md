# Chronicle implementation status

## 2026-11-16 — overnight sprint (branch `claude/chronicle-website-features`, draft PR #31)

Local, committed and pushed only. Nothing deployed, merged or applied to the hosted project; no
migration files written. Started at `3f69e5925`.

Built (unit and browser tests for each; player tests check hidden pages never arrive):
- Knowledge graph (`/graph`): global and local views, zoom, pan, pinch, drag, search, kind filters,
  preview card, accessible list view, filters kept in the address and per browser. d3-force and
  d3-quadtree (pinned); layout in a Web Worker above 600 pages. Built only from pages the reader
  received, so hidden pages and links to them never appear.
- Maintenance notice (`/api/status`): the exact agreed visitor text; turned on by an environment
  switch, a token-protected deploy flag in KV, or (opt-in) a development heartbeat. Off by default.
- Command palette (Ctrl/⌘+K or "/"): pages and parts of the site; DM entries hidden from players.
- Search operators: `type:`, `category:`, `"exact phrase"`, `-exclude`.
- Reading comfort: larger text, or larger text with a plain font, remembered per browser.
- Leak checks extended: summaries, subtitles, DM-only pictures placed in visible text, categories
  players can see that only hold hidden pages.
- "Recently updated" kind filter; Unknown and Inactive status ribbons.
- Faction organisation charts from "Member of" connections.

Waiting for owner approval (migration design only, in
[PROPOSAL-MIGRATIONS.md](PROPOSAL-MIGRATIONS.md)): bookmarks, reading lists, personal notes,
Investigation Board, Mystery Studio, Feedback Center, player invitations, Knowledge Studio.

Verified at `6fa3282db` (local, PostgreSQL 17): lint 0, typecheck 0 (site and MCP worker), unit
199/199, database 311/311, browser 91/91, production build OK. `235681f32` adds documentation only.

## 2026-11-16 — second website sprint (branch `claude/chronicle-website-features`, draft PR #31)

Local, committed and pushed only. Nothing deployed, no production change, no migrations. Stacked
on PR #30 (`8c58704a2`).

Built (each with unit and browser tests; every player-facing test checks that hidden pages,
fields and connections never reach a player):
- Wave one (agents, reviewed): picture-viewer expired-link recovery, place chips, Wander, A–Z
  index at `/a-z`, stubs and to-dos in the tidy report.
- "What players can see" (`/dm/visibility`): visibility totals and leak detection (links to and
  mentions of hidden pages, empty published pages, player drafts).
- Family trees from new "Parent of / Spouse of / Sibling of" connections (free-text kinds, no
  migration); "Child of" shown from the child's side.
- Status ribbons from the existing Status field.
- "Recently updated" (`/recent`) from per-section timestamps, so hidden edits never show.
- Renaming an address keeps the old one working (redirect added on save).
- Infobox field browse (`/facts?label=…&value=…`).
- Header and menu: phone search, dialog-like phone menu, named theme choice, sticky desktop
  menu, 44px touch targets, fuller reduced-motion support.
- Test maintenance: documentation screenshots only with `SAVE_DOC_SHOTS=1`.

Waiting for owner approval: bookmarks, reading lists and personal notes need a migration
(design in [PROPOSAL-MIGRATIONS.md](PROPOSAL-MIGRATIONS.md)). Roadmap:
[ROADMAP-50.md](ROADMAP-50.md). Guides: [WEBSITE-FEATURES.md](WEBSITE-FEATURES.md).

Verified at `bfbd88849` (local, PostgreSQL 17.12): lint 0, typecheck 0 (site and MCP worker), unit
187/187, browser 82/82, production build OK; database 311/311 on the run just before (no database
change since). The first full run of this sprint found three browser failures caused by the new
theme picker and menu focus; fixed in `bfbd88849`. CI `check` and `db` were green on `8cd5ce924`.

## 2026-11-16 — website features (branch `claude/chronicle-website-features`, draft PR #31)

Stacked on PR #30 (`8c58704a2`). Local, committed and pushed only; nothing deployed; no
migrations.

- **Picture viewer** (commit `038d4f18d`): click or Enter on a wiki picture opens a full-screen
  viewer over the pictures the reader can see on that page.
- **DM wiki tidy-up report** (commit `8dc55c9bf`): read-only report at `/dm/tidy` with broken
  links, unlinked pages, missing summaries and pictures, and empty pages.
- User guides: see [WEBSITE-FEATURES.md](WEBSITE-FEATURES.md).

Full verification at `44a4eca44`, local PostgreSQL 17.12: lint 0, typecheck 0, unit 138/138,
database 311/311, browser 65/65. The first full run found two problems, both fixed: the package
importer could re-select pages it had just created when the next file was chosen right after an
import (`44f5d1374`), and the picture-viewer browser test shared an article with the image test
(`44a4eca44`).

## 2026-11-15 — release prep (branch `claude/chronicle-release-prep`, draft PR #30)

Resume here. Local, committed and pushed only; **nothing applied to production**, nothing
deployed, no real lore imported. Base: `claude/chronicle-mcp-lore-import` `a88c32202` (PR #29).

- **Gazette drafts through approval** (`20261116000200_news_proposals.sql`): the MCP tool files
  a proposal; the DM accepts it on the news desk (saved as a private draft through
  `save_news_story`) or dismisses it. Assistants cannot accept, dismiss, rewrite or delete
  proposals (database trigger), and the paste box is gone.
- **Current-location privacy** (`20261116000100_location_privacy.sql`): reproduced that a player
  could select `campaign_settings.current_location_id` even when it pointed at a DM-only page.
  The column is no longer selectable; `campaign_location()` answers the DM always and a member
  only for a published player page. Deployment order matters, see the release bundle.
- **Importer:** similar-name detection against the wiki, missing categories created only when
  ticked, failing entry named, and a fix for entries the engine skipped (page created by someone
  else after review) being counted as imported.
- **Map editor:** marker and fog dialogs confirm before Cancel, switching or leaving drops edits;
  one save at a time (a double-clicked Save on a slow connection created a marker twice); a failed
  save is shown inside the open dialog; a failed article list is reported. All map changes were
  already routed through one error handler; no other swallowed errors were found in `MapPages.tsx`.
- **Proposal limits:** items in `based_on`/`warnings` at most 300 characters and at most 50
  waiting proposals, enforced in the database (an OAuth token can insert directly).
- **MCP 0.4.0 reliability:** RFC 6750 error descriptions, 503 when signing keys are unreachable,
  retryable database errors, `retryable`/`hint` on every error, 413 for oversized bodies,
  `chronicle_whoami` connection diagnostics.
- **Upgrade rehearsal** `scripts/upgrade-simulation.sh` on PostgreSQL 17.12: hosted migration
  13 → all 15 pending files; data unchanged; schema and Storage policies equal to a fresh install.
- **Transitional check:** the new website on a stack with files 1–13 only: DM and reader pages
  work through the fallback (22 of 23 reader-facing browser tests passed; the other failed only
  on its no-console-errors check, from the 404 each settings request logs while the function is
  missing).

Verified at `963662f6b` on a fresh PostgreSQL 17.12 install: lint 0, typecheck (site and Worker) 0,
unit 119/119, database 307/307, browser 62/62. Upgrade rehearsal from hosted migration 13: all 15
applied, data and schema checks passed, database 307/307 on the upgraded database.

## 2026-11-15 — MCP integration and lore import (branch `claude/chronicle-mcp-lore-import`)

Resume here. Local and pushed only; **nothing applied to production**, nothing deployed, no real
lore imported. Base: `claude/chronicle-hardening` `2264cca4d` (PR #28 → #27 → #26).

**MCP, verified for real (locally):** the local stack now runs Supabase Auth 2.182.1 with its
OAuth 2.1 server, and the e2e script runs the MCP Worker in Cloudflare's local runtime.
`tests/e2e/mcp-oauth.spec.ts` performs a real client connection: discovery from the Worker's 401,
RFC 8414 metadata, dynamic registration, PKCE, the DM's consent in the browser, code exchange,
MCP over HTTP, refresh, direct Data API write refused (403), proposal saved only after website
approval, idempotent apply; refusal gives no code. Bug found and fixed: the consent page showed
a blank assistant name (the Auth server sends `client_name`).

**New MCP tools (server 0.3.0):** `chronicle_campaign_overview`, `chronicle_topic`,
`chronicle_list_quests`, `chronicle_session_prep`, `chronicle_wiki_health`,
`chronicle_draft_session_journal`, `chronicle_draft_gazette_story` (returns a draft for the news
desk; the change-set engine does not accept story pages, so it never saves or prints),
`chronicle_stage_import`, `chronicle_list_import_batches`, `chronicle_get_import_batch`. Measured
on 3,000 synthetic pages: every tool under 120 ms; the quest tools failed at scale and the
overviews were too large (fixed: batched lookups, capped lists with counts).

**Lore import:** `src/lib/loreImport.ts` (Markdown and JSON, classification with confidence,
canon levels, matching by address/redirect/title/alias, conflicts reported never applied,
suggested connections, bounded resumable parts, stable keys, recovery from the engine's record);
migration `20261115000100_import_batches.sql`; website staging and review pages; MCP staging. See
[`LORE-IMPORT.md`](LORE-IMPORT.md). Existing pages only gain DM-only additions, and only when
approved entry by entry.

**Verification (final code, fresh install of 26 migrations on PostgreSQL 17.12, synthetic
data):** lint and typecheck clean; unit 115/115; database 290/290; browser 60/60 (includes the
OAuth round trip, staged import on desktop and phone, assistant Gazette draft); stack safety
checks pass; no secret key in the build; 0 skipped. A pre-existing test that depended on the
order of two rows with the same timestamp was made order-independent (it still requires both).

**Needs the owner:**
- `chronicle-cloud/lore/dragonlance/pack.json` is real campaign lore committed to this public
  repository by an earlier session (commits 91154c0df, eac943e5c). It is untouched here. Removing
  it from the current branch does not remove it from history; decide whether to remove it and
  whether the repository should be private.
- Connecting ChatGPT to the hosted Worker (steps in `CONNECT-CHRONICLE-MCP.md`), backup and
  restore rehearsal, then approval of the 13-migration bundle.


## 2026-11-14 — independent review and hardening (branch `claude/chronicle-hardening`, PR #28)

Resume here. Local and pushed only; **nothing applied to production** (hosted project still has
13 migrations, re-checked read-only today). Base: `claude/chronicle-p0-security` `fca0d6651`
(PR #27), which sits on `claude/chronicle-photo-import` `a373fcd2c` (PR #26).

Independent re-verification of the earlier reports (run here, not copied): unit 98/98, database
260/260, lint and typecheck clean at `fca0d6651`. CH-101 to CH-104 were re-probed through direct
table writes and RPC calls as an assistant, a player, a revoked member and an outsider; the
earlier fixes hold. Reviewed without findings: RLS on every table, table and function grants,
search paths, the MCP worker's token checks and query building, the enrolment endpoint, Markdown
rendering and the Content Security Policy.

Defects found, reproduced and fixed in this pass:

| # | Severity | Defect | Fix | Regression test |
|---|---|---|---|---|
| H-1 | High (data loss) | Article editor: adding a connection, note or redirect reloaded the page data and silently replaced unsaved article text. | `ArticleEditor.tsx` keeps the unsaved draft and adopts the new version when only secondary data changed. | `tests/e2e/unsaved-work.spec.ts` (fails on the old editor) |
| H-2 | High (integrity) | Gazette editor: review and printing buttons acted on the saved text while the screen showed unsaved edits, then discarded those edits. | Buttons refuse while there are unsaved changes; leaving the page asks first. | `tests/e2e/unsaved-work.spec.ts` |
| H-3 | Medium (integrity) | Gazette: a stale tab could approve or print text saved elsewhere that the DM had not seen. | Migration `20261114000100`: `news_transition(uuid, text, text, timestamptz)` binds to the page version and waiting-revision timestamp; the website passes both. | `tests/db/hardening.test.ts` (incl. a two-session race) |
| H-4 | Medium (integrity) | An assistant connection could insert, change or delete `public.provenance` rows directly. | Same migration: the OAuth write guard now covers `provenance`. | `tests/db/hardening.test.ts` |
| H-10 | Medium (reliability) | Timeline editor, notes page and the article editor's connection and note panels: a failed save or delete showed nothing; the timeline's Edit button replaced an event being typed. | Failures are shown and the text kept; unsaved-changes prompts. | `tests/e2e/unsaved-work.spec.ts` |
| H-11 | Medium (security-relevant reliability) | Player access page and map page: removing a device, revoking a code, hiding a revealed fog area, switching fog, saving or deleting markers failed silently, so the DM could believe access or visibility was removed when it was not. Also article delete, redirect removal and unfinished-upload cleanup. | Every one reports "did NOT happen" and leaves the true state on screen. | `tests/e2e/failures.spec.ts` |
| H-5 | Low (tooling) | `scripts/e2e-local.sh` exited silently when the build failed. | Prints the build log and says the tests did not run. | — |
| H-6 | Medium (accessibility) | Keyboard focus could Tab out of the photo dialog onto the covered page. | Focus stays inside the dialog; Escape returns focus to the button. | `tests/e2e/interaction.spec.ts` (fails on old code) |
| H-7 | Low (correctness) | Search box: a slow answer for earlier typing could replace the current suggestions. | Only the latest request fills the list. | `tests/e2e/interaction.spec.ts` (fails on old code) |
| H-8 | Low (reliability) | Wiki settings: a failed save showed nothing; settings and map settings did not warn before discarding edits. | Error shown; unsaved-changes prompt. | `tests/e2e/unsaved-work.spec.ts` |
| H-9 | Low (usability) | Suggestions matched only the first word of a title ("merrin" found nothing for "Captain Merrin Vael"). | Migration `20261114000200`: any word start matches; still limited by RLS. | `tests/db/hardening.test.ts` |

Also added: two-session race tests for article saves and for applying one proposal twice;
`tests/e2e/layout.spec.ts` (26 routes at 320, 375, 412, 768 and 1920 px: no overflow found);
a CI job (`db`) that runs the database suite on a disposable local stack (passed on GitHub).

Verification on the final code (exact counts): see "Final verification" at the end of this
section. PostgreSQL 17.12 was used as well as 16; see the release bundle for the upgrade run.

Measured, no change needed: with 3,000 synthetic pages and 12,000 sections, a player's worst-case
search took 107 ms, suggestions 5 ms, a page's sections under 1 ms. Production build: about 184 kB
gzip for the first load (React 101, Supabase client 59, app 25); maps and Markdown load on demand.

Known and accepted (not fixed):
- `campaign_settings.current_location_id` is readable by players even when it points at a DM-only
  page. Only the opaque id is exposed (no title or text). Low.
- A player-visible section that links to a DM-only page exposes that page's address through its
  own text and `article_links`. The editor warns about this; the DM decides. Low.
- Signed picture links already issued stay valid until they expire (10 minutes).
- `npm audit`: 0 production vulnerabilities. Development tooling: vitest 4.1.12 and eslint 10.15.0
  removed the critical finding; 7 moderate remain (typescript-eslint chain), for which no fixed
  release exists yet. Not shipped to users. Note: `npm install` of these needed
  `--legacy-peer-deps` because of an npm resolver crash; `npm ci` works normally.
- Supabase advisor (production, read-only): "leaked password protection disabled" (owner setting);
  the SECURITY DEFINER notices are intentional, each function checks the caller itself.
- The map marker and fog dialogs have no unsaved-changes prompt (short dialogs).
- `Workers Builds: chronicle-wiki` fails on every PR; it is a Cloudflare dashboard build for the
  old Worker, not part of this code. Needs the owner's decision in Cloudflare.

Next tasks, in order: (1) owner: backup to permanent private storage and restore rehearsal;
(2) optional hiding of `current_location_id` (needs a schema change that would break the currently
deployed site between migration and deploy, so it must ship with a site release); (3) re-check
`npm audit` when typescript-eslint publishes a fix.

Later the same day: browser tests were added to the CI `db` job; after the tooling upgrade and
H-10 the local results were unit 98/98, database 272/272, browser 53/53 (PostgreSQL 16.15).
H-11 added 2 browser tests (55 in total); the related suites were re-run locally and pass.

Final verification (2026-11-14, final code, fresh install of all 25 migrations on PostgreSQL
17.12 with real Auth, Data API and Storage; synthetic data): lint clean; typecheck clean; unit
98/98; database 272/272 (22 files); browser 52/52 (includes phone-size tests, layout sweep,
failure injection); production build clean, secret key absent from `dist/`; stack safety checks
passed; 0 skipped. On PostgreSQL 16 the database suite was run at 269 tests locally and in CI
(before migration 12 and its 3 tests were added); CI re-runs it on every push.


## 2026-11-13 — CH-101 to CH-104 closed locally (branch `claude/chronicle-p0-security`)

Local and pushed only; nothing applied to production. Release bundle, hashes, gates and checklist:
[`RELEASE-BUNDLE-2026-11-13.md`](RELEASE-BUNDLE-2026-11-13.md).

- CH-101 — **Fixed locally** (`20261113000200`): statement guard refuses assistant (OAuth) writes
  to all 17 campaign tables unless an approved change set is being applied (transaction-local
  marker set only inside `apply_change_set`, not settable through the Data API). Website DM and
  approved MCP apply preserved. `tests/db/oauth-write-boundary.test.ts`, Codex's 15 expectations pass.
- CH-102 — **Fixed locally** (`20261113000400`): any assistant change touching player-visible
  content (fields, connections, categories, sections, restore of a published page) is refused and
  the change set rolls back; a client literally named "web" is not the website.
  `tests/db/mcp-public-content.test.ts`.
- CH-103 — **Fixed locally** (`20261113000500`, plus Terra's type guard): direct API, general
  editor, section or metadata changes to an approved story send it back to review; printing then
  needs a new approval. Players never receive pending revisions. `tests/db/gazette-review-integrity.test.ts`.
- CH-104 / photo defects — **Fixed locally** (`20261113000300`, client cleanup in `src/lib/api.ts`):
  Storage tamper (move, overwrite, re-upload) reproduced and closed through the real Storage API;
  in-use covers history, proposals, maps, galleries, Gazette revisions; attach/delete races locked;
  assistant connections cannot read files or private photo details.
- Verification: unit 98/98, DB 260/260 (21 files, includes real Auth/Data API/Storage tests),
  e2e 45/45 (includes phone-size tests), lint and typecheck clean, production build in the e2e run,
  fresh-vs-upgrade-from-13 schema identical, data unchanged by upgrade. 0 skipped.


Updated 2026-11-12. Production unchanged; no remote writes, production tests, migrations, or deployments. No real campaign content or credentials are recorded here.

- Branch `terra/chronicle-stabilization-20261112`. Original base `22324015ba47b591eb6ed25beca574b5cfcfce32`; resumed at `c8c41ddb468467d4c947518499c9dd1f5207ef17` with a clean tree. Current SHA: `git rev-parse HEAD`. The separate full Sol report remains unavailable; use the owner's instructions and this record, without inventing details.
- Environment: Node 24.22.1, npm 11.9.0, Docker 29.9.2. SQL-only test database uses the pinned PostgreSQL 16 image in an owned, disposable container, loopback-bound with in-memory data. Auth and Storage schemas are stubs, not real services. `bash scripts/sql-only-local.sh up` refuses an existing `.local`; `down` verifies container identity and leaves synthetic local files. The original local stack now checks resource ownership, pins the Docker socket, and rejects unowned directories and containers; its full service startup still needs testing. SQL-only setup needs Docker access and may require an execution-environment permission. PostgreSQL host binaries are absent.
- CH-000 — **In progress**: branch and durable plan/status established; full Sol report not available.
- CH-001 — **In progress** (`d86b24d9d`): ownership guards, SQL-only harness and synthetic lore fixture added. Fake-Docker refusal tests and a fresh SQL-only startup passed. Existing full service stack, complete expected-schema verification, full Storage, browser and synthetic lore import integration remain unverified. SQL-only schema and grants matched between a fresh install and an upgrade from migration 13 (migration 14 included only in disposable databases). The owned SQL-only container was stopped after testing; its synthetic `.local` files remain. The real Auth, Data API, and Storage services were not started.
- CH-101 — **In progress, unsafe for deployment** (`de58c7b8e`): statement triggers reject OAuth mutations of access codes and membership, including five privileged RPCs, with website, membership and MFA regression controls. OAuth `touch_member` is also blocked and needs a product/compatibility review. Direct OAuth writes to campaign content and other exposed mutation paths remain open; approved MCP behavior must be preserved when closing them.
- CH-102 — **In progress, unsafe for deployment** (`155f0ee80`): applying an OAuth change set cannot delete an already player-visible section; rollback, private-section control and visibility-change-after-preview tests pass. Preview still permits proposing that removal; infobox, relation, category, restoration and other operation gaps remain open. Locking and direct API behavior need full integration testing.
- CH-103 — **In progress, unsafe for deployment** (`a926f8ebe`): database rejects conversions into or out of news type at draft, approved and printed stages. This intentionally prohibits type conversion until a controlled workflow is designed. General article-editor, direct article/section writes, draft and approved-story review bypasses remain open.
- CH-104 — **In progress, unsafe for deployment** (`fad9d01cd`): section reparenting triggers media visibility recomputation and backfill; SQL-only public/private, mixed reuse, and Storage-policy row tests pass. Private credit/original-name reads, concurrency, full Storage API authorization, and other visibility cases remain open.
- CH-400 — **In progress** from previous session. CH-200–202, CH-300–301, CH-401–404, CH-302, CH-500–501 and CH-600–603 — **Not started**.

## Migrations

Generated with locally downloaded, checksum-verified Supabase CLI 2.75.0; repository had no pinned CLI. Each is forward-only, depends on the preceding migration, and includes a forward-recovery comment. Migration 14 remains unchanged and is not authorized for production.

| File | SHA-256 |
| --- | --- |
| `20261112051529_oauth_access_management_guard.sql` | `e199a797d6cae2cb725963c82a9c37df361bd2a10fd59d6a9a2f3a18ddffdf9e` |
| `20261112052309_oauth_visible_section_delete_guard.sql` | `315c230565902aed1528d05da7b2710595d3a044ea21273b45ef0ae14a7dfe45` |
| `20261112052438_protect_gazette_type_transitions.sql` | `c3140e72e76df7071899609b174292063c7e9189ef40f34e1026460673b2144c` |
| `20261112052528_resync_reparented_section_media.sql` | `15645f8fb1c42e0da0a3c032c4c755a50386cb3bb115ef99b76639130e84c064` |

Applied only to disposable SQL-only test databases. Fresh and upgrade schema/grant dump comparison passed after normalizing dump session markers. Backfill and locking effects on real production-sized data remain untested.

## Verification and next work

- `npm test`: 97 passed. `npm run lint`, `npm run typecheck`, and a build with synthetic local Supabase settings passed. `bash scripts/local-stack-safety.test.sh` and `node --test scripts/local-targets.test.mjs` passed.
- Selected SQL-only suites: 129 passed across OAuth, change sets, Gazette, privacy, database privileges, article images, map fog, audit, functions, and article save. These exercise RLS with simulated JWT claims and stub Storage rows; they are not live API or Storage tests.
- An earlier broad SQL-only attempt had 20 failures: 19 from a missing extensions-schema grant in the stub, corrected before the passing run; one expected real Storage API test failed because no service was running. Full database/service suite and browser suite were not run in this session. Synthetic lore fixture validates locally but its API integration test remains unrun.
- Next: finish CH-101 direct-write restrictions with an independently authorized approved-application path and direct API tests; cover all CH-102 operations; close Gazette editor/direct-write bypasses; protect media metadata and concurrency. First establish and verify real disposable Auth, Data API and Storage services. Do not deploy this partial bundle.

## Isolated follow-up, 2026-11-13 UTC

- Fetched and verified `origin/terra/chronicle-stabilization-20261112` at `0f9e879b565c7e7b06988039e876c12f3505d7fc`. Worked on a separate local branch `codex/chronicle-ch101-local` so the pushed Terra branch remains unchanged.
- Added CH-101 *regression expectations*, not a fix, for direct OAuth writes to 15 synthetic content/settings surfaces, their website-session controls, and OAuth snapshot creation. They are expected to reveal existing gaps when first run; no DB test result is claimed.
- `git diff --check` and the Node syntax check for the changed test file passed. This executor has no `docker`, `psql`, PostgreSQL binaries, or installed Chronicle npm dependencies. No database, API, Storage, unit, or browser tests ran in this follow-up. Its separate disk has ample free space; earlier test-container availability did not carry over.
- No migrations were added or applied. No remote branch was pushed by this follow-up, and no production content, settings, or permissions changed. Resume CH-101 only with a verified disposable PostgreSQL/Auth/Data API environment. Keep migration 14 and all production changes gated.

## Photo import, 2026-11-13 UTC (branch `claude/chronicle-photo-import`)

- Based on `origin/codex/chronicle-ch101-local` at `02e3f946f`, which contains Terra's `0f9e879b5` and the Gazette branch `22324015b`. Terra's commits and the CH-101 tests are unchanged.
- Environment: the full local stack with real GoTrue, PostgREST and Storage services, started with Terra's ownership-checked `local-stack.sh`.
- `local-stack.sh` had two bugs in its never-tested full start; both are fixed:
  - `.local` is now created with mode 711, so the `postgres` user can reach `.local/pg`.
  - A database folder that was never initialised no longer blocks a restart.
- `e2e-local.sh` now stops the whole `wrangler`/`workerd` process group, and refuses to start if port 8788 is already serving. A stale server from an interrupted run had answered a full browser run with old keys (29 false failures).
- **CH-200 / CH-201 / CH-202 — Done locally (not deployed)**, plus CH-104 private media metadata. Migration `20261113000100_photo_library.sql`:
  - private `media_private` details (credit, original name, crop, source link);
  - private full-frame sources (`media.role = 'source'`, always DM-only);
  - atomic `register_photo`, which accepts only files that exist in Storage;
  - pictures in use cannot be deleted;
  - assistant (OAuth) connections cannot write photos;
  - Storage policies: website DM only, `media/` and `sources/` folders only, no deleting registered files.
- Website: phone-first picker:
  - *Choose from device* / *Choose from library*, drag-and-drop;
  - HEIC and other unreadable files explained;
  - upload progress; one save per click;
  - partial-batch recovery; failed uploads cleaned up.
- Adjusting:
  - re-crops from the private full-frame copy, starting at the saved crop;
  - works for pictures in text too;
  - expired signed links are refreshed once.
- Pages:
  - session journals now show their main picture;
  - banner warning;
  - *Add gallery section* button.
- Phone layout fixes:
  - page editor section rows and infobox rows wrap;
  - Media Library cards no longer overflow;
  - the picker dialog fits its content.
- Existing tests updated for the new intended behaviour:
  - `media-sync`: deleting a picture in use is now refused;
  - `audit`: the restore test detaches the picture first;
  - `enroll-integration`: uploads use `media/` paths.

| Migration | SHA-256 |
| --- | --- |
| `20261113000100_photo_library.sql` | `62a43851cc030fa7fe22b04bc1b01d939f6040b8382bac4bb5eb038d182cc687` |

Verification (local disposable stack, synthetic data):
- `npm test`: 98 passed.
- `npm run lint` and `npm run typecheck`: clean.
- `bash scripts/local-stack-safety.test.sh` and `node --test scripts/local-targets.test.mjs`: passed.
- `npm run test:db`: 211 passed, 15 failed. The 15 failures are the pre-existing CH-101 direct-write expectations for non-media content, which were also failing before this work. The media expectation now passes.
- Fresh install of every migration in order, followed by 59 photo, media and privacy tests: all passed.
- `bash scripts/e2e-local.sh`: 43 passed, including 5 new photo tests (desktop and phone).

Production remains unchanged. Do not apply migration 14, Terra's four migrations or `20261113000100` to production until all of these hold:
- a complete current backup is verified in permanent private storage;
- a restore test succeeds;
- the owner approves the exact bundle.
