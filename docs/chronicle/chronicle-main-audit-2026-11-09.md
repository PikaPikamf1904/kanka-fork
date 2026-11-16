# Chronicle integration audit: `chronicle/main` (2026-11-09)

**This is a new audit.** It is not the 2026-10-26 Chronicle audit (commits `cbcc485fe` and
`399646229`, branches `audit/chronicle-integration` and `audit/chronicle-backend`). Those commits
are not on GitHub, in any branch or by SHA, and no copy was reachable from this session. Nothing
here was reconstructed from reports of that audit. If the original turns up, compare it with this
one and merge what is missing.

| Item | Value |
|---|---|
| Audited ref | `origin/chronicle/main` at `02d2aef95` ("Harden local upload authorization and migration", 2026-10-17) |
| Compared against | `develop` at `c700f4651` (the fork point) |
| Size | 55 commits, 390 files, +9,952 / −883 lines |
| Environment | Cloud container, PHP 8.4.11 CLI (Ubuntu 25.10 root filesystem), SQLite in-memory tests |
| Deployed? | Nothing was deployed or run against a server. |

## 1. Integration state

`chronicle/main` is a fast-forward of `develop` and **contains every branch on GitHub**. No
GitHub branch has commits that are missing from it.

| Branch | Draft PR (all still open, none merged) | In `chronicle/main` |
|---|---|---|
| `ccr-5d64e0e2-bidvdy` | #1 test suite runnable + first-pass audit | yes |
| `deploy/free-hosting-prep` | #2 single-VM self-hosting prep | yes |
| `bigbertha/self-hosting` | #3 deploy kit, backups, invite-only sign-up | yes |
| `bigbertha/auth-hardening` | #4 close login-as in production; throttle resets | yes |
| `bigbertha/ce-assessment` | #5 Kanka-CE review | yes |
| `bigbertha/private-exports` | #6 admin-only export downloads | yes |
| `bigbertha/dm-privacy` | #7 DM-only content out of search, filters, exports, API | yes |
| `bigbertha/graph` | #8 private relationship graphs, relations web | yes |
| `bigbertha/character-sheets` | #9 D&D 2024 character sheets | yes |
| `bigbertha/encyclopedia-theme` | #10 Chronicle theme, Font Awesome Free fallback | yes |
| `bigbertha/deploy-hardening` | #11 deploy script hardening | yes |
| `bigbertha/plain-http-urls` | #12 plain-HTTP production links | yes |
| `bigbertha/shared-entrance` | #13 shared-password entrance | yes |
| `bigbertha/chronicle-rebrand` | #14 Chronicle rebrand | yes |
| `codex/chronicle-storage-authorization` | none | yes (same commit as `chronicle/main`) |

The open draft PRs target intermediate branches, not `develop`, and their merges into
`chronicle/main` happened outside GitHub. Closing or retargeting them is a housekeeping decision
for the owner; this audit changes none of them.

## 2. Verification

All runs used PHP 8.4.11 on `02d2aef95`, with `.env.testing` and `phpunit.xml` (SQLite in-memory),
test-only Passport keys from `php artisan passport:keys --env=testing`, and `APP_EMAIL` set to a
placeholder so `spatie/laravel-backup` boots. Composer was installed from source because GitHub
archive downloads were blocked here; `phpstan/phpstan` was seeded into Composer's cache from a
git clone of the locked commit `174b0d887`.

| Check | Result |
|---|---|
| Pest, full suite (`stopOnFailure` turned off in a temporary copy of `phpunit.xml`) | **1303 tests: 1279 passed, 15 failed, 2 errors, 7 skipped** (4547 assertions, 2 min 21 s) |
| PHPStan (`phpstan analyse`, as `composer test:types`) | **1 error**, new in the Chronicle work (finding L3) |
| Pint (`pint --test`) | 7 files need style fixes, all changed by the Chronicle work (finding I3) |

**No new test failures.** All 17 failing tests are on the list of failures that predate the
Chronicle work (`docs/dragonlance/first-pass-audit.md`, section 5): `CalendarAdvancerTest`; map
zoom limits (`MapTest` ×2, `ExploreApiControllerTest`); HTML output (`EditControllerTest`,
`MarkerControllerTest` ×2, `EntityTest`); route slug vs id (`EntityAssetTest`,
`Maps/ExploreControllerTest`); `GroupControllerTest`, `MapMarkerPathRenderTest`,
`ExploreApiControllerTest` fallback, `TimelineEraTest`; and the migration tests
(`EntityMentionsPolymorphicMigrationTest`, `TilingMigrationsTest`, `EntityObserverTilingTest`).
Four from that list now pass: `MigrateLegacyImagesCommandTest` ×2 and `LivewireCampaignTest` ×2.

