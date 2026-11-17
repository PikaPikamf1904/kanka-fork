# Feedback privacy: what is stored, who can read it, and the limits

Status: this describes the Feedback Center on the development branch. It is **not deployed**. The source is `chronicle-cloud/supabase/migrations/20261117000400_feedback.sql`, the player form in `chronicle-cloud/src/pages/FeedbackPage.tsx` and the DM inbox in `chronicle-cloud/src/pages/dm/FeedbackInbox.tsx`.

## What the player can choose

- **With my name** (named): the DM can read the feedback and reply to it. The player can see their own named feedback and any reply.
- **Anonymously** (anonymous): the database does not hold the sender's account or name. No reply is possible.

Both modes take one of nine kinds and a message of 1 to 5,000 characters.

## What is stored: signed (named) feedback

One row in `public.feedback`, with these columns:

| Column | Content |
|---|---|
| `id` | A random identifier. |
| `category` | One of: bug, improvement, feature, enjoy, more, less, confusing, comfort, other. |
| `body` | The message (1 to 5,000 characters). |
| `mode` | `named`. |
| `author_id` | The account that sent it. |
| `author_name` | The player's display name, copied when the feedback was sent. |
| `submitted_on` | The **date** it was sent. No time of day. |
| `status` | New, read, being worked on, done or closed. Starts as `new`. |
| `priority` | None, low, normal or high. Starts as `none`. |
| `dm_note` | The DM's private note. Starts empty. |
| `reply` | The DM's reply, if any. |
| `replied_at` | The time the reply was saved, if there is one. This is a full timestamp. |

Limit: 20 named feedback items per person per day, counted from these rows.

## What is stored: anonymous feedback

One row in the same `public.feedback` table. Anonymous rows are written only by the function `public.submit_anonymous_feedback()`. Direct inserts with `mode = 'anonymous'` are refused.

| Column | Content |
|---|---|
| `id`, `category`, `body`, `mode` | As above; `mode` is `anonymous`. |
| `author_id`, `author_name` | Always empty (null). The insert path in `submit_anonymous_feedback()` sets them to null, and a table check requires an anonymous row to have no author and no reply. |
| `submitted_on` | The **date** it was sent. No time of day. |
| `status`, `priority`, `dm_note` | Set by the DM, as for named feedback. |
| `reply`, `replied_at` | Always empty (null). A reply is not possible. |

Limit: 5 anonymous items per person per day. The count is kept in a separate table, `private.feedback_quota`, under a **keyed hash** rather than the person's id:

- `private.feedback_salt` holds one random 32-byte salt per day, created the first time anyone sends anonymous feedback that day.
- The key is HMAC-SHA256 of the person's account id, using that day's salt, written as hex.
- `private.feedback_quota` holds `(day, key, count)`. The count is compared against the limit of 5.

Deletion of the salt and the counts: at the start of each anonymous submission, the function deletes every quota row and every salt whose day is earlier than today. This is the only place they are deleted. **There is no timer and no scheduled job.** If nobody sends anonymous feedback on a new day, the previous day's salt and counts stay in the database until the next anonymous submission. Once they are deleted, the stored key cannot be linked back to any person.

While a day's salt exists, the counts for that day can be matched to a person by anyone with direct database access who also has the list of account ids. The migration does not prevent that. It is one reason why the limits below matter.

## Who can read and write what

| Who | Named feedback | Anonymous feedback | Quota and salt tables |
|---|---|---|---|
| The DM | Reads all rows. Changes status, priority, the private note and the reply. Deletes. | Reads all rows. Changes status, priority and the private note. Deletes. Cannot reply. | No access from the browser. |
| The player who sent a named item | Reads their own named rows, with the DM's reply. Inserts their own named rows. | No access. A player cannot read their own anonymous row. | No access. |
| Other players | No access. | No access. | No access. |
| Assistants and OAuth or MCP connections | No access. Every policy refuses them. | No access. | No access. |

The browser roles (`anon` and `authenticated`) have no direct access to `private.feedback_salt` or `private.feedback_quota`. Only the function that writes anonymous feedback touches them.

Feedback is never indexed for search, never shown in the knowledge graph and never returned by any player-facing tool.

## What is NOT stored

- No account id, name or display name on an anonymous row.
- No time of day for any feedback submission. The only time-of-day value is `replied_at`, which is set when the DM saves a reply to named feedback.
- No IP address, device identifier, session id or browser detail in the `feedback` table.
- No page address or record of which page the player was on.
- No copy of the feedback outside the `feedback` table, apart from the daily counts described above.

## Honest limits

These are the limits the form states, and some more:

- **Writing style and details.** The way someone writes, and the details they mention (a place, a character, a date, an event only some people attended), can identify them to people who know the group. The database cannot prevent this.
- **Hosting providers' request logs.** The website host, the database host and the server functions keep ordinary request logs. Those logs can contain an IP address, a time and the request. The migration does not control them and cannot delete them. Anonymous feedback is sent as a request that is signed in as the player, so the request is visible in those logs.
- **Database backups.** A backup taken by the database host before a row is deleted keeps the old copy until the backup expires. Those backups are outside these migrations.
- **Small groups.** The date a message was sent, combined with the topic, can narrow it down in a small group.
- **Deleting does not erase logs.** When the DM deletes a feedback item, the row is removed from the table. It does not remove request logs or backups.
- **The DM's own devices.** Anything the DM copies, screenshots or forwards leaves the database and is outside the site's control.

If complete anonymity matters, the honest answer is that Chronicle cannot promise it. Players can choose **With my name** and speak to the DM directly, or choose anonymous and accept these limits.
