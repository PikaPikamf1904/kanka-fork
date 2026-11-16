# Proposal: bookmarks, reading lists and personal notes (needs approval)

**Status: proposed, not written.** Two of the requested features store data per player, which no
current table supports. Both need one new forward-only migration. Following the rule that a
migration needs approval before it is written, nothing below exists yet. Approving this proposal
means: write the migration and the features, test them locally, add the file to the gated
production bundle. Nothing is applied to production without the separate release approval.

## Why a migration

Every existing table is campaign content that the DM writes and players read. Bookmarks and
personal notes are the first data a *player* writes, visible only to that player. Browser storage
was considered and rejected: it disappears on another device or after clearing the browser, and
can't be shared between a phone and a laptop.

## Proposed file: `20261117000100_player_bookmarks_and_notes.sql`

### `public.bookmarks`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid, primary key | |
| `user_id` | uuid, not null, references `auth.users` on delete cascade | forced to `auth.uid()` by a trigger |
| `article_id` | uuid, not null, references `public.articles` on delete cascade | |
| `list` | text, not null, default `''`, at most 60 characters | the reading-list name; `''` = no list |
| `created_at` | timestamptz, not null, default `now()` | |

Unique `(user_id, article_id, list)`. No title or address is stored, so a bookmark can never reveal
a page that later becomes hidden. The website reads the page itself under Row Level Security and
drops bookmarks whose page no longer comes back.

### `public.personal_notes`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid, primary key | |
| `user_id` | uuid, not null, references `auth.users` on delete cascade | forced to `auth.uid()` |
| `article_id` | uuid, not null, references `public.articles` on delete cascade | |
| `body` | text, not null, 1 to 5,000 characters | |
| `created_at`, `updated_at` | timestamptz | |

Unique `(user_id, article_id)`: one note per page per person.

### Security (same for both tables)
- RLS on. `anon` gets nothing. `authenticated` gets select, insert, update (notes only) and delete.
- **Read:** only your own rows (`user_id = auth.uid()`), and only while you are an active member.
  The DM can't read players' notes or bookmarks. They are private to each player, as the word
  "personal" promises. *Owner decision: confirm the DM shouldn't see them.*
- **Write:** only your own rows, only as an active member, and only for a page you can read. The
  insert check runs `exists (select 1 from public.articles where id = article_id)` under your own
  RLS, so a hidden page's id is refused.
- Assistant (OAuth/MCP) connections can't write either table, consistent with the existing write
  boundary.
- Limits enforced in the database: 500 bookmarks and 2,000 notes per person.
- Removing a member or deleting a page cascades their rows away.

### Tests to add
- **Database tests:** own-row CRUD. Another member can't see or delete your rows. The DM can't
  read them. Revoked members, outsiders and anon get nothing. A hidden page id is refused. OAuth
  is refused. The caps hold. Cascades work.
- **Reference-leak sweep:** these tables need an allow-list entry, with the reason that the row is
  the reader's own choice.
- **Browser tests:**
  - Bookmark, organise into lists, remove; the bookmarks survive a reload.
  - A second player sees none of them.
  - A page later made DM-only vanishes from the list, with no title in any response.
  - Phone layout.
- **Upgrade rehearsal:** re-run `scripts/upgrade-simulation.sh` with the file added.

### Website
- A bookmark toggle on article pages. "My bookmarks" at `/bookmarks`, grouped by reading list,
  with a filter.
- A "My notes" box on article pages, plus `/notes` listing all your notes.
- Until the migration is applied, the controls hide themselves and the pages say the feature isn't
  available yet, so the website can be deployed first.

**Estimated work after approval:** about half a day, including the tests above.
