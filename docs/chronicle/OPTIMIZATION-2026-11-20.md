# Chronicle optimization audit, 2026-11-20

Branch `claude/chronicle-optimization`, from production `7e103ae3c` (`claude/chronicle-release-ready`).
Nothing here is deployed and no database migration was needed. Everything was measured locally on
the disposable stack; production was only read.

## What runs in production

- **Website:** a React and Vite single-page app on Cloudflare Pages. Static assets are free and
  unlimited, and served as `immutable`.
- **Pages Functions:** run only for `/api/*` (`_routes.json`): `status`, `enroll`, `join` and
  `dm-gate`.
- **Supabase:** Postgres with Row Level Security, Auth, and Storage. The browser calls the Data
  API directly with the reader's own token. Realtime is not used.
- **`chronicle-mcp` Worker:** separate, last deployed 2026-11-11. It logs every request.
- **`chronicle-wiki` Workers project:** a dashboard-only project. It serves nothing, and it is the
  source of the failing "Workers Builds" check.
- **Hosted data (read 2026-11-20):** an 18 MB database. Largest table `change_previews` at
  1.2 MB, which already has a 30-day cleanup. 0 Storage objects. 37 player-visible and 12 DM-only
  lore pages, 3 Gazette stories, 54 DM notes.

## How it was measured

`PERF_LABEL=<name> bash scripts/e2e-local.sh --config playwright.perf.config.ts`
(`tests/perf/measure.perf.ts`) records the following for each page:
- every Supabase API request, with its bytes and any exact duplicates;
- assets transferred, by type;
- cold-load time to the main content and the Largest Contentful Paint.

Two device profiles were used:
- **Desktop:** fast network, no throttling.
- **Android-like:** 412×915 viewport, CPU 4x slower, "Slow 4G" (150 ms latency, 1.6 Mbit/s down).

Two data sets were used:
- **Sample:** the synthetic seed, 26 pages.
- **Scale:** the seed plus 950 synthetic pages, 3,240 sections, 2,405 relations and 150 Gazette
  stories.

API bytes are the local gateway's JSON response bytes. The local gateway's compression was not
confirmed, so treat these as raw sizes; hosted transfer may be smaller. Fast-profile timings vary
by about 50 ms between runs and are not claimed as changes.

## Findings, by priority

| # | Pri | Finding | Fix |
|---|---|---|---|
| 1 | P1 bug | Character pages rendered **two identical "Save this page" buttons**, and each made its own bookmark, list and pin requests. | Removed the duplicate. |
| 2 | P2 | `api.ts` imported one helper from `loreImport.ts`, which put the whole DM lore importer (~28 KB raw) into **every visitor's first download**. | Type-only import. |
| 3 | P2 | At every visit the membership check and the device check ran one after the other. | Run together. `touch_device` only reads the caller's own device row and is safe for every role. |
| 4 | P2 | The layout and the home page each requested settings and current location at the same moment. | One shared in-flight request. It is not kept afterwards, and it is cleared when the signed-in person changes. |
| 5 | P2/P3 | Home downloaded **every** Gazette story (all columns) and **every** session journal to show one headline and one session. | Asks for the latest dated session (1 row) and the 30 newest printed player stories, with the same choice rules. |
| 6 | P2/P3 | The Knowledge Graph downloaded every relation id and every section id only to map links to pages. | Relation ids are no longer downloaded. Links embed their section's page id, under the sections' own RLS. |
| 7 | P3 | The Save button downloaded up to 1,000 bookmarks to show list names. | Asks for the list names only. |
| 8 | P3 | Character pages listed every session journal even with none or one to order. | Only when there are two or more. |
| 9 | P3 | Every open tab polled `/api/status` (a Pages Function call) and an RPC every 2 minutes, **even while hidden**. | Skipped while the tab is hidden; runs again when it becomes visible. |
| 10 | P4 | `api.search()` had been dead since search operators replaced it. `src/lib/home.ts` was replaced by the query. | Removed. |
| 11 | Security | MCP Worker logs kept full request URLs, including query strings. | `redact_query_string: true`. Takes effect on the Worker's next deploy. |
| 12 | P3 | The Gazette front page laid out **every** story ever printed. The archive downloaded full stories to list titles. | The front page shows the newest 40 printed stories, with a link to the archive (a small visible change). The archive fetches only the fields it lists. The DM's newsroom strip reads only unprinted stories. |
| 13 | P3 | Recently updated downloaded each page's summary, which it never shows, for every page edited in the last 400 section edits. | No summaries. Pages are looked up only for the 200 entries the page can show. |

