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

## Checkpoint 5: authorization and marker fixes

- **Command search admin links:** `AdminPageService` gives each admin page the policy ability
  its own controller checks (`update`, `members`, `roles`, `webhooks`, `logs`, `setting`,
  `recover`, `gallery`, `stats`), and lists a page only when the viewer passes it. Players no
  longer see links to settings, roles, webhooks, the change log, modules, recovery or styles.
  The routes themselves already refused players (403); that is now covered by a test.
- **Stats and achievements are admin-only.** Both pages count every entity, hidden ones
  included, and cache one result for all viewers, so a player could see how much hidden
  content exists. `CampaignPolicy::stats` now requires a campaign admin. The controllers check
  it, and the sidebar links and both search page lists hide the pages from everyone else.
- **Marker create page:** the standalone page now draws the map (`maps._setup`) and loads
  the layers-tree script. A click on the map fills the latitude and longitude fields and drops
  a pin. `map-v3.js` no longer assumes a map exists (dialogs have none).
- **Summernote font "404":** not a bug. Firefox reported status 2152398850
  (NS_BINDING_ABORTED), meaning the font download was cancelled when the page navigated
  away. The font file is served with status 200.
- **Tests:** `tests/Feature/Privacy/CommandSearchPagesTest.php` (4 tests): the admin's list,
  the player's list, the player refused on 9 admin routes, and the admin opening stats.
- **Firefox:**
  - `fix1.mjs` 3/3: map click fills the coordinates; no 404s on editor pages.
  - `fix1b.mjs` 7/7: the player sees no stats link and gets 403 on stats, with no admin pages
    in the command search; the DM sees all of them.
- **Full Pest suite:** 1298 passed, 15 failed, 7 skipped. The 15 failures are the same known
  baseline set as checkpoint 4; nothing new.

## Checkpoint 6: map privacy

- **Marker preview and details:** both now refuse (404) a marker that the explorer payload
  would drop: one in a hidden group, or one pointing at an entity the viewer can't see. The
  details route also checks the marker belongs to the map in the URL, so a marker on a hidden
  map can't be read through a public map's address.
- **API:** the marker list leaves out markers in hidden groups or pointing at hidden entities,
  and marker show applies the same rule. Marker, layer and group show/update/destroy check the
  record belongs to the map in the URL. Nested routes are not scope-bound, so before this a
  layer or group from a hidden map could be read through any visible map.
- **Web layer and group edit/update/destroy:** same map check (404).
- **Tests:** `tests/Feature/Privacy/MapPrivacyTest.php` (7 tests). The tests caught three real
  leaks before the fixes went in: a 200 preview for a marker in a hidden group, the API marker
  list including it, and API layer/group show across maps.
- **Firefox:** `maps.mjs` 31/31 and `core.mjs` all pass after sync.
- **Mobile sweep:** `mobile.mjs` covers 20 pages as DM and player at 375×812, 820×1180 and
  1180×820, with no horizontal overflow anywhere. The one failure was full-text search
  (500 with Meilisearch absent), fixed in checkpoint 7.
- **Full Pest suite:** 1305 passed, 15 failed, 7 skipped. Same known baseline set.

## Checkpoint 7: full-text search without Meilisearch

