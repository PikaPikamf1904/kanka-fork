# Proposal: the migrations behind the next Chronicle features

**Status (2026-11-17): written and tested locally on the development branch, after the owner's
sprint brief authorised local migrations for these designs. Not applied to any hosted database.**
The files, hashes and test status are in [MIGRATIONS-2026-11-17.md](MIGRATIONS-2026-11-17.md).
The design below is the original proposal; where the brief changed it, the files win:
- the DM can read Character Journals (read-only); private scratchpads stay owner-only;
- one campaign-wide Investigation Board with mystery sections;
- research collections are private by default and players may share them with the party;
- invitations create one account per player, used on all of that player's devices;
- an extra small migration, 20261117000700, adds the DM's website maintenance switch.

Approving a numbered migration means that file may be:
1. written,
2. tested locally (database tests, browser tests, the reference-leak sweep, the upgrade rehearsal),
3. added to the gated production bundle.

Applying it to production still needs the separate release approval and the verified backup.

Every migration follows the existing rules:
- Forward-only, idempotent style, and ends with `notify pgrst, 'reload schema'`.
- Row Level Security on every table; `anon` gets nothing.
- No service key in the browser.
- Assistant (OAuth/MCP) connections can't write any of these tables unless stated.
- The website degrades gracefully while a migration is missing: the feature hides itself and says
  it isn't available yet. That way the website can be deployed before the database changes.

Answers needed from you are marked **Decision**.

---

## M1 — Bookmarks, reading lists and personal notes

`20261117000100_bookmarks_lists_notes.sql`

### `public.reading_lists`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid primary key | |
| `user_id` | uuid, not null, references `auth.users`, on delete cascade | forced to `auth.uid()` by a trigger |
| `name` | text, not null, 1–60 characters | |
| `position` | integer, not null, default 0 | order of the lists |
| `created_at`, `updated_at` | timestamptz | |

Unique `(user_id, lower(name))`. Renaming and deleting are owner-only. Deleting a list deletes its
items (cascade); the bookmarked pages themselves are untouched.

### `public.bookmarks`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid primary key | |
| `user_id` | uuid, not null, references `auth.users`, on delete cascade | forced to `auth.uid()` |
| `article_id` | uuid, not null, references `articles`, on delete cascade | |
| `list_id` | uuid, null, references `reading_lists`, on delete cascade | null = "Saved" (no list) |
| `position` | integer, not null, default 0 | order within the list (drag to reorder) |
| `created_at` | timestamptz | |

Unique `(user_id, article_id, list_id)` with nulls not distinct.

- **No title or address is stored**, so a bookmark can't reveal a page that later becomes hidden.
  The website reads the page under Row Level Security and leaves out bookmarks whose page no longer
  comes back.
- Insert check: `exists (select 1 from public.articles where id = article_id)` runs under the
  caller's own RLS, so a hidden page's id is refused.
- `list_id` must belong to the same user (trigger).
- Reordering uses one RPC, `reorder_bookmarks(list_id, ids uuid[])`, in a single transaction.
  Concurrent reorders from two devices: the last one wins, and nothing is lost or duplicated.

### `public.personal_notes`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid primary key | |
| `user_id` | uuid, not null, references `auth.users`, on delete cascade | forced to `auth.uid()` |
| `article_id` | uuid, not null, references `articles`, on delete cascade | |
| `body` | text, not null, 1–5,000 characters | |
| `version` | integer, not null, default 1 | optimistic locking |
| `created_at`, `updated_at` | timestamptz | |

Unique `(user_id, article_id)`.

- Saving is an explicit "Save" plus an autosave 2 seconds after typing stops. Both send the
  `version` they loaded.
- A save from a second device that loaded an older version is refused with a clear message, so the
  newer text is never silently overwritten.
- Leaving the page with unsaved text asks first (the existing unsaved-work guard).

### Policies, limits and tests
- **Read, insert, update and delete:** own rows only (`user_id = auth.uid()`), active members only,
  and not over OAuth.
- **Limits:** 50 lists, 1,000 bookmarks and 2,000 notes per person.
- **Decision:** can the DM read players' bookmarks and notes? **Proposed: no.** They are private to
  each player.
