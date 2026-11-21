# Chronicle: feature inventory (2026-11-17)

Status: this describes what exists in the code on the development branch `claude/chronicle-website-features` and the migrations written so far. **Nothing here is deployed to production.** Migrations from `20261117000100` onward are not applied to the hosted project and await owner approval (see `MIGRATIONS-2026-11-17.md`).

Sources: `chronicle-cloud/src/App.tsx` (routes), `src/components/Layout.tsx` (menu), `src/components/CommandPalette.tsx` (palette entries), `chronicle-cloud/tests/e2e` (browser tests), `chronicle-cloud/tests/db` (database tests), `chronicle-cloud/functions` (server functions).

"Who" uses the following shorthand: **Visitor** (not signed in), **Player**, **DM**, **Assistant** (OAuth or MCP connection; assistants are refused by the database on all the new tables, see `SECURITY-MODEL.md`).

## Reading the wiki

| Feature | Route | Who | What it does | Tests |
|---|---|---|---|---|
| Main page | `/` | Player, DM | Home page, with panels for the campaign. | `e2e/home-empty.spec.ts`, `e2e/player.spec.ts` |
| Article page | `/wiki/:slug` | Player, DM | Shows one page. Character, session and encyclopedia views, with picture viewer, status ribbons, family and faction views. | `e2e/player.spec.ts`, `e2e/characters.spec.ts`, `e2e/lightbox.spec.ts`, `e2e/status-ribbons.spec.ts`, `e2e/org-chart.spec.ts` |
| Browse by type | `/browse/:type` | Player, DM | Lists pages of one type (characters, locations, factions, quests, sessions, lore, dossiers). | `e2e/navigation.spec.ts`, `e2e/player.spec.ts` |
| Categories | `/categories`, `/category/:slug` | Player, DM | Lists categories and the pages in each. | `e2e/player.spec.ts`, `e2e/layout.spec.ts` |
| Timeline | `/timeline` | Player, DM | In-world timeline of events, from published, visible entries. | `e2e/player.spec.ts`, `e2e/layout.spec.ts` |
| Connections | `/connections` | Player, DM | Lists the connections between pages. | `e2e/player.spec.ts`, `e2e/layout.spec.ts` |
| Maps | `/maps`, `/maps/:slug` | Player, DM | Maps with markers and fog of war; drill-down to linked pages. | `e2e/map-fog.spec.ts`, `e2e/map-drilldown.spec.ts`, `e2e/location-chips.spec.ts`, `db/map-fog.test.ts` |
| Goblin Gazette (news) | `/news`, `/news/archive`, `/news/:slug` | Player, DM | Published in-world newspaper issues and archive. | `e2e/gazette.spec.ts`, `db/gazette.test.ts`, `db/gazette-review-integrity.test.ts` |
| Family tree | `/family/:slug` | Player, DM | Family tree from parent, spouse and sibling connections. | `e2e/family-tree.spec.ts` |
| Infobox facts | `/facts?label=…&value=…` | Player, DM | Lists pages that share one infobox field value. | `e2e/facts.spec.ts` |
| Recently updated | `/recent` | Player, DM | Recent section-level edits that the reader may see. | `e2e/recent.spec.ts` |
| A–Z index | `/a-z` | Player, DM | Alphabetical index of visible pages. | `e2e/az-index.spec.ts` |
| Wander | `/wander` | Player, DM | Opens a random visible page. | `e2e/wander.spec.ts` |
| Picture viewer | on article pages | Player, DM | Full-screen viewer over the visible pictures on a page. | `e2e/lightbox.spec.ts`, `e2e/images.spec.ts`, `e2e/photos.spec.ts` |

## Navigation and search

| Feature | Route | Who | What it does | Tests |
|---|---|---|---|---|
| Search | `/search` | Player, DM | Full search with operators `type:`, `category:`, `"exact phrase"` and `-exclude`. | `e2e/search-operators.spec.ts`, `e2e/player.spec.ts` |
| Search box and suggestions | header and sidebar | Player, DM | Suggests pages as you type; matches the start of any word (migration `20261114000200`). | `e2e/player.spec.ts`, `e2e/palette.spec.ts`, `db/hardening.test.ts` |
| Command palette | Ctrl/Cmd+K or `/` | Player, DM | Jump to pages and parts of the site. DM entries are hidden from players. | `e2e/palette.spec.ts` |
| Menu | sidebar | Player, DM | Grouped links to every section. DM group shown to DMs only. | `e2e/navigation.spec.ts`, `e2e/layout.spec.ts` |
| Knowledge graph | `/graph` | Player, DM | Global and local graph of pages and links, with search, filters, list view and keyboard support. Built only from pages the reader received. | `e2e/graph.spec.ts`, `e2e/org-chart.spec.ts` |
| Reading comfort | header | Player, DM | Larger text, or larger text with a plain font, remembered per browser. | no dedicated test found |

