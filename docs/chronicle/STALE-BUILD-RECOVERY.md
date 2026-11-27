# "Failed to fetch dynamically imported module" after a release

## Cause (verified on the live site, 2026-11-23)

1. Pages such as the Knowledge Graph load their JavaScript **on demand**, from files under `/assets`
   whose names contain a hash of their content.
2. Every release **replaces** those files. A tab opened before the release still asks for the old names.
3. Cloudflare Pages answers a name it no longer has with the home page: `200`, `text/html`, and the
   `immutable` one-year cache header our `/assets/*` rule adds. The browser refuses HTML as a script
   and raises *Failed to fetch dynamically imported module*.
4. Some old files linger in an edge cache (the live server still served a previous release's entry
   file, `age` about 23 hours) and others do not, so it looks random: a rarely opened page such as the
   graph is the usual victim.
5. Nothing in the app caught the error, so the router's default error page appeared. There is no
   service worker, so none of this is a service worker problem.

## Fix

- `src/lib/chunkRecovery.ts` decides what to do when a page's JavaScript cannot be loaded. It asks the
  server for the home page with `no-store` and compares its entry script with the one this tab runs.
  - Different: a release happened, so it **reloads once**.
  - The same, or the server cannot be reached: reloading would change nothing, so it **does not reload**.
  - One automatic reload per tab per 5 minutes (kept in `sessionStorage`). If tab storage is not
    available, it never reloads on its own. A loop is not possible.
- `src/components/ErrorScreen.tsx` is the router's error page, inside the layout so the menu stays. It
  shows "Updating Chronicle…" while checking, then, if recovery is not possible, a plain message with
  **Reload the page** and **Go to the main page**. No stack trace; the same for the DM and players.
  Crashes while rendering get the same screen, and an outer boundary covers errors outside any page.
- Tests: `src/lib/chunkRecovery.test.ts` (error wording of Chrome, Firefox and Safari, the decision
  rules, the loop guard) and `tests/e2e/stale-build.spec.ts` (plays a release against the real build:
  player, DM, no release, a broken release, a stale home page served again, and a phone).

## Prevention (2026-11-23)

What Cloudflare Pages does, read from its asset server (`pages-shared`, shipped in `wrangler`):

- A missing file is first looked up in an **asset preservation cache**: files served by earlier
  deployments are kept for **7 days**, but only in the data centres that served them. That is why some
  old files survive a release and others do not.
- Then it looks for the nearest `404.html` up the path. With none, it serves `index.html` with `200`
  (the single-page fallback). Every `404` response has its `Cache-Control` replaced by `no-store`.

Changes:

1. **`public/assets/404.html`**. A file missing under `/assets/` now gets a real **404** with
   `no-store`, so HTML is never cached under a JavaScript address and the browser fails fast.
   `/graph`, `/wiki/...` and every other app address still get `index.html`, because there is still
   no top-level `404.html`.
2. **Release check while the tab is open** (`watchForNewRelease` in `chunkRecovery.ts`). Every
   5 minutes while the tab is visible, and whenever it comes back to the front, it re-reads the home
   page (a static file, free on Pages). Once a newer release is out, the next click on a link inside
   Chronicle loads that page in full, so the old copy never asks for a deleted file.
3. The recovery above stays for a click that comes before the check has run.

Considered and not done:

- **Carrying old files into each new deployment** (download the previous release's `/assets` during
  the build). Pages already keeps them for 7 days where they were used, and the two measures above
  cover the rest. Copying would make every build depend on the live site and grow each deployment.
- **Versioned hosting outside Pages** (R2, a Worker, a second domain): new infrastructure for one
  avoided reload.
- **A Pages Function on `/assets/*`**: it would run on every file request and count against the
  free daily request limit.
- **Moving to Workers static assets**: a platform migration for the same result as one `404.html`.

Tests: `tests/e2e/release-transition.spec.ts` swaps two real builds under an open tab on Cloudflare's
local runtime: a release, a rollback, two releases in a row, prevention with no missing file
requested, and recovery after one real 404.

## Limits

- A tab already open on a build **older than this fix** cannot recover on its own; its next reload does.
- Reloading drops anything not saved. It happens only when the page the reader asked for cannot be
  shown, and an editor with unsaved changes still gets the browser's own "leave this page?" question.
- Before the `assets/404.html` change, a browser could cache the HTML answer under an old chunk name
  for a year. Such entries already in browsers stay until they expire; a 404 is never cached now.
- Production's preservation cache could not be exercised from here: it is per data centre, and the
  local runtime has none. The tests cover the case where it does not have the file.
