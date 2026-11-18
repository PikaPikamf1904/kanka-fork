# Chronicle security model: new tables

Status: this describes the tables added on the development branch by the migrations `20261117000100` to `20261117000600`. They are **not deployed**. The migration headers say they are not authorized for production until the owner approves the bundle.

Source of truth: the policies in the migration files. Where this page is not certain of a detail, it says "see migration".

## Rules that apply to every table below

- **Assistants (OAuth and MCP connections) are refused everywhere.** Each policy checks `private.is_oauth_request()`, or relies on `private.is_member()` / `private.board_member()`, which refuse OAuth requests. The DM-only tables also check it.
- **Anonymous (signed-out) access is revoked** on every new table: `revoke all ... from anon, authenticated`, then only the specific grants the table needs.
- **Membership.** `private.is_member()` requires an active campaign member and a device that has not been revoked (see "Device revocation" below).
- **DM.** `private.is_dm()` requires the DM role and, if the DM has enrolled MFA, an `aal2` session.
- **Owner columns** (`user_id`, `author_id`, `created_by`) are set by a trigger from the caller's session. They cannot be changed afterwards.
- **A page must be readable by the caller.** Where a row points at a wiki page, map, or other record, the insert or update checks the record exists under the caller's own Row Level Security.

## Reader notes (migration `20261117000100`)

| Table | Who can read | Who can write | Key rule |
|---|---|---|---|
| `reading_lists` | Owner only. The DM has no policy. | Owner only (insert, delete, update of `name` and `position`). | Cap of 50 lists per person. Names are unique per owner. |
| `bookmarks` | Owner only. | Owner only (insert, delete, update of `list_id` and `position`). | The article must be readable by the caller at insert time. The list must belong to the caller. Cap of 1,000 saved pages per person. The reorder RPC `reorder_bookmarks` works only on the caller's own rows. |
| `scratchpad_notes` | Owner only. The DM has no policy. | Owner only, through `save_scratchpad` (versioned) and direct insert or delete. | If the note is tied to a page, the page must be readable by the caller. Body 1 to 5,000 characters. Cap of 2,000 notes per person. |
| `journal_entries` | Owner reads and writes. The DM reads every entry (`journal_entries_dm_read`). | Owner only. The DM cannot write. Saves go through `save_journal_entry` (versioned). | Cap of 2,000 entries per person. The owner column cannot change. |
| `journal_entry_links` | The entry's owner. The DM reads every link. | The entry's owner (insert and delete). | An insert needs an entry the caller owns and a page readable by the caller. |

## Mystery Studio (migration `20261117000200`)

| Table | Who can read | Who can write | Key rule |
|---|---|---|---|
| `mysteries` | DM only. Players see only a spoiler-safe name through `mystery_index()`, and only once at least one clue of that mystery is visible to them. | DM only. | Titles, summaries and DM notes never reach players. |
| `clues` | DM always. A player only when all of these hold: the mystery is `active` or `concluded`; the clue is released (`released_at`, or `release_at` has passed); the attached page or map is readable by the player; and any prerequisite clue has been discovered by that player. | DM only. | Checked in the database on every read. No background job releases clues. |
| `clue_hints` | DM always. A player when the hint is released and its clue is visible to them under the same checks (see migration). | DM only. | Hints are released on the same rule as their clue. |
| `clue_discoveries` | The DM, or the player who recorded it. | The player records their own discovery, only for a clue they can see right now. The DM or the player may delete a discovery. | The insert check looks up the clue under the caller's RLS. |

`dm_preview_clues(player)` lets the DM see what one player would see. It answers only for a player member.

## Investigation Board (migration `20261117000300`)

| Table | Who can read | Who can write | Key rule |
|---|---|---|---|
| `board_groups` | Any active member, the DM included. | Any member can create. Only the creator or the DM can change or delete. | Board sections are shared by the party. |
| `board_items` | Any active member. | Any member can insert. Anyone can move a card and change its marks or a theory's status. Only the author or the DM can change the text or colour, or delete. | A pin needs a target the pinner can read now (`board_ref_readable`). The DM may pin only what players can read. Versioned updates. Limits on the number of cards and per-hour inserts. |
| `board_links` | Any active member. | Any member can insert. Only the creator or the DM can change the label or delete. | A link joins two cards and cannot join a card to itself. |
| `board_activity` | Any active member. | No direct writes. Only the database writes it, through a trigger. | Records who did what and the text players wrote. It never records the title of a pinned page. |

## Feedback Center (migration `20261117000400`)