### Checked and found sound

- **Markdown:** no raw HTML is rendered. URLs go through react-markdown's sanitizer, and only the
  internal `media:` scheme passes.
- **Secrets:** no secret key, token or passcode in tracked files. The production bundle contains no
  secret key and no passcode.
- **Caching:** `/api/*` is `no-store`, `index.html` is `no-cache`, and hashed assets are
  `immutable`. Per-person browser storage is keyed by user id. Signed image URLs and the shared
  settings request are cleared whenever the person changes.
- **Indexes:** every foreign key has a supporting index.
- **Dead code:** knip found no unused files and no unused runtime dependencies (`wrangler` is used
  through `npx`). The remaining "unused exports" are constants used by tests, or pages loaded by
  name at runtime.
- **MCP Worker:** it caches the token-signing keys for 10 minutes and writes no routine logs.
- **Hosted CORS:** preflights are cacheable for an hour (`access-control-max-age: 3600`).

## Measurements

Each value is shown as before → after.

### Sample data (26 pages)

| Page | Data API requests | Duplicates | API data |
|---|---|---|---|
| Character page (player) | 26 → 20 | 8 → 0 | 24.8 → 19.8 KB |
| Home (player) | 16 → 14 | 4 → 0 | 29.3 → 27.1 KB |
| Graph (player) | 11 → 10 | 0 → 0 | 15.1 → 11.5 KB |
| Home → character page (warm) | 36 → 28 | 11 → 0 | 49.8 → 42.6 KB |

### Scale data (976 pages)

| Page | API data |
|---|---|
| Home (player) | 155.3 → 46.7 KB (−70%) |
| Home (DM) | 182.2 → 50.9 KB (−72%) |
| Character page (player) | 60.1 → 19.8 KB (−67%) |
| Graph (player) | 439.2 → 176.1 KB (−60%) |
| Graph (DM) | 1,162 → 521 KB (−55%) |
| Home → character page (warm) | 211.1 → 62.1 KB (−71%) |
| Gazette front page (player, 150 stories) | 99.8 → 36.2 KB (−64%) |
| Recently updated (player) | 128.0 → 102.5 KB (−20%) |

### Android-like cold load (sample data)

| Page | Main content visible | Largest paint |
|---|---|---|
| Home | 2,581 → 2,092 ms (−19%) | 3,528 → 3,320 ms |
| Character page | 2,594 → 2,096 ms (−19%) | 2,972 → 2,744 ms |

The scale data gave the same picture: home 2,581 → 2,135 ms, character page 2,584 → 2,078 ms.

### JavaScript (production build)

| Chunk | Before | After |
|---|---|---|
| Entry chunk (`index`) | 207.7 KB / 62.9 KB gz | 179.2 KB / 53.2 KB gz (−15% gz) |
| React chunk | 100.7 KB gz | unchanged |
| Supabase chunk | 58.6 KB gz | unchanged |
| First-load JS total (gz) | 222.1 KB | 212.4 KB |

### Requests that went up

The DM makes one extra small RPC per visit (`touch_device` now starts for every role):
- DM desk: 8 → 9 requests;
- editor: 16 → 17 requests;
- search: 7 → 8 requests.

## Free-tier capacity

Limits, checked 2026-11-20:
- **Supabase Free:** 500 MB database per project, 1 GB file storage, 5 GB egress per organization
  (plus 5 GB cached egress), 50,000 monthly active users. Projects pause after a week of
  inactivity.