- **Tests:**
  - Own-row CRUD. Other members, revoked members, outsiders and anon get nothing.
  - A hidden page id is refused. A list item can't point at another user's list. OAuth is refused.
  - Version conflicts on notes. The caps hold. Cascades work.
  - Reference-leak sweep allow-list entries, each with its reason.
  - Browser: two devices (two contexts on one account), a page hidden later disappears, phone
    layout.

---

## M2 — Investigation Board (shared party board)

`20261117000200_investigation_board.sql`

### `public.board_items`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid primary key | |
| `kind` | text | `pin` or `note` |
| `ref_type` | text, null | `article`, `media`, `news`, `timeline_event`, `map_marker` or `clue` (M3) |
| `ref_id` | uuid, null | the pinned thing; only its id is stored |
| `body` | text, at most 2,000 characters | sticky-note or theory text; empty for plain pins |
| `colour` | text | one of 6 named colours |
| `marks` | text[] | subset of `suspicious`, `investigated`, `unconfirmed` |
| `x`, `y` | real | position on the board |
| `version` | integer | optimistic locking for moves and edits |
| `created_by` | uuid, references `auth.users`, on delete set null | forced to `auth.uid()` |
| `author_name` | text | the member's display name at the time, so notes stay attributed |
| `is_dm` | boolean | forced by a trigger: true only when the author is the DM ("DM clue") |
| `created_at`, `updated_at` | timestamptz | |

### `public.board_links`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid primary key | |
| `from_item` | uuid, references `board_items`, on delete cascade | |
| `to_item` | uuid, references `board_items`, on delete cascade | |
| `label` | text, at most 80 characters | |
| `created_by` | uuid | forced to `auth.uid()` |
| `created_at` | timestamptz | |

Unique `(least(from,to), greatest(from,to))`. Self-links are refused.

### Rules
- **Who sees the board:** every active member reads the whole party board; the DM reads it too.
- **Adding:** any active member can add items and links.
  - A pin's `ref_id` must be readable by the person pinning it. A trigger checks this with an
    `exists` query on the referenced table under the caller's RLS. So nobody can pin something
    they can't see, and a hidden thing's id can't be placed on the board.
- **Hidden later:** when a pinned thing becomes hidden, other players don't see what it was. The
  website shows "This evidence is no longer available", because it resolves each pin under the
  reader's own RLS. The stored id alone reveals nothing.
- **Editing and moving:** anyone can move cards, which is shared rearranging. That only changes
  `x`/`y`, uses the `version` check, and is limited by a trigger. Only the author can change a
  card's text, colour and marks. The DM can change or delete anything ("remove inappropriate
  contributions").
- **Deleting:** the author or the DM.
- **What the board isn't:** it never turns a theory into lore, and nothing on it is linked into
  the wiki, search or the Knowledge Graph.
- **Limits:** 500 items and 1,000 links per board; 30 new items per member per hour.
- **Tests:** member CRUD and permissions; pinning a hidden page, picture or marker is refused; a
  pin that becomes hidden resolves to nothing for players; version conflicts; revoked members,
  outsiders and anon; OAuth refused; browser dragging (mouse and touch), linking, colours and
  marks, phone layout.

**Decision:** one shared board, as proposed, or separate boards per mystery? Proposed: one board
now, with a nullable `board_id` added later if needed.

---

## M3 — Mystery Studio (DM-prepared clues)

`20261117000300_mystery_studio.sql`. This migration depends on M2 only for pinning clues; otherwise
it stands alone.

### `public.mysteries`
DM only; players have no policy at all. Columns:
- `title` (internal title)
- `session_article_id` (an upcoming session page, optional)
- `status`: `draft`, `active`, `concluded` or `archived`
- `notes`
- `is_template`
- timestamps

### `public.clues`
| Column | Type | Notes |
|---|---|---|
| `mystery_id` | uuid, references `mysteries` | |
| `kind` | text | `letter`, `notice`, `symbol`, `image`, `document` or `note` |
| `title`, `body` | text | the DM's own content; Markdown like articles |
| `media_id` | uuid, null | attached picture or document |
| `attach_type`, `attach_id` | text, uuid, null | where it appears: `article`, `map` or `news` |
| `release_at` | timestamptz, null | scheduled release |
| `released_at` | timestamptz, null | set when released |
| `position` | integer | |

