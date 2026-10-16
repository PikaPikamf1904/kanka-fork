# Handoffs (proposed; none of these have been run yet)

Shared rules: work on a branch per task and touch only the files listed. Run the focused tests plus `phpstan analyse` and `pint --dirty`. Do not change `boost_count`, `boosted()`/`premium()` checks, policies, or payment code. Use synthetic data only; no real campaign content.

Environment: see `first-pass-audit.md` §4 (PHP 8.4 container, `passport:keys --env=testing`, no `.env` for tests).

## Haiku: QA and small fixes

1. **Triage the 21 pre-existing test failures** (list in the audit, §5). For each one, say whether the test is out of date or the code is wrong, and give one line of evidence. Fix only cases where the test plainly encodes old behaviour, such as the map max zoom changing from 15 to 18. Leave behaviour changes as a list.
2. **CI workflow.** Add `.github/workflows/tests.yml` running Pest on PHP 8.4 with SQLite, after task 1 makes the suite green. Do not use `--ignore-platform-reqs`.

## Sonnet: engineering

1. **`MigrateLegacyImages` underscore prefixes.** Allow `_` in the prefix regex *and* escape `%`/`_` in every `LIKE` built from the prefix in `LegacyImageMigrationService`. Add a test showing that `dice_rolls` does not match a `diceXrolls/` path.
2. **Bundle audit of `app.js`** (181 KB gzip on every page). Add `rollup-plugin-visualizer` behind an env flag, find what loads eagerly, and lazy-load it where that is safe. Report before and after sizes from `yarn build`.
3. **Map privacy tests.** Assert that a player (non-admin) gets neither hidden or private markers nor their names or coordinates from the map explore API or the HTML payload. Cover both the `is_private` and `visibility_id` paths.

## Luna: primary implementation (Dragonlance theme and profiles)

Goal: an independently built Dragonlance look plus richer character pages, without touching premium gates.

1. **Fork theme (always on, not a "campaign style").** Add `resources/css/dragonlance/*.css` and import it into `resources/css/app.css` behind a config flag (`config('app.fork_theme')`, env `FORK_THEME=dragonlance`). Palette: charcoal, navy, parchment, ivory, muted gold, restrained crimson. Use a serif for headings (a Google or self-hosted OFL font) and a readable body face. Must support light and dark, keep visible focus rings, and avoid horizontal overflow at 360 px. Do not use the boosted theme builder.
2. **Character infobox component.** Add a Blade component `x-dragonlance.infobox` rendered on character pages. It reads existing fields (title, age, pronouns, races, families, organisations, location, `is_dead`) plus attributes whose names match a documented allowlist (Class, Subclass, Level, Background, AC, HP, Speed, ability scores). Omit empty rows. Respect attribute privacy: `is_private` attributes are shown only to users with `update` permission. Add feature tests for owner vs player visibility.
3. **2024 D&D attribute template seeder.** Add an *opt-in* artisan command that creates an attribute template with the fields above in a chosen campaign. Do not auto-run it.

Report back with the branch, commits, exact test output, before and after screenshots at 360/768/1280 px (synthetic data), and anything not verified.