- **Cloudflare Workers Free:** 100,000 requests a day, with Pages Functions counted in that total,
  and 10 ms CPU per request. Static assets are free and unlimited.
- **Workers Logs from 1 Dec 2026:** 0.5 GB of ingestion a day with 7-day retention. When the
  allowance is used up, ingestion stops; there is no charge.

Estimates. Each states its assumption, and none is a measured production figure.

- **Database (500 MB).**
  - The scale data added about 12 MB for 950 pages including indexes and search vectors: about
    12.5 KB per page with four ~1.2 KB sections.
  - The production revision table averages about 5.6 KB per saved version.
  - With no revision growth: about 38,000 pages fit.
  - If every page is saved 20 times over its life: about 125 KB per page, so about 3,800 pages.
  - Revisions are the main storage risk; see the recommendations.
- **Egress (5 GB a month).**
  - A page view now moves about 20–50 KB of JSON (character page 20 KB, home 47 KB at scale),
    plus about 3 KB of start-up calls.
  - At 40 KB per view that is about 125,000 page views a month (about 4,000 a day), before
    images.
  - Pictures count toward egress at their full size each time a browser fetches a new signed
    URL.
- **Pages Functions (100,000 a day).**
  - A visit costs 1 `/api/status` call, plus 1 `/api/dm-gate` call for the DM.
  - A visible tab costs 1 more call every 2 minutes.
  - A 30-minute session is about 16 calls, so about 6,000 sessions a day fit. Hidden tabs no
    longer count.
- **Auth (50,000 monthly active users):** not a constraint for one campaign.
- **Campaigns:** the schema holds one campaign per Supabase project. A second campaign needs a
  second free project, and the free plan allows two.
- **Media (1 GB Storage):** at about 300 KB per WebP picture (the editor resizes in the browser),
  about 3,000 pictures.

## Not done, and why

### Needs your decision

- **Revision retention.**
  - Snapshots are kept forever. A policy such as "keep the last 30 per page, and all those older
    than a year" would bound growth.
  - This deletes history, so it needs your approval and a backup first.

### Worth doing later

- **Recent page:** it still reads the 400 most recently edited sections, for the headings it
  shows (about 100 KB at scale). A server-side summary would need a migration.
- **DM editor:** it loads every page's title to check links (about 130 KB at scale; about 7 KB
  today). The check runs as soon as the editor opens, so loading on demand would not help.
- **Image caching:** signed image URLs rotate every 10 minutes, so a picture is downloaded again
  after that. A longer lifetime saves egress but lengthens the window in which a hidden picture
  stays viewable; this was a deliberate privacy choice.
- **Graph:** one server-side function returning one edge per page pair would shrink the graph
  further. It needs a migration and its own RLS tests.

### Rejected

- **Splitting more routes off the entry chunk:** browse, search and A–Z are common first pages,
  so every visit would pay an extra request. The remaining entry code is mostly pages people open
  first.
- **Replacing supabase-js with smaller parts** (realtime is unused; about 15 KB gz): auth refresh
  and session handling would move into our own code. The saving does not justify that.
- **Font subsetting:** browsers fetch only the Latin files the page uses. The other subsets cost
  deploy size, not visitors' bandwidth.

## Verification

All on the final code, local stack, PostgreSQL 17.12.

| Check | Result |
|---|---|
| Lint | 0 errors |
| Typecheck | 0 errors |
| Unit tests | 285/285. `home.test.ts` was removed with `home.ts`; its rule is covered by `home-now.spec.ts`. |
| Database tests | 387/387, including the new `graph-links.test.ts` |
| Browser tests, full run | 124 passed, 1 failed |
| Browser test after fix | The one failure was an over-broad assertion in the new `home-now.spec.ts`; after narrowing it, the spec passes on its own (1/1). |
| Production build | OK |
| MCP Worker config | `wrangler deploy --dry-run` OK; nothing uploaded |
