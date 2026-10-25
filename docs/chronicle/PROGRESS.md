# Chronicle local MVP — progress log

Branch `chronicle/local-mvp`, from `chronicle/main` (`02d2aef95`). Local commits only; nothing pushed.
All test data is synthetic. Baseline: `run.sh pest` gives 1281 passed / 15 failed / 7 skipped. All 15
failures are known: 14 upstream, plus MarkdownExport, which fails only on a CRLF checkout.

## Checkpoint 1 — the app runs and the core flows work

- **Dev stack.** `deploy/dev/local.sh` runs the app on 127.0.0.1:8090 with a seeded synthetic
  campaign and DM and player accounts (see `deploy/dev/README.md`).
- **Fixed: header search returned 500.** The command search linked the marketplace plugin pages,
  whose routes Chronicle doesn't load. `AdminPageService` now skips them.
  Test: `tests/Feature/Search/CommandSearchTest.php`.
- **Fixed: uploaded images (maps, portraits) never loaded on the built-in server.** For an
  existing file, PHP's built-in server sets `SCRIPT_NAME` to that file. Laravel then took the
  upload URL as its base URL and routed the request to `/`. `server.php` now forces `index.php`
  as the script. Test: `StorageAuthorizationTest` ("keeps the app base URL …").
- **Firefox run (puppeteer-core + system Firefox): 22/22 checks passed, with no page errors and
  no 5xx.**
  - Account flows: login with a remembered session, the dashboard, campaign creation.
  - Content: a character, an NPC and a location; a relationship; live search and header search.
  - Maps: image upload; the explorer renders the image; markers are created, drawn and keep
    their position.
  - Graphs: the relations web and the entity connection map.
  - Layouts: phone, tablet and landscape.
  - Logout, then the remembered session.
  - As the player: the private character is hidden; create and edit give 403; the graph does
    not leak; the map image loads; the public marker is shown and the DM-only marker is hidden.
- **Pest:** 1283 passed / 15 failed / 7 skipped. The failure set is the same as the baseline's,
  and the two new tests pass.

Known but not fixed. These are upstream or cosmetic, so they are out of scope for now:
- The standalone marker create page throws "window.map is undefined", and it loads Leaflet from
  unpkg. The explorer's own marker tools work.
- The summernote woff2 font returns 404.
- The login background comes from `th.kanka.io`.
- Players see admin page links in the command search. To check: whether those pages refuse
  players.

## Checkpoint 2 — floating relationship graph (in progress)