The skips are: marketplace routes disabled, `vips` not installed (tile rendering), and two
DM-privacy search tests that use MariaDB-only SQL (`RLIKE`). **Those two privacy tests did not
run here**; see section 5.

## 3. Findings

Severity is about this fork's use: a private, self-hosted wiki behind an optional shared
password, with campaign admins (DMs) and players.

### M1. Legacy image migration: `_` in a prefix is a SQL wildcard (medium)

`02d2aef95` widened the `images:migrate-legacy` prefix check to accept `_`
(`app/Console/Commands/Migrations/MigrateLegacyImages.php`, `prefix()`), so `map_layers` and
`dice_rolls` can now be migrated. `app/Services/Images/LegacyImageMigrationService.php` still
builds every `LIKE` from the raw prefix (`inventorySources()`, `owners()`, `indexColumn()` and the
counts around lines 315, 321, 354, 551, 563, 581 and 628). In both SQLite and MariaDB `_` matches
any single character.

- Reproduced on SQLite: `WHERE p LIKE 'map_layers/%'` returns `map_layers/a.png`,
  `map-layers/b.png` and `mapXlayers/c.png`.
- Effect: a run for `map_layers` (or `dice_rolls`) also picks up rows whose path differs only in
  that character. The command copies objects, rewrites references, and with `--execute` deletes
  the source objects, so rows from another prefix could be migrated and deleted under the wrong
  prefix.
- Likelihood depends on the stored paths. Kanka's own prefixes do not normally collide, but
  nothing prevents it.
- Fix: escape `\`, `%` and `_` in the prefix before every `LIKE` (and state the escape character
  for MariaDB), then add a test that `diceXrolls/…` and `dice-rolls/…` are not matched by
  `dice_rolls`. This was already listed as a proposed task in `docs/dragonlance/handoffs.md`;
  only the regex half was done.

### L1. `restore.sh` leaves uploads readable by nginx (low)

`deploy/server/release.sh` locks `shared/storage/app/public` to `700` and says nginx gets no
access to uploads. `deploy/server/restore.sh` instead sets the restored uploads to directories
`755` and files `644` (lines 305–306), and `--undo` sets the top directory to `755` (line 158).
`storage` and `storage/app` are `750` with group `www-data`, so after a restore the nginx user can
read every upload on disk until the next release re-locks the top directory.

- No current HTTP path serves them: `nginx-kanka.conf` sends `/storage/` to PHP, so
  `StoredUploadController` still applies the ACL checks. This is defence in depth only.
- Fix: in both places, use the same `700` top directory (and owner-only files) as `release.sh`.

### L2. CI does not run the test suite (low)

`.github/workflows` runs Pint and PHPStan only; the Pest step is commented out upstream, and the
new `release-build.yml` builds without testing. Every change since the fork was tested by hand in
containers. A Pest job on PHP 8.4 with SQLite would catch regressions before they reach
`chronicle/main`. (Also proposed in `docs/dragonlance/handoffs.md`.)

### L3. PHPStan error in `StoredUploadController` (low, but fails CI)

`app/Http/Controllers/StoredUploadController.php:128` passes a `MapLayer|null` to
`abort_unless()`, which expects a bool:
`Parameter #1 $boolean of function abort_unless expects bool, App\Models\MapLayer|null given.`
The behaviour is correct (a null layer aborts with 404), but `.github/workflows/phpstan.yml` runs
on pull requests to `develop`, so any PR carrying `chronicle/main` into `develop` would fail that
check. Fix: `abort_unless($layer !== null, 404);`, or use `->exists()` like the lookups above it.

### I1. Character sheet and private properties (informational, behaves as designed)

A non-DM editing a sheet whose property is private cannot see that property, so saving the field
creates a new public property with the same name. The DM then sees both, and the sheet shows the
public one (`CharacterSheetService::attributes()`, documented in the code). Nothing private
leaks; it can surprise a DM. Worth a line in the user-facing notes.