### `public.clue_puzzles`
`clue_id`, `prompt`, `answer_hash` (bcrypt of the normalised answer), `hints` (an ordered list of
`{text, after_attempts}`).

### `public.clue_discoveries`
`(clue_id, user_id, discovered_at)`, unique. Written by a SECURITY DEFINER function when a member
opens a released clue.

### `public.puzzle_attempts`
`(clue_id, user_id, attempts, solved_at)`.

### How release works
The important part is that nothing unreleased can leak.
- **Read policy on `clues` for members:**
  - the clue is `released_at is not null`, or `release_at <= now()`;
  - its mystery is `active` or `concluded`;
  - and the thing it's attached to is readable by the member.

  Nothing else is selectable by a player. Unreleased clues never appear in any response, search,
  graph, count or page source, because the website only ever has what RLS returned.
- **Scheduled release:** `release_at` is compared to `now()` inside the policy, so no background
  job is needed. Manual release sets `released_at` (DM only).
- **Puzzles:**
  - Players never receive `answer_hash`. Column grants exclude it, and puzzles are read through a
    view that omits it.
  - `check_puzzle_answer(clue_id, answer)` is a SECURITY DEFINER function. It only works for
    released clues, compares the hash, counts attempts, reveals the hints whose `after_attempts`
    are reached, records a solve, and is rate-limited to 20 attempts per hour per member.
- **Optional by design:** a clue never gates anything else on the site. The tracking is for the
  DM's view only: discovered clues, solved puzzles, attempts per clue.
- **Assistants (MCP):** can't read or write mysteries or clues. Future-session secrets stay out of
  assistant answers.
- **Search:** clues aren't indexed in site search in phase one. Released clues are found by
  visiting the page they're attached to, which is the ARG mechanic.
- **Tests:**
  - A player never receives an unreleased clue: direct table reads, by attachment, through the
    function, through the board pin check, and before and after `release_at`.
  - `answer_hash` is never selectable. Attempts are rate-limited. Hints progress.
  - Removed members, anon and OAuth get nothing.
  - Browser: the DM creates, schedules and releases a clue; it appears on its page only after
    release; a player pins it to the board.

---

## M4 — Confidential Feedback Center

`20261117000400_feedback.sql`

### `public.feedback`
| Column | Type | Notes |
|---|---|---|
| `category` | enum | `bug`, `improvement`, `feature`, `campaign`, `more_of`, `less_of`, `comfort` or `other` |
| `body` | text, 1–5,000 characters | |
| `author_id` | uuid, null | set only for named feedback; forced to `auth.uid()` |
| `author_name` | text, null | |
| `submitted_on` | date, not a timestamp | to reduce correlation with access logs |
| `status` | text | `new`, `read`, `in_progress`, `done` or `closed` |
| `priority` | text | `none`, `low`, `normal` or `high` |
| `dm_note` | text | |
| `reply` | text | named feedback only |
| `replied_at` | timestamptz | |

### Rules
- **Named:** a normal insert by the member (`author_id = auth.uid()` forced).
  - Reading back: members read only their own named rows (to see a reply). The DM reads all.
- **Anonymous:** submitted only through `submit_anonymous_feedback(category, body)`.
  - It's a SECURITY DEFINER function that inserts with `author_id = null` and `author_name =
    null`, and stores only the date.
  - Spam limit: at most 5 per person per day. It's counted in `private.feedback_quota`, keyed by
    `hmac(user_id, daily_salt)`. The salt is regenerated each day and the old salt and counts are
    deleted, so after the day ends the database can't link a submission to anyone.
  - Members can't read anonymous rows at all.
- **What the form will say, honestly:** "Your name is not attached and Chronicle does not store who
  sent this. The hosting providers keep normal access logs, so complete anonymity cannot be
  promised."
- **Comfort reports** (`comfort`) are listed separately in the DM inbox. They never appear in
  search, the graph, research tools, assistants (MCP has no access) or anything players see.
- **Limits:** 20 named submissions per member per day.
- **Tests:**
  - A player can't read others' feedback or any anonymous row.
  - An anonymous row contains no user id, name or time of day.
  - The quota holds and resets.
  - OAuth and anon are refused.
  - Browser: submission flows, the DM inbox with filters, search, status, priority and reply.

---

## M5 — Personal invitations

`20261117000500_invitations.sql`, plus a change to the enrollment function.

### `public.invitations`
DM only:
- `id`
- `display_name` (Eliza, Sybil, Charity, Weston, …)
- `token_hash` (SHA-256 of a 32-byte random token)
- `expires_at` (default 7 days)
- `used_at`, `used_by`
- `revoked_at`
- `role`: a check that permits only `player`

### How it works
- The DM creates one invitation per player and gets the link once: `/join#<token>`. The token sits
  after `#`, so it never reaches server logs or `Referer` headers.