- **The bug:** full-text search (`/search/fulltext`, `/search?q=`, the API, and the command
  center's full-text mode) talked to Meilisearch directly. Chronicle runs with
  `SCOUT_DRIVER=null` and no Meilisearch, so the page returned 500 here, and would on Big Bertha
  too.
- **The fix:** `EntitySearchService` uses Meilisearch only when Scout is set to it. Otherwise,
  or when Meilisearch can't be reached (the error is reported, not shown), it searches the
  campaign's entity names and entries in the database. That is the same text the index holds.
  Results still load through the permission-scoped models, so hidden entities stay out. The
  command center gets a short excerpt with the match marked. The page's exact-name lookup is
  now limited to the current campaign.
- **Tests:** `tests/Feature/Privacy/FullTextSearchTest.php` (5 tests): the DM finds both
  entities; the player gets only the public one from the page, the command center and the API;
  and an unreachable Meilisearch falls back instead of failing.
- **Firefox mobile sweep:** 112/112 pass, with the full-text pages working for the DM and the
  player.
- **Full Pest suite:** 1310 passed, 15 failed, 7 skipped. Same known baseline set.

## Checkpoint 8: nested record privacy

- **The leak:** nested routes (`/entities/{entity}/posts/{post}`, `…/relations/{relation}`,
  `…/inventory/{inventory}`, `…/attributes/{attribute}`, and their web counterparts such as
  inventory details and post logs) bind each model by its own id. The controllers authorize the
  entity in the URL and then return the child without checking that it belongs to that entity.
  A player could read a hidden entity's posts, relations, inventory and attributes through any
  entity they can see. A new test reproduced it (200 before the fix).
- **The fix:** `App\Http\Middleware\EnsureNestedBindings`, in the `web` and `api` groups right
  after route binding. For each pair of neighbouring bound models it requires the child's
  `<parent>_id` column (campaign_id, entity_id, map_id, …) to point at that parent, and answers
  404 otherwise. Overrides: a relation belongs to its `owner_id`; a marker's `entity_id` is the
  entity it links to, so that pair is left to the map checks. Children without such a column
  are skipped.
- **Route audit:** all 68 parent→child model pairs in the route table were listed with the
  column the check uses. Pairs with no column (for example a campaign's posts, presets and
  timeline elements) stay on the controllers' own checks.
- **Tests:** `tests/Feature/Privacy/NestedBindingPrivacyTest.php` (3 tests): children still
  load through their own parent; a hidden entity's children are refused through a visible
  entity's API and web URLs; another campaign's records are refused for the player and the
  admin. Two upstream tests that expected 403 for another campaign's import now expect 404.
- **Firefox:** core pages, maps 31/31, graph 19/19 and the earlier fix checks all pass, with no
  page errors or 5xx responses.
- **Full Pest suite:** 1313 passed, 15 failed, 7 skipped. Same known baseline set.

## Checkpoint 9: editing warning, post templates, bulk actions

- **Every ancestor, not just the neighbour:** `EnsureNestedBindings` now checks each bound model
  against every model before it in the URL. `/{campaign}/preset_types/{type}/presets/{preset}`
  therefore keeps the preset in the campaign even though the preset type sits between them.
- **Editing warning:** `campaign.editing-warning` took any model name and id (`App\Models\` +
  the `model` parameter) and showed who was editing it, with no permission check. It now
  accepts only Entity, Post, TimelineElement and QuestElement, answers 404 for a record outside
  the campaign, and requires edit rights on the record (post permissions for a post). The view
  also had an upstream bug that sent `TimelineElement` for quest elements, and it warned about
  module models (Character, …) by the module's id rather than the entity's. Both are fixed.
- **Post templates:** `posts.template` toggled the template flag on any post id. It now refuses
  posts from another campaign.
- **Bulk actions:** the bulk delete, patch and edit of map markers, layers and groups, calendar
  events, organisation members and timeline eras looked ids up across the whole table. Anyone
  who could edit one map could delete the markers of a hidden map, or of another campaign. The
  lookup in `BulkControllerTrait::bulkProcess` is now scoped to the parent in the URL.
- **Tests:** four new tests in `NestedBindingPrivacyTest` (editing warning as DM and player,
  post template, cross-campaign preset), and `tests/Feature/Privacy/BulkPrivacyTest.php` (bulk
  delete and patch through another map's URL). The bulk tests and the template test fail
  without their fixes. The existing bulk tests (37 together) pass.
- **Firefox:** core 22/22, maps 31/31, graph 19/19, plus the earlier fix and editing-warning
  checks, with no page errors or 5xx responses. Two core checks assumed the newest test
  character would be on the first page of the list and search results. Repeated runs had
  pushed it to page 2, so those checks were made run-specific; the app was not at fault.
- **Full Pest suite:** 1319 passed, 15 failed, 7 skipped. Same known baseline set.