| Table | Who can read | Who can write | Key rule |
|---|---|---|---|
| `feedback` | DM reads everything. A player reads only their own named rows (with the DM's reply). | A member inserts named rows only. Anonymous rows come only from `submit_anonymous_feedback()`. Only the DM updates (status, priority, private note, reply) and deletes. | Anonymous rows have no author and no reply. Replies only for named rows (a table check). |

Full details: `FEEDBACK-PRIVACY.md`.

## Knowledge Studio research (migration `20261117000600`)

| Table | Who can read | Who can write | Key rule |
|---|---|---|---|
| `research_collections` | Owner, or any active member when `shared` is true (the DM included). | Owner only. | A player may share a collection. The DM's collections cannot be shared (a trigger refuses it). Limit of 100 collections per person. |
| `research_sources` | Anyone who can read the collection. | The collection's owner only. | An insert needs a page readable by the caller. Only the page id is stored. A page hidden later shows as unavailable. Limit of 500 sources. |
| `research_notes` | Anyone who can read the collection. | The collection's owner only. | Versioned summaries. Limit of 200 summaries per collection. No AI is used. |

## Player invitations (migration `20261117000500`)

| Table | Who can read | Who can write | Key rule |
|---|---|---|---|
| `player_invitations` | DM only, and only the columns granted. The stored token hash is not selectable by any browser role. | No direct writes. The DM uses `create_`, `regenerate_` and `revoke_player_invitation`. The server (service role) uses `begin_`, `release_` and `finish_player_invitation`. | Single use, expiring, role fixed to `player`. An invitation cannot create or reach a DM. Only a SHA-256 of the token is stored. |
| `member_devices` | DM reads every device. A player reads their own devices. | No direct writes. The DM revokes any device (`revoke_member_device`). A player revokes their own. `touch_device` updates last-seen for the caller's session. | Each device is keyed by its Auth session id. Revocation takes effect at once through `is_member()`. |

## Maintenance switch (migration `20261117000700`)

| Object | Who can read | Who can write | Key rule |
|---|---|---|---|
| `campaign_settings.maintenance_until` | Not readable through the API. The column is in no column-level `select` grant, so `authenticated` cannot select it directly. | Through `set_maintenance()` only, on the website. See the caveat below. | The column holds the end time of the notice. |
| `maintenance_switch()` | Any active member. It returns only the end time, and only while that time is in the future. Otherwise it returns null. | Not applicable (read-only function). | Refused for OAuth requests, because it depends on `private.is_member()`. |
| `set_maintenance(minutes)` | Not applicable (write function). | DM only (`private.is_dm()`, and not an OAuth request). `0` turns the switch off. `1` to `480` minutes sets an end time that many minutes from now. Any other value is refused. | Always expires. The notice cannot stay on for more than 8 hours from the last change. |

Caveat: the function refuses values outside 0 to 480, but the migration header says the DM picks "15 minutes to 8 hours". The code accepts 1 to 480. Also, `set_maintenance()` is the intended route, but the DM's existing `settings_dm` update policy on `campaign_settings` may allow a direct update of the new column if a table-level update privilege still applies to `authenticated`. This page does not verify that grant; see the migration and the grants on `campaign_settings`.

## Device revocation

- `private.is_member()` returns false when the current session's id matches a `member_devices` row with `revoked_at` set. Every policy that uses `is_member()` therefore refuses a revoked device immediately, with no need to wait for the session to expire.
- `touch_device()` reports `revoked` to the device, so the page tells the player they have been signed out.
- Sessions with no device row (the DM, and devices that entered an access code) are not affected.
- Policies that use only `is_dm()` do not check `member_devices`. That is safe only because an invitation can never create a DM and a DM session has no device row. Do not change either fact without changing this section.

## Things that are not protected by the database

- **Recently viewed** is kept in the browser's `localStorage`, under a key that includes the signed-in user id. It stores each page's id, address and title as the reader saw them. It never reaches the database. Anyone with the device can read it, and "Clear recently viewed" removes it.
- **Shared-device sign-ins** (`chronicle-accounts` in `localStorage`) keep each saved player's refresh token in that browser. Only accounts that joined on that device are listed. Anyone with the device can use them until the player leaves the device or the DM signs the device out.
- **The invitation link** is removed from the address bar when the page opens, but the DM and the player handle the link itself. Whoever receives it can try to use it first. The DM should send it only to the named player.
- **The scratchpad and journal text** is stored in the database as plain text. Only the row-level policies above restrict who reads it. Database backups and the hosting providers' logs are outside these policies.
- **Anonymous feedback** is limited by the design in `FEEDBACK-PRIVACY.md`. Request logs at the hosting providers can record the request.
- **The DM's own device and screenshots.** Anything the DM copies or exports is outside the database.
- **Database backups** taken by the hosting provider keep earlier copies of rows until those backups expire.