- The link opens a page that posts the token to `/api/enroll` (the existing function, extended).
  The function:
  1. checks the token hash, expiry, single use and the existing rate limits, under the same
     advisory lock as access codes;
  2. creates the account exactly as enrollment does today;
  3. sets the member's display name from the invitation;
  4. marks the invitation used.

  A used, expired or revoked link fails with a generic message.
- **Identity:** the device stays signed in through the normal refresh token, as now. Names and IP
  addresses are never treated as proof of identity. **An invitation can never create a DM**: the
  check constraint on `role` and the function both insist on `player`.
- **Devices:** `list_member_devices(user_id)` is a DM-only SECURITY DEFINER function. It shows each
  sign-in session's created and last-used time and the browser family (from the user agent, not
  the IP).
- **Revoking:** a DM-only action calls the existing `revoke_member`. A Pages function then signs
  out that user's sessions through the Auth admin API, server-side; the service key never reaches
  the browser.
- Access codes keep working until you choose to retire them.
- **Tests:**
  - A token works once. Expired and revoked tokens fail.
  - A token can't create a DM, and can't be replayed from another device.
  - Rate limits hold.
  - Revoking ends sessions.
  - OAuth/MCP sign-in is unaffected.

---

## M6 — Knowledge Studio (research collections)

`20261117000600_research.sql`

### Tables
- **`public.research_collections`:** `id`, `user_id` (owner), `title`, `focus_type` (`character`,
  `faction`, `location` or `general`), `focus_article_id` (null), timestamps.
- **`public.research_sources`:** `collection_id`, `article_id` (or `media_id` for a permitted
  document), `position`, `added_at`.
- **`public.research_notes`:** `collection_id`, `body` (at most 10,000 characters), `version`,
  timestamps.

### Rules
- **Ownership:** owner-only by default.
  - **Decision:** should collections be shareable with the party (read-only)? Proposed: owner-only
    in phase one.
- **Sources:** adding a source requires that the owner can read it (same `exists` check under
  RLS). Sources that later become hidden show as unavailable.
- **Searching within sources:** runs the existing full-text search restricted to the collection's
  readable pages. Excerpts come from text the reader can read.
- **Graph:** a collection opens in the Knowledge Graph as its own subgraph. No new edges are
  stored.
- **AI (later, not in this migration):**
  - Source-grounded answers would go through the existing MCP server, using only the asking
    member's own readable sources.
  - Every answer would carry citations.
  - DM-only material can't appear, because retrieval runs under the member's RLS.
  - Output never edits wiki content.
  - This needs a separate design and approval once credentials and costs are known.

---

## Not a database change: maintenance notice

This is being built now without a migration. It uses a Cloudflare Pages Function plus an optional
Workers KV namespace that the owner binds. See `docs/chronicle/MAINTENANCE-NOTICE.md` once it
exists.

## Order and dependencies

1. **M1, M2, M4, M6** are independent. **M3** extends M2 (pinning clues). **M5** touches enrollment
   and should get its own security review before release.
2. Each one is a separate file, so each can be approved, applied or deferred on its own.
3. **Proposed order:**
   1. M1 (smallest, most requested)
   2. M4
   3. M2
   4. M3
   5. M6
   6. M5

## What approval looks like

A reply such as "Approved: M1, M2, M4" lets me write and test those files.
