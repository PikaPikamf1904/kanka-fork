# Dragonlance fork: first-pass audit (2026-10-16)

Scope: `PikaPikamf1904/kanka-fork`, branched from `develop` at `c700f46`.
Everything below was measured in a cloud container. Nothing has been deployed.

## 1. Stack (verified from the repository)

| Item | Value |
|---|---|
| PHP | `^8.4` (app code uses 8.4-only syntax such as `new Foo()->bar()`; PHP 8.3 cannot parse it) |
| Framework | Laravel `^13.10`, Pest 4, Livewire, Passport, Scout (Meilisearch), Cashier |
| Frontend | Vite 7, Vue 3, Tailwind 4, Tiptap 3, Leaflet, Cytoscape |
| Production DB | MariaDB (plus a `replica` read connection for guests and a separate `logs` DB) |
| Tests | SQLite in-memory, `RefreshDatabase`, null Scout driver |
| Services (Sail) | MariaDB, Redis, MinIO, Thumbor, Mailpit, Meilisearch |
| CI | `.github/workflows`: Pint and PHPStan only. The test step is commented out upstream. |

## 2. License: needs a decision

- `LICENSE` contains only the Commons Clause v1.0 (licensor: Owlchester SNC). The clause modifies "the License", but no base license (GPL, MIT, Apache, etc.) is named or included. Upstream's `LICENSE` has the same text.
- `composer.json` declares `"license": "proprietary"`.
- No commercial use is planned, so the Commons Clause "no selling" condition is not the problem. The problem is that **no base grant of rights to copy, modify or run the software is stated**. A private, noncommercial installation is almost certainly what the authors expect, since `docs/running.md` documents self-hosting. Even so, this is an inference, not a written grant.
- Recommendation: before relying on this fork long-term, ask Owlchester (via GitHub or Discord) to confirm the base license, or to confirm in writing that a private, noncommercial self-hosted fork is allowed. Keep `LICENSE`, the Commons Clause notice, and attribution intact.

## 3. Premium (boost) gating

All premium code is in this repository. It is gated by `campaigns.boost_count` (`app/Models/Concerns/Boosted.php`): `boosted()` means more than 0, `superboosted()` means more than 2, and `premium()` means 4 or more. There are about 240 call sites. Examples:

| Feature | Gate |
|---|---|
| Custom CSS / theme builder UI | `boosted()` in `campaigns/styles/*.blade.php` |
| Family-tree editing (save) | `premium()` in `Families/Trees/ApiController` |
| Extra dashboards | `boosted()` in `Campaign/DashboardController` |
| Custom entity types | `premium()` in `EntityTypePolicy` |
| Gallery widget | `premium()` in `CampaignPolicy::galleryWidget` |
| Whiteboards | `premium()` + Wyvern/Elemental pledge (or debug/QA env) |
| Map groups/layers above the standard limit | `boosted()` in `MapPolicy` |
| Hide members/history | `boosted()` |

Raising `boost_count` directly in the database or removing these checks would unlock paid tiers. **That is out of bounds under the mission rules.** Possible routes:
(a) ask Owlchester for written permission for a private install;
(b) build independent features that do not touch the gates (for example, a fork-specific theme that ships in our own CSS, and new profile and infobox components).

## 4. Reproducible environment (what actually worked here)

- Sail and Docker Hub were unavailable (Hub returned 429 rate limits; Debian and PPA mirrors were blocked by the network policy). Ubuntu's archive was reachable, so `php84-test-image/Dockerfile` (Ubuntu 25.10, PHP 8.4.11) is used.
- `composer install` needed `--prefer-source` because GitHub zipball downloads were blocked. `phpstan/phpstan` is dist-only; it was seeded into Composer's cache from a git clone.
- Tests also need `php artisan passport:keys --env=testing` (the keys are gitignored).
- Do not create a `.env` from `.env.example` for tests. Tests read `.env.testing` and `phpunit.xml`.

## 5. Test baseline

| Run | Result |
|---|---|
| Before fix (stopOnFailure off) | 126 passed, **924 failed**, 1 skipped |
| After the `DB_REPLICA_ENABLED` fix | **1031 passed, 21 failed**, 3 skipped (3272 assertions, about 115 s) |
| PHPStan (`phpstan analyse`) | No errors |
| Pint on changed files | Pass |
| `yarn build` | Pass (about 20 s) |

