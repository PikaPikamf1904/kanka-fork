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

## Limits

- A tab already open on a build **older than this fix** cannot recover on its own; its next reload does.
- Reloading drops anything not saved. It happens only when the page the reader asked for cannot be
  shown, and an editor with unsaved changes still gets the browser's own "leave this page?" question.
- A browser that cached the HTML answer under an old chunk name keeps it for a year. After a Pages
  *rollback* to a release that has that name, that browser can fail on it until its next reload; the
  friendly screen's **Reload the page** button covers that.