## Player tools

| Feature | Route | Who | What it does | Tests |
|---|---|---|---|---|
| Saved pages | `/saved` | Player (and DM for their own) | Save toggle on pages; reading lists (create, rename, delete, reorder, move). Only the owner reads. | `e2e/saved.spec.ts`, `db/reader-notes.test.ts` |
| Recently viewed | `/saved` (section) | Player, DM | The last pages opened, kept in this browser only (`localStorage`). | `e2e/saved.spec.ts` |
| My scratchpad | `/scratchpad` and a panel on each page | Player, DM | Private note per page and a general one. Only the writer reads it. | `e2e/saved.spec.ts`, `db/reader-notes.test.ts` |
| Journal (Character Journal) | `/journal` | Player, DM | Dated entries with tags (Theory, Goal, Suspicion, Question, Note), linked pages, search and a timeline. | `e2e/journal.spec.ts`, `db/reader-notes.test.ts` |
| Investigation board | `/board` | Player, DM | Shared party board: pins, notes, theories, connections, sections, marks, list view on phones, activity, save as image. | `e2e/board.spec.ts`, `db/mystery-board.test.ts`, `src/lib/boardLogic.test.ts` |
| Mysteries | `/mysteries` | Player, DM | Mysteries the reader has found clues in; found and unfound clues. | `e2e/mysteries.spec.ts`, `db/mystery-board.test.ts`, `src/lib/clues.test.ts` |
| Clue discovery | clue dialog on pages and maps | Player | "Something catches your eye…", opening a clue records the find; pin to the board. | `e2e/mysteries.spec.ts` |
| Knowledge Studio | `/studio`, `/studio/:id` | Player (and DM for own private collections) | Private research collections with sources, annotations, excerpts and summaries. A player may share a collection read-only with the party; the DM's collections cannot be shared. No AI is used. | `e2e/studio.spec.ts`, `db/research.test.ts`, `src/lib/researchExport.test.ts` |
| Feedback for the DM | `/feedback` | Player | Named or anonymous feedback to the DM, with a reply shown for named feedback. | `e2e/feedback.spec.ts`, `db/feedback.test.ts` |
| Join with an invitation | `/join` | Player (new) | Personal invitation link: no email or password. Shared-device switching and per-device sign-out. | `e2e/invitations.spec.ts`, `db/invitations.test.ts`, `functions/_lib/join.test.ts`, `src/lib/accounts.test.ts` |
| Access screen | any page when signed out | Visitor | Invitation link, access code, or continue on a shared device. | `e2e/invitations.spec.ts`, `e2e/player.spec.ts` |

## DM tools

