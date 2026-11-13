# Chronicle implementation status

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
