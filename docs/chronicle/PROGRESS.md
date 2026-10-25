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

## Checkpoint 2 — floating relationship graph

- **The button:** a button in the header (top right) opens the relations web in a floating window.
  It shows on every campaign page for anyone who may open the relations web. Guests never see it.
- **The window:** drag it by the title bar and resize it from the corner (minimum 288×192).
  Minimize, maximize, close, or press Escape. Position, size and open state are saved per
  campaign in localStorage.
- **Phones:** below 640px the window becomes a full-width bottom sheet.
- **The graph:** it is the existing Cytoscape web page, embedded (`?embed=1&focus=<entity>`),
  so it keeps its search and filters, and its data comes from the existing API, filtered per
  viewer. It focuses the entity you are on. Opening a node navigates the main page, and the
  window follows the new page.
- **Files:** `layouts/graph-panel.blade.php`, `resources/js/graph-panel.js`,
  `resources/css/graph-panel.css`, plus small changes to `Web.vue`, `connections/web.blade.php`,
  the header and the app layout.
- **Bug fixed:** in the relations web, the search results showed underneath the selection card,
  so they couldn't be clicked (`z-10`).
- **Tests:** `tests/Feature/Privacy/GraphPanelTest.php` covers four cases:
  - the button and the focus;
  - a player who focuses on a hidden entity still gets filtered HTML and JSON (with the DM as a
    control);
  - only a numeric focus is passed;
  - guests get no panel.
- **Firefox:** 19/19 graph checks pass, covering drag, resize, minimize and maximize, saved
  state, the DM control, the player filter, navigation, the phone sheet and the tablet layout.
  Core checks: 22/22.
- **Pest:** 1287 passed / 15 failed / 7 skipped. The failure set is the same as the baseline's.
- **Note:** unboosted campaigns show only the 10 newest relations in the web
  (`limits.campaigns.web`). This is Kanka's own limit, and it is left as it is.

## Checkpoint 3 — map navigation, levels and stairs

- **Breadcrumbs:** the explorer shows the trail of parent maps above the map name
  (Region > Mill > Ground floor). Each crumb opens that map.
- **Maps inside:** a "Maps inside (n)" menu lists a map's child maps.
- **Levels:** maps that share a parent are shown as levels, for floors. A switcher sits
  bottom-left, the current level is highlighted (`aria-current`), and buttons are at least
  36px tall for touch. It hides while a side panel is open.
- **Stairs and child-map markers:** use a normal marker linked to the target map entity. Its
  details panel already offers "Explore <map>" (Kanka's `PinPreviewResource`), so no new
  backend was needed.
- **Data:** `ExploreApiService::navigation()` adds `navigation` (ancestors, children, levels)
  to the map-api payload. Every query goes through the campaign's permission scopes, so a
  player never sees a hidden map in any list. The trail stops at the first parent they can't
  see. Nothing new is stored: nesting is Kanka's existing parent map.
- **Tests:** `tests/Feature/Privacy/MapNavigationTest.php` (4 tests) covers:
  - the full lists for the DM;
  - a player sees no DM-only map names, and the hidden map returns 404;
  - the trail stops at a hidden parent;
  - an isolated map has empty navigation.
- **Firefox:** 31/31 map checks pass, using five synthetic nested maps. They cover:
  - breadcrumbs, levels, the current level, and switching levels;
  - the child-map list;
  - the stairs marker's link to the cellar;
  - marker positions kept after a reload;
  - player filtering (lists, page and API), with the hidden map returning 404;
  - phone (375×812) and tablet (820×1180): no overflow, the controls on screen, zoom
    controls present.
- **Pest:** 1291 passed / 15 failed / 7 skipped. To confirm the 15 failures are the baseline
  set, I re-ran the failing files with these changes stashed: the same 15 fail at HEAD. They
  are:
  - CalendarAdvancer (unexpected failures)
  - EntityAsset (update without upload)
  - MapTest: zoom above limit; real zoom limits
  - ExploreApiController: zoom limits; hidden-focus fallback
  - GroupController (create top-level)
  - MapMarkerPathRender (not boosted)
  - MarkerController (null entry)
  - MarkdownExport (CRLF)
  - ExploreController (tiling redirect)
  - EntityMentionsPolymorphic migration
  - TilingMigrations
  - EntityObserverTiling
  - PinResource (parsed entry)

## Checkpoint 4 — appearance

- **Self-hosted backgrounds:** the login, register, campaign-switcher and sidebar backgrounds,
  and the public campaign thumbnail fallback, no longer load the mountain photo from
  `th.kanka.io`. They use `public/images/chronicle/vale.svg`, a dusk valley drawn for Chronicle.
- **Infobox:** in the Chronicle themes, the profile box beside a character, location or NPC
  page is a wiki-style card: a gold rule under a serif title, and small-caps labels with dotted
  separators. Pins get a gold edge, and the sidebar widens to 15rem on large screens. Grid cards
  get a thin gold rim and serif names.
- **Dashboard overview:** a dashboard without widgets now shows links to every enabled module
  plus the relations web, and the eight most recently updated entries
  (`resources/views/dashboard/chronicle/_overview.blade.php`). The recent list is an ordinary
  `Entity` query, so it goes through the permission scope.
- **Chronicle Night:** a dark theme (`resources/css/themes/chronicle-night.css`) with ink
  pages, ivory text and gold accents. It imports `chronicle.css`, so the infobox and serif
  headings carry over. Pick it under Settings → Appearance.
- **Tests:**
  - `tests/Feature/Privacy/DashboardOverviewTest.php`: the DM's overview lists hidden
    entries, and a player's overview contains no DM-only text;
  - `AppearanceThemeTest` covers `chronicle-night` as well.
- **Firefox (look.mjs):** 40/40 checks pass, on desktop 1280, tablet 820 and phone 375. They
  cover:
  - the login background is local, and `vale.svg` is served;
  - the dashboard, character list and character page load in both themes, with no horizontal
    overflow;
  - the overview shows modules and recent entries;
  - the night theme reports a dark colour scheme;
  - no requests to `kanka.io`, no page errors and no 5xx responses.
- **Pest:** 1294 passed / 15 failed / 7 skipped. The 15 failures are the same tests as at
  checkpoint 3.
- **Still open:**
  - the standalone marker create page throws "window.map undefined";
  - the summernote font returns 404;
  - admin links show in players' command search. Not yet checked whether those routes refuse
    players; to verify next.