| Feature | Route | Who | What it does | Tests |
|---|---|---|---|---|
| DM desk | `/dm` | DM | Overview of the wiki (counts, drafts, private pages) and a Mysteries panel showing scheduled releases. | `e2e/dm.spec.ts`, `e2e/dm-visibility.spec.ts` |
| New article and editor | `/dm/new`, `/dm/edit/:slug` | DM | Creates and edits pages, with visibility, status, revisions, relations, categories and private notes. | `e2e/dm.spec.ts`, `db/save-article.test.ts`, `db/audit.test.ts` |
| Maps editor | `/dm/maps/new`, `/dm/maps/:slug` | DM | Maps, markers and fog. | `e2e/map-fog.spec.ts`, `e2e/failures.spec.ts` (no test names the editor route directly) |
| Timeline editor | `/dm/timeline` | DM | Timeline events. | no dedicated test found (`e2e/layout.spec.ts` and `e2e/unsaved-work.spec.ts` mention the timeline) |
| News desk and editor | `/dm/news`, `/dm/news/new`, `/dm/news/edit/:slug` | DM | Gazette stories: drafts, review, approval and printing. | `e2e/gazette.spec.ts`, `e2e/assistant-drafts.spec.ts`, `db/news-proposals.test.ts` |
| Assistant change review | `/dm/review/:previewId` | DM | Approve or reject a change set proposed by an assistant. | `db/mcp.test.ts`, `e2e/dm.spec.ts`, `e2e/characters.spec.ts`, `db/change-sets.test.ts` |
| Assistant connections | `/dm/connect` | DM | Consent screen for connecting an assistant (OAuth). | `e2e/characters.spec.ts`, `e2e/mcp-oauth.spec.ts` |
| Lore import | `/dm/import`, `/dm/import/batches`, `/dm/import/:batchId` | DM | Staged import of a lore collection, with review before anything is saved. | `e2e/import.spec.ts`, `e2e/lore-import.spec.ts`, `db/import-batches.test.ts`, `db/importer.test.ts`, `db/lore-pack.test.ts` |
| Media library | `/dm/media` | DM | Pictures and photo library, with credits and usage. | `e2e/images.spec.ts`, `e2e/photos.spec.ts`, `db/photo-library.test.ts`, `db/photo-integrity.test.ts` |
| Wiki tidy-up | `/dm/tidy` | DM | Read-only report: broken links, unlinked pages, missing summaries and pictures, empty pages. | `e2e/wiki-tidy.spec.ts` |
| What players can see | `/dm/visibility` | DM | Visibility totals and leak detection. | `e2e/dm-visibility.spec.ts`, `db/reference-leak-sweep.test.ts` |
| Private notes | `/dm/notes` | DM | Private DM notes. | `e2e/dm.spec.ts`, `e2e/unsaved-work.spec.ts` |
| Dossiers | `/browse/dossier` | DM (menu entry) | Browse list of dossier pages. | `e2e/player.spec.ts`, `e2e/wander.spec.ts` (mentions only; no dedicated test found) |
| Mystery Studio | `/dm/mysteries` | DM | Mysteries (working and player titles, statuses), clues (kinds, attachments, prerequisites, release now, scheduled, withdraw), hints, preview as a player, discoveries. | `e2e/mysteries.spec.ts`, `db/mystery-board.test.ts` |
| Party theories | `/dm/theories` | DM | Read-only list of theory cards on the board, with status, section and connections. | `e2e/board.spec.ts` |
| Player journals | `/dm/journals` | DM | Read-only view of every player's Character Journal entries. | `e2e/journal.spec.ts`, `db/reader-notes.test.ts` |
| Player insights | `/dm/insights` | DM | Read-only summary built from Character Journals and board theories: goals, questions, suspicions, theories, most-discussed pages, journal activity. | `e2e/insights.spec.ts`, `src/lib/insights.test.ts` |
| Player feedback inbox | `/dm/feedback` | DM | Triage of feedback: boundaries first, filters, status, priority, private note, replies to named feedback, delete. | `e2e/feedback.spec.ts`, `db/feedback.test.ts` |
| Player access | `/dm/access` | DM | Invitation links (create, new link, cancel, device link, sign out a device, remove a player), access codes, members. | `e2e/invitations.spec.ts`, `e2e/dm.spec.ts`, `db/invitations.test.ts`, `db/enroll-integration.test.ts`, `functions/_lib/enroll.test.ts` |
| Wiki settings | `/dm/settings` | DM | Wiki title and settings, two-step sign-in set up, and the maintenance switch. | `e2e/z-mfa.spec.ts`, `e2e/maintenance.spec.ts`, `e2e/photos.spec.ts` |

## Access and security

| Feature | Where | Who | What it does | Tests |
|---|---|---|---|---|
| Access codes | `/dm/access`, sign-in screen | Visitor, Player | Codes stored only as a hash; each device that enters a code becomes its own player; rotating revokes older codes. | `db/enroll-integration.test.ts`, `functions/_lib/enroll.test.ts`, `e2e/dm.spec.ts` |
| Personal invitations | `/dm/access`, `/join` | DM, Player | One link per player; single use; expiring; first link creates the player; device links add devices to the same account. | `db/invitations.test.ts`, `e2e/invitations.spec.ts`, `functions/_lib/join.test.ts` |
| Devices and sign-out | `/dm/access` | DM, Player | Each invited device is recorded; the DM can sign out one device; a revoked device loses membership at once in the database. | `db/invitations.test.ts`, `e2e/invitations.spec.ts` |
| Two-step sign-in (MFA) | `/sign-in`, `/dm/settings` | DM | TOTP enrolment and sign-in step. Membership and DM checks require `aal2` when MFA is enrolled. | `e2e/z-mfa.spec.ts`, `e2e/mcp-oauth.spec.ts`, `e2e/z-mfa.spec.ts` |
| Row Level Security | database | everyone | Policies on every table; the DM role checked in the database, not only in the website. | `db/privacy.test.ts`, `db/privileges.test.ts`, `db/reference-leak-sweep.test.ts`, `db/hardening.test.ts`, `db/oauth-boundary.test.ts`, `db/oauth-write-boundary.test.ts`, `db/location-privacy.test.ts` |
| Assistant (OAuth/MCP) boundary | database and `/dm/connect` | Assistant | Assistants are refused on the tables added since `20261117000100`. Earlier assistant writes go through reviewed change sets (see the db tests listed). | `db/mcp.test.ts`, `db/mcp-campaign.test.ts`, `db/mcp-public-content.test.ts`, `db/oauth-write-boundary.test.ts`, `e2e/mcp-oauth.spec.ts` |
| Audit | database | DM | Revision and audit history. | `db/audit.test.ts` |

