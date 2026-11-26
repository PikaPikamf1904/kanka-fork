# Living World: scheduled Gazette, Letters from Krynn, and what's new

Chronicle can now keep the world moving between sessions: you prepare stories and letters in advance,
approve them, choose when they appear, and players find them on the home page and in the Gazette.
There are no streaks, no counters and no notifications. Older items stay in the archive.

## Adding and scheduling content (the DM's workflow)

1. Ask ChatGPT for seven articles using `docs/chronicle/templates/gazette-article-template.md`
   (and letters using `letter-template.md`). Read them. Cut anything players should not know.
2. **DM → News desk → Write a story.** Copy each field across: headline, deck, opening paragraph,
   story, reporter, section, kind of reporting, dateline, date. For a letter, set **Section** to
   *Letter from Krynn* and fill in sender, recipient and signature; the headline is the subject line.
3. Add a picture if you want one (a letter's picture shows as a small seal or illustration).
4. **Save story → Send for review → Approve.** Nothing is visible to players yet.
5. On an approved story a **Release on** box appears. Pick the date and time, press **Schedule**.
   Do the same for the others, on different days or the same day. **Print for players** prints at once.
   **Reschedule** or **Cancel schedule** any time before it prints.
6. The desk shows three groups: *On the desk*, *Scheduled* (with their times) and *Printed*.

Editing an approved story sends it back to review and **clears its schedule**, so text you did not
approve can never go out by itself. Taking a story back to draft also clears it.

**Time zone.** Times are read in the campaign time zone: **DM → Wiki settings → Publication time zone**
(default UTC; use a place name such as `America/Chicago`). "Today" for Daily Discovery changes at midnight in
the same zone.

There is no bulk import. Pasting seven stories into the editor is a few minutes of work and keeps each
one under your review. (A batch importer was considered and left out to avoid a second publishing path.)

## What players see

- **Home page:** the newest Gazette headline, the latest letter (one line, only when one exists),
  and *From the archive today* (see below). Nothing is shown when nothing is published.
- **Gazette:** newest story first. A **Letters** link in the masthead opens *Letters from Krynn*; the
  three newest letters also appear in a side box on the front page. Letters are kept out of the
  newspaper's front page and archive. Older stories remain in the Archive.
- **From the archive today:** one published page the reader may read (characters, places, items,
  factions, quests, sessions, events, lore and Gazette stories; never letters), chosen from the
  campaign date so it is the same all day for everyone and changes at midnight. It only ever uses pages
  players can already read, even when the DM looks. It is computed, not stored.

## How it works (architecture)

- A scheduled story is a normal Gazette page that **stays a draft** and has a `publish_at` time
  (migration `20261126000100_living_world.sql`). Because it is a draft, every existing read path —
  direct address, search, suggestions, the knowledge graph, related pages, counts, maps, timeline,
  pictures and the DM export — already hides it. There is no second visibility system.
- When the time passes, the database function `release_due_stories()` prints it: it sets the page to
  published, exactly as **Print for players** does, with the same approval guard and the same picture
  sync. It uses the **database clock**, never the device clock.
- There is no cron job, worker or server. Whenever a signed-in member opens the site, the home page,
  the Gazette or a story, the site asks the database to run `release_due_stories()` (at most once every
  30 seconds). It is safe for anyone to call: it can only print stories you approved and scheduled.
  If nobody opens the site, nothing needs printing; the first visit after the time prints it, and the
  story is dated with its scheduled time.
- Only an **approved** story can be scheduled; only the DM, on the website, can schedule; the time must be
  in the future.
- Letters are Gazette pages with section `letters` plus sender, recipient and signature. They use the
  same review, approval, scheduling, privacy, search and history. There is no inbox, messaging or reply.

## Limits and notes

- The first visit after a scheduled time does the printing. That visit sees the story at once; another
  reader who loaded the page in the same moment sees it on their next load. There is no push.
- Stories now sort by **print time, newest first** (the issue number only breaks ties). Before this change
  a story with no issue number ranked below numbered ones, so a daily story would never lead.
- A story you schedule becomes visible to players when it prints even if its page was marked DM-only,
  exactly as **Print for players** does. DM-only parts (sections) of a story stay hidden.
- A letter cannot be addressed to one player; letters are for the whole party.
- Rolling back: see the header of the migration. Existing stories, letters and settings are not changed by
  applying it.

## Applying the migration (owner step, not done here)

Apply `20261126000100_living_world.sql` to the hosted project **before** deploying the website build, in the
usual way (SQL editor, or `supabase db push`). It only adds columns, one enum value and two functions. The
website tolerates the migration being missing (scheduling controls will not work, the rest of the site does).