### I2. Routes outside the shared entrance (informational)

The entrance gate is in the `web` middleware group. The `minimum` group (`routes/vendor.php`:
the LaRecipe documentation pages and the login-required translations area) and the `webhooks`
group (Facebook data deletion) are not behind it. None of them expose campaign content.
`/api/1.0` needs Passport authentication and `/api/public` is closed by `ClosedBehindEntrance`.

### I3. Pint style in seven Chronicle files (informational)

`pint --test` flags `config/app.php`, `routes/api.php`, `routes/web.php`,
`tests/Feature/Branding/ChronicleBrandingTest.php`,
`tests/Feature/Console/MigrateLegacyImagesCommandTest.php`, `tests/Feature/Entrance/GateTest.php`
and `tests/Feature/Entrance/StorageAuthorizationTest.php`. The lint workflow runs `pint` on pull
requests to `develop` and `main` and auto-commits the fixes, so this needs no separate work;
running `pint` before the next push avoids the extra commit.

## 4. Reviewed with no findings

| Area | What was checked |
|---|---|
| Upload serving (`StoredUploadController`, `/storage/{path}`) | Traversal (`..`, `\`) rejected; campaign resolved through `Campaign::acl()`; entities, maps and posts carry the global `AclScope`, images, assets, map layers and inventory the global `VisibilityIDScope`, so each lookup is permission-scoped; avatars only when currently assigned; responses `private, no-store`, `nosniff`, `noindex`. nginx routes `/storage/` to PHP, so a `public/storage` symlink cannot bypass it. |
| Shared entrance | Password stored as a hash; grant cookie holds a random 40-character version and an expiry, compared with `hash_equals`, encrypted by `EncryptCookies`, `HttpOnly`, `SameSite=Lax`; rotating the password invalidates all grants; `/entrance` rate-limited 5 per minute and 30 per hour; landing path restricted to same-site paths; manager page needs a listed user id and password confirmation. |
| Auth hardening | Login-as shortcuts disabled whenever `app()->isProduction()`, regardless of `.env`; password reset emails throttled; invite code compared in constant time and register throttled; social sign-up refused while an invite code is set; `users:create` reads the password interactively and never from arguments. |
| Campaign exports | Download requires the `setting` permission, checks the export belongs to the campaign, validates the stored path against `exports/{campaign}/…zip`, and refuses expired exports. |
| DM privacy | Filter subqueries (races, families, organisations, attributes, relations, posts, files) now go through the model's own visibility scope; the old string-built SQL was replaced with bound `whereIn`; API attribute output checks `view-attributes`; relationship graph drops hidden mirrors and edit links and resets per request (it previously could carry one user's graph into the next response in a long-running worker). |
| Character sheets | View needs `view-attributes`; edit needs `update` and `attributes`; private properties only for campaign admins; validation per field; user text passes through `Purify::clean`. |
| New Blade and Vue output | New `{!! !!}` and `v-html` uses output translation strings or purified text; `$themeUrl` and `$seoTitle` follow existing upstream patterns. |
| Deploy scripts | All use `set -euo pipefail` (except the diagnostic scripts, which intentionally continue); database restore swaps tables in one all-or-nothing `RENAME TABLE` and refuses to overwrite a leftover `_old` database. |
| `release-build.yml` | Manual trigger only, `contents: read`, no secrets, artefact only. |

## 5. Not verified

- MariaDB behaviour (production database). Only the SQLite suite was run, so the two DM-privacy
  search tests that need MariaDB were skipped.
- Browser checks of the theme, entrance page, relations web and character sheet (layout, focus,
  dark mode, overflow).
- `yarn build` and the front-end bundle.
- The deploy kit on a real Debian 13 machine; scripts were reviewed, not run.
- Anything in the 2026-10-26 audit, which was not available.

## 6. Suggested next tasks

1. Fix M1 and add the wildcard test (small, one service file).
2. Fix L3, the one-line PHPStan error, so a PR to `develop` passes CI.
3. Fix L1 in `restore.sh` (small).
4. Run the suite once in MariaDB mode (`deploy/dev/run.sh pest-mariadb`) before the first deploy,
   so the two skipped DM-privacy search tests actually run.
5. Triage the 17 pre-existing failures, then add a Pest CI job (L2).
6. Decide what to do with the 14 open draft PRs now that `chronicle/main` contains them all.