## Maintenance

| Feature | Where | Who | What it does | Tests |
|---|---|---|---|---|
| Visitor maintenance notice | `/api/status` (Pages function `functions/api/status.ts`) | Visitor | Shows the agreed maintenance text when `MAINTENANCE_MODE=on` is set in Pages (the everyday switch is the DM's, in Wiki settings). Off by default. | `functions/_lib/status.test.ts`, `functions/_lib/notice-text.test.ts`, `e2e/maintenance.spec.ts` |
| DM maintenance switch | `/dm/settings` (component `MaintenanceSwitch`) | DM | Turns the notice on for 1 to 480 minutes, or off (0). Always expires. | `db/maintenance-switch.test.ts`, `e2e/maintenance.spec.ts` |

## Not in the product

- The 50-item roadmap (`ROADMAP-50.md`) is ideas only; only the items named in the status section of that file, and in this inventory, exist.
- Knowledge Studio has no AI; any future AI feature would need its own review.
- No automatic publishing, background release jobs or live-session control.

## Requested in the 2026-11-17 brief: status

The numbered brief (items 1 to 150, with the ranges below) is not in this repository, in `docs/chronicle/`, or in the git history of this branch that I searched, and I was not given its text. **Per-item statuses cannot be assigned without it.** Rather than guess, the table below gives the evidence that each range's feature area exists in the code. It does not say how many items in a range are complete.

| Range in the brief | Feature area | Evidence in code (development branch, not deployed) |
|---|---|---|
| 1 to 12, invitations | Personal invitations, devices | Migration `20261117000500`; `/join`; `/dm/access` invitations panel; `functions/api/join.ts`; `db/invitations.test.ts`; `e2e/invitations.spec.ts`. Code present. |
| 13 to 20, journals | Character Journals | Migration `20261117000100`; `/journal`; `/dm/journals`; `e2e/journal.spec.ts`. Code present. |
| DM insights (no range given) | Player insights | `/dm/insights`, `src/pages/dm/PlayerInsights.tsx`, `src/lib/insights.ts`, `e2e/insights.spec.ts`. Code present. |
| 21 to 40, board | Investigation board | Migration `20261117000300`; `/board`; `/dm/theories`; `e2e/board.spec.ts`; `db/mystery-board.test.ts`. Code present. |
| 41 to 60, Mystery Studio | Mysteries and clues | Migration `20261117000200`; `/mysteries`; `/dm/mysteries`; `e2e/mysteries.spec.ts`; `db/mystery-board.test.ts`. Code present. |
| 61 to 69, feedback | Feedback Center | Migration `20261117000400`; `/feedback`; `/dm/feedback`; `e2e/feedback.spec.ts`; `db/feedback.test.ts`. Code present. |
| 70 to 85, Knowledge Studio | Research collections | Migration `20261117000600`; `/studio`; `e2e/studio.spec.ts`; `db/research.test.ts`. Code present. |
| 86 to 110, encyclopedia | Browse, A–Z, categories, facts, family, wander, timeline, connections, search | Routes listed under "Reading the wiki" and "Navigation and search". Code present for each route; no per-item mapping. |
| 111 to 125, graph | Knowledge graph | `/graph`, `src/pages/GraphPage.tsx`, `e2e/graph.spec.ts`. Code present. |
| 126 to 140, DM management | DM desk, access, settings, tidy, visibility, media, import | Routes listed under "DM tools". Code present for each route; no per-item mapping. |
| 141 to 150, maintenance | Maintenance notice and DM switch | Migration `20261117000700`; `functions/api/status.ts`; `/dm/settings`; `db/maintenance-switch.test.ts`; `e2e/maintenance.spec.ts`. Code present. |

To complete this checklist, the brief's numbered items (with their text) need to be supplied. Each one can then be marked Completed, Partial or Not started by reading the matching code.