Root cause of the cascade: `ReplicationSwitcher` moved every guest web request onto the hardcoded MariaDB `replica` connection. In SQLite tests this either fails, leaving the shared in-memory transaction open so every later test fails, or, on a Sail machine, quietly reads the dev database. The middleware now honours `database.replica_enabled` (env `DB_REPLICA_ENABLED`, default `true`), and `phpunit.xml` turns it off.

The 21 remaining failures predate this change. Each one also fails when its file is run on its own:

- `Console/CalendarAdvancerTest`: an expected exception is not reported.
- `Console/MigrateLegacyImagesCommandTest` (2): the command's prefix regex rejects `_`, but the service supports `dice_rolls`/`map_layers`. Fixing it also requires escaping `_` in its `LIKE` filters.
- Map zoom limits (`MapTest` ×2, `ExploreApiControllerTest`): the tests expect max 15, the code gives 18.
- HTML/sanitizer output (`EditControllerTest`, `MarkerControllerTest` ×2, `EntityTest` mention markup).
- Route slug vs id (`EntityAssetTest`, `Maps/ExploreControllerTest`).
- `GroupControllerTest`, `MapMarkerPathRenderTest`, `ExploreApiControllerTest` fallback, `TimelineEraTest`.
- `LivewireCampaignTest` ×2 (404 handling).
- Migrations: `EntityMentionsPolymorphicMigrationTest`, `TilingMigrationsTest`, `EntityObserverTilingTest`.

## 6. Performance baseline

Backend (SQLite in-memory, `APP_RUNNING_IN_CONSOLE=false` so per-request caches behave as on the web, owner user, first request of a fresh process):

| Page | Queries at 10 characters | Queries at 40 characters |
|---|---|---|
| Dashboard `/w/1` | 17 | 16 |
| Character list `/w/1/t/{character}` | 6 | 6 |
| Character page `/w/1/entities/{id}` | 29 | 30 |
| Map list | 6 | 6 |

- No N+1 growth with dataset size on these pages. The character page has no duplicate queries in web mode.
- Under plain Pest, `Entity::getChildAttribute()` skips its cache whenever `runningInConsole()` is true. That inflates the character page to 45 queries, 15 of them identical. **This is a test artifact, not a production problem.** Future benchmarks must set `APP_RUNNING_IN_CONSOLE=false`.
- The `users` writes seen on a page view (`last_login_at`, `last_campaign_id`) are already throttled to once per day or once per campaign change.
- Not measured: MariaDB query plans, Redis-warm timings, Meilisearch, and real HTTP latency. These need the Sail stack or a staging host.

Frontend (`yarn build`; initial JS for each entry including its static imports, gzip):

| Entry | JS gzip | Notes |
|---|---|---|
| `maps/explore.js` | 216 KB | Leaflet canvas plus marker panel; the biggest first-load page |
| `app.js` (every page) | 181 KB | Includes the Vue runtime |
| `whiteboards.js` | 172 KB | |
| `campaigns/style-editor.js` | 147 KB | CodeMirror |
| `family-tree-vue.js` | 117 KB | |

Tiptap (630 KB raw), Cytoscape (442 KB), jsPDF (386 KB) and html2canvas (201 KB) are already split out with dynamic `import()`. Next step: open `app.js` with `rollup-plugin-visualizer` to see what is in the 181 KB loaded on every page.

## 7. Security notes

- The `replica` connection was hardcoded to MariaDB. With our default single-DB setup, `DB_REPLICA_HOST` falls back to `DB_HOST`, so production behaviour is unchanged.
- `ReplicationSwitcher` calls `DB::setDefaultConnection()` without resetting it. That is fine under PHP-FPM. **Do not run under Octane** without resetting the connection per request.
- Public relations page (`/w/{c}/entities/{e}/relations`): returned a 500 in a harness test because `DatagridRenderer2` is a singleton bound before the campaign route parameter exists. This is probably a test-harness artifact. Not verified over real HTTP.
- `docs/running.md`: the Sail Docker stack has no security and must never be exposed publicly.
