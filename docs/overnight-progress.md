# Overnight progress (2026-11-09)

| Phase | State | Commits |
|---|---|---|
| A. Recovery and baseline | Done | — |
| B. Feasibility | Done (`docs/hosting/`) | docs commit |
| C. Database and auth | Done, tested | `9afc5a3d6`, `d7625359a` |
| D–F. Wiki, DM tools, maps, connections | Done, tested | `60cb21ad6` |
| G. Migration tooling | Done for text content; images and maps not imported | `2c80dbc8b` |
| H. Verification and handoff | Done | `cb4163e12` + final commit |

Baseline (before any change), on `audit/chronicle-integration` at `cbcc485fe`, PHP 8.4.11 + SQLite:
1,360 Pest tests: 1,336 passed, 15 failed, 2 errors, 7 skipped. The 17 failures are the same
pre-existing ones recorded in `docs/dragonlance/first-pass-audit.md`. PHPStan: 9 errors
(7 in `app/Services/Maps/MarkerAudience.php`, 2 in API controllers). The Kanka app was not
changed in this work.

Earlier audit findings, rechecked on `cbcc485fe`:

| Finding | Status |
|---|---|
| M1 `_` is a wildcard in the legacy image migration | Still open (`preg_match('/^[a-z0-9_-]+$/')`, unescaped `LIKE`) |
| L1 `restore.sh` leaves uploads 755/644 | Still open (lines 158, 305–306) |
| L2 CI does not run Pest | Still open |
| L3 PHPStan error at `StoredUploadController.php:129` | **Fixed** on the integration branch (`->exists()`); an earlier report of mine said it was open, which was wrong |
