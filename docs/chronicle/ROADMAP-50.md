# Chronicle website roadmap: 50 feature ideas and a design review (2026-11-16)

## Status after 2026-11-17

Status: development branch only; **nothing here is deployed**. The full feature list is in [FEATURE-INVENTORY.md](FEATURE-INVENTORY.md). Of the 50 ideas below, these have code on the development branch, matched to the table's numbers:

- #4 Infobox field browse: `/facts`.
- #5 Status ribbons: built from the existing Status field.
- #8 Recently updated feed: `/recent`, built from section-level timestamps.
- #14 Secret-leak linter (partial): leak detection on `/dm/visibility`; not a linter for player-visible text.
- #32 Personal notes (partial): per-page private scratchpad; no reactions or sharing.
- #33 Clue tracker (partial): Mystery Studio discoveries; not a general known-facts list.
- #40 Accessibility reader mode (partial): reading comfort settings in the header.
- #42 Full-text search operators: `type:`, `category:`, quoted phrases and exclusions on `/search`.
- #45 Stable permalinks and redirects on rename: an old address keeps working after a rename.

For the other ideas in this list (for example #1 to #3, #6, #7, #9 to #13, #15 to #31, #34 to #39, #41, #43, #44, #46 to #50) I found no code on this branch; this is a search result, not a full audit. Ideas that are built beyond this list (player invitations, the Investigation Board, Mystery Studio, Feedback Center, Knowledge Studio, the maintenance switch) are not in the 50 and are described in the inventory.


Boundary: website only; no AI generation/automation/decisions, no live-session control.

These ideas are in addition to the 30 from the first sprint and the features already built (see [WEBSITE-FEATURES.md](WEBSITE-FEATURES.md)). Ideas only: nothing here is implemented unless the implementation status says so. Scores = Value/Feasibility/Visual/Efficiency (1–10).

## Part 1 — Feature ideas

| # | Name | Description | Benefit | Diff | DB changes | Security note | Dependencies/reuse | V/F/Vi/E |
|---|---|---|---|---|---|---|---|---|
| **Encyclopedia browsing** |||||||||
| 1 | "On this day" in-world | Home panel listing events whose in-world date matches the current campaign date. | Daily reason to revisit | S | none (uses timeline dates) | Filter via existing RLS-visible events | Timeline data, HomePage panel | 6/8/6/8 |
| 2 | Article compare view | Side-by-side two articles (e.g., two factions) with infobox fields aligned. | Clarifies rivalries, similar entities | M | none | Both fetched under player RLS | Infobox renderer, ArticleViews | 5/7/7/6 |
| 3 | Glossary / term tooltips | DM-defined terms auto-underlined in prose with short definitions on hover/tap. | Players learn jargon in context | M | small table (terms) | Respect term visibility flag | Markdown renderer, link previews | 7/6/6/7 |
| 4 | Infobox field browse | Click any infobox value (e.g., "Race: Elf") to list all articles sharing it. | Emergent cross-indexing | M | index/view on infobox JSON | Query must stay RLS-scoped | Infobox, BrowsePage | 7/7/5/8 |
| 5 | Article "status" ribbons | Visible states like Deceased, Destroyed, Missing, Rumoured shown on cards/pages. | World state at a glance | S | small column (status enum) | DM-only statuses hidden from players | Badge styles, card component | 8/9/8/9 |
| 6 | Rumour vs. canon marking | Mark sections as rumour/unverified; styled as marginalia scroll. | Encodes in-world uncertainty | S | small column on sections | Visibility unchanged; label only | Section visibility model | 7/8/8/8 |
| 7 | Nearby on map | Location articles list other markers within radius on same map. | Spatial discovery without opening map | M | none (marker coords exist) | Exclude fogged/hidden markers | Leaflet marker data | 6/7/5/7 |
| 8 | Recently updated feed | Public "recent changes" list of player-visible edits, with section-level granularity. | Players see what changed | S | none (revisions exist) | Never expose DM-only diffs | Revisions table | 8/8/5/9 |
| 9 | Quotes collection | Collect memorable in-character quotes into a browsable quote wall per character. | Fun recall, flavor | S | small table (quotes) | Per-quote visibility | Character pages, card grid | 6/8/7/7 |
| 10 | Printable session recap sheet | One-page printable/PDF digest of a session article with linked entities. | Table handout | S | none | Player-visible content only | Print styles | 5/9/5/8 |
| **DM management** |||||||||
| 11 | Article templates manager | DM edits per-type default infobox fields and section scaffolds in settings. | Consistent articles, faster entry | M | small table (templates) | DM-only RLS write | lib/templates.ts | 8/7/4/9 |
| 12 | Draft queue / kanban | Board of drafts by stage (idea, draft, ready, published). | Organized prep pipeline | M | small column (stage) | DM-only route | DM desk, badges | 7/7/6/8 |
| 13 | Visibility presets | Named reveal sets ("Act 2 reveal") toggling many sections at once. | One-click arc reveals | M | small table + join | Atomic update; audit revision | Section visibility, bulk ops | 9/6/4/9 |
| 14 | Secret-leak linter | Warns when player-visible text links to DM-only article or names hidden entity. | Prevents spoilers | M | none | Core spoiler protection | Tidy report, link parser | 9/7/4/8 |
| 15 | Revision diff + restore per section | Visual word diff and restore a single section from history. | Safe editing | M | none | DM-only | Revisions, editor | 7/7/6/7 |
| 16 | Image alt-text audit | List images missing alt text/captions with inline fix. | Accessibility compliance | S | none | DM-only | Media library, tidy | 6/9/3/8 |
| 17 | Storage usage meter | Show media bytes per article/gallery with largest files. | Control storage costs | S | none (storage metadata) | Signed URLs only | Media library | 5/8/4/7 |
| 18 | Article checklist fields | Per-article prep checklist (DM-only) with progress on DM desk. | Prep tracking | S | small JSON column | DM-only RLS | DM desk | 6/8/4/7 |
| 19 | Access-code expiry & scopes | Codes with expiry date and optional read-only scope / usage count. | Safer sharing | M | small columns on codes | Server-enforced expiry in RLS/RPC | AccessAdmin | 8/7/3/8 |
| 20 | Backup snapshot download | One-click JSON+Markdown snapshot of whole wiki for DM. | Disaster recovery | M | none | DM-only; signed storage export | Lore importer format | 8/7/2/8 |
| **Visual features** |||||||||
| 21 | Illuminated drop caps | Optional decorative first letter on article lead paragraph. | Strong fantasy flavor | S | none | none | prose CSS ::first-letter | 5/10/9/9 |
| 22 | Heraldry builder | Simple shield/tincture/charge picker producing SVG crest for factions. | Distinct faction identity | L | small JSON column | Sanitize SVG output | Infobox image slot | 6/4/9/5 |
| 23 | Portrait frames by type | Type-specific ornamental frames on infobox/card portraits. | Instant type recognition | S | none | none | TEMPLATES glyph, CSS | 6/9/9/9 |
| 24 | Map region shading | Polygon regions on maps colored by owning faction with legend. | Political map view | L | small table (regions) | Regions respect fog/visibility | Leaflet, MapEditor | 7/5/9/5 |
| 25 | Story-so-far strip | Horizontal illustrated strip of session cover images in order. | Visual campaign recap | S | none | Visible sessions only | Session articles, gallery | 7/8/9/8 |
| 26 | Wax-seal "sealed" sections | Hidden-from-players reveals animate as broken seal on first view. | Delightful reveals | S | none (client seen-state) | Purely cosmetic; data already gated | Section visibility | 5/8/9/7 |
| 27 | Banner image per article | Optional wide header art above title, with focal point crop. | Richer pages | S | small column | Private storage signed URL | Crop tool | 6/8/9/8 |
| 28 | Party dashboard cards | Grid of PC cards with level/class/status from infobox. | Party at a glance | S | none | Player-visible fields only | Card grid, infobox | 8/8/8/8 |
| 29 | Image hotspots | Clickable labeled regions on any picture linking to articles. | Explorable illustrations | M | small JSON on image | Hide links to hidden articles | Lightbox | 6/6/8/6 |
| 30 | Category cover mosaics | Category pages show mosaic of member portraits. | Browsing feels visual | S | none | Visible members only | Categories, images | 5/9/8/8 |
| **Player experience** |||||||||
| 31 | Player character sheets (light) | Players maintain their own PC page fields (bio, goals) with DM approval. | Player ownership | M | small table (claims) | Write limited to owned article; review | Change review flow | 8/6/5/7 |
| 32 | Personal notes on articles | Private per-player margin notes on any article. | Players remember clues | M | small table (user notes) | RLS owner-only | Notes UI pattern | 9/7/5/8 |
| 33 | Clue tracker / "known facts" | Player marks facts as known/suspected into personal list. | Mystery solving aid | M | small table | Owner-only RLS | Personal notes | 7/6/5/7 |
| 34 | Reactions / "seen it" | Lightweight emoji or "read" markers on gazette and session pages. | DM sees engagement | S | small table | Per-member rate limit | Gazette pages | 6/8/5/8 |
| 35 | Comment threads on sessions | Players discuss session recaps under article (DM moderates). | Between-session engagement | M | small table (comments) | Moderation; markdown sanitized | Markdown renderer | 7/6/5/6 |
| 36 | Character wishlists / goals | Players post goals the DM can see privately. | Better DM planning | S | small table | Player→DM only visibility | Feedback inbox | 7/8/3/8 |
| 37 | Onboarding tour | First-visit guided tour of navigation, search, maps. | New players orient fast | S | none (localStorage) | none | Layout | 6/9/5/9 |
| 38 | Reading progress | Per-article "read" checkmarks and % of wiki explored. | Gentle gamified exploration | S | small table or local | Owner-only | Recently viewed | 6/8/6/8 |
| 39 | Spoiler-safe share links | Share an article to a non-member as time-limited read-only view. | Show friends safely | M | small table (tokens) | Expiring token; player view only | Access codes | 5/6/4/6 |
| 40 | Accessibility reader mode | Toggle dyslexia-friendly font, larger text, reduced ornament. | Inclusive reading | S | none (localStorage) | none | Theme toggle | 7/9/5/9 |
| **Advanced functionality** |||||||||
| 41 | Offline reading (PWA) | Cache visited/selected articles for offline table use. | Works with bad wifi | M | none | Cache only player-visible; clear on sign-out | Vite PWA plugin | 8/6/3/7 |
| 42 | Full-text search operators | type:, category:, "phrase", -exclude syntax in search. | Power-user precision | M | none (tsvector exists) | Server-side, RLS-scoped | Search RPC | 7/7/3/8 |
| 43 | Webhook / Discord post on publish | Post title+link to a Discord channel when content is published. | Players notified | M | small settings column | Secret in edge function only | Supabase edge functions | 7/6/3/8 |
| 44 | Calendar export (iCal) | Export real-world session schedule as .ics feed. | Scheduling convenience | S | small table (sessions dates) | Tokenized feed URL | Session articles | 5/8/2/8 |
| 45 | Stable permalinks & redirects on rename | Auto-redirect old slugs after rename/merge. | No broken links | S | small table (slug history) | none | redirect-note exists | 7/9/2/9 |
| 46 | Open Graph previews | Generic, spoiler-free OG cards for shared links. | Nicer link sharing | S | none | Never leak titles of private wiki | Cloudflare Pages functions | 4/7/6/7 |
| 47 | Multi-campaign switcher | One account hosts several wikis with switcher. | Reuse for new campaigns | L | campaign_id across tables | RLS rewrite risk; careful | Settings, session | 7/3/4/6 |
| 48 | Co-DM role | Second editor role with scoped permissions (no access codes). | Shared prep | M | role enum value | Update all RLS policies | Session roles | 7/6/2/7 |
| 49 | Markdown import/export per article | Download/upload single article as Markdown with front-matter. | Portable editing | S | none | Sanitize on import | Lore importer | 6/8/2/8 |
| 50 | Performance budget & prefetch | Prefetch article data on link hover; image lazy+srcset via Thumbor-like sizes. | Snappier navigation | M | none | Prefetch respects auth | prefetchMarkdown, useLoad | 7/7/3/8 |

## Top 20 (ranked)
1. #14 Secret-leak linter — protects the core promise (no spoilers) cheaply.
2. #5 Status ribbons — tiny change, huge at-a-glance world state.
3. #32 Personal notes on articles — highest player-value retention feature.
4. #13 Visibility presets — turns many reveal clicks into one.
5. #8 Recently updated feed — players know what changed since last session.
6. #28 Party dashboard cards — visual hub reusing infobox data.
7. #45 Slug redirects on rename — prevents link rot, near-free.
8. #11 Templates manager — speeds every future article.
9. #40 Reader mode — accessibility win, no backend.
10. #19 Access-code expiry/scopes — hardens the access model.
11. #20 Backup snapshot — data safety for the DM.
12. #4 Infobox field browse — emergent indexing from existing data.
13. #3 Glossary tooltips — reuses link-preview machinery.
14. #6 Rumour vs canon — fantasy-native information design.
15. #41 Offline PWA — table use with poor connectivity.
16. #25 Story-so-far strip — high visual payoff from session art.
17. #42 Search operators — power browsing on existing index.
18. #23 Portrait frames by type — CSS-only identity boost.
19. #31 Light PC sheets — player ownership via existing review flow.
20. #43 Discord publish post — pulls players back between sessions.

## Recommended next five
1. #14 Secret-leak linter (extends WikiTidy)
2. #5 Status ribbons (one column + badge CSS)
3. #45 Slug redirects (builds on existing redirect-note)
4. #8 Recently updated feed (revisions already stored)
5. #32 Personal notes (owner-only RLS table; first per-player data)

## Part 2 — Design review (non-disruptive, parchment identity kept)
Ordered by value/effort.

1. **Mobile search in header** — At <=900px `.header-search { display:none }` hides search behind the drawer. Add a search icon button in `.header-actions` (Layout.tsx) that opens the drawer focused on `.sidebar-search input`, or show a compact `.header-search` below 900px. Accept: on 375px width, search reachable in one tap from any page.
2. **Drawer keyboard handling** — Layout.tsx: close `.sidebar.open` on Escape, move focus into nav on open and back to `.menu-toggle` on close; set `inert` on `main` while open. Accept: keyboard-only user can open/close menu without focus escaping behind scrim.
3. **Sticky desktop sidebar** — theme.css `.sidebar` (>900px): `position:sticky; top:<header height>; max-height:calc(100vh - header); overflow-y:auto`. Accept: on a long article, nav remains visible while scrolling at 1280px.
4. **Sticky TOC on wide screens** — `.toc` at >=1280px: move into a right rail (`.article-layout` grid) with `position:sticky` and active-section highlight via IntersectionObserver. Accept: current heading highlighted; no layout change below 1280px.
5. **Touch targets** — `.link-button` min-height 32px and `.button.small` 36px; raise to 44px in `@media (pointer:coarse)`. Accept: all interactive elements >=44px on touch devices (Lighthouse tap-target pass).
6. **Reduced motion completeness** — `@media (prefers-reduced-motion: reduce)` only kills transitions; also neutralize `.card:hover { transform }` and animations (`animation:none`). Accept: no movement on card hover with reduced motion on.
7. **Theme toggle labeling** — icon-button uses `title` only; add `aria-pressed`/descriptive visible tooltip text and a menu (Auto/Light/Dark) instead of blind cycling. Accept: screen reader announces current theme and target; user picks dark in one action.
8. **DM nav grouping** — `.nav-dm` has 10 flat links; split into "Write" (New article, News desk, Import, Media) and "Run" (Notes, Access, Settings, Tidy) with `.nav-heading`, collapsible via `<details>`. Accept: DM sidebar fits 768px tall viewport without scroll.
9. **Parchment texture tokens** — add a subtle SVG noise/fiber background token `--parchment-texture` on `body` and `.panel` (light theme only, low opacity). Accept: contrast ratios unchanged (text >=4.5:1); disabled in print and dark theme.
10. **Muted text contrast check** — `--muted #6b5d48` on `--surface-2` and `.card-summary`; verify/raise to >=4.5:1; dark `--muted #b1a68f` on `--surface #171c3b` likewise. Accept: axe reports no color-contrast failures on Home, Article, Browse.
11. **Article reading width** — `.article { max-width:1100px }` gives long lines beside float infobox; constrain `.prose` to ~70ch. Accept: body line length 60–75 characters at 1440px.
12. **Ornamental section dividers** — replace plain `.panel h2` border-bottom and article h2 rule with a gold flourish (CSS `::after` using a small inline SVG, `--gold`). Accept: visible in both themes, hidden from AT, no layout shift.
