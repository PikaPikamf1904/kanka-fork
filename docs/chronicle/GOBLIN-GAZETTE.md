# The Goblin Gazette

*All the news that's fit to steal.* Krynn's most questionable news source, at `/news`.

The Gazette reports the campaign from inside the world. The war is serious; the goblins reporting on
it are not. Stories are written by the DM (or proposed by an assistant) and printed only when the DM
says so.

## The newsroom

| Reporter | Desk | Voice |
|---|---|---|
| **Gristlewick Snoot** | Editor-in-Chief | Grand, certain, frequently wrong. Short declarations. Treats every rumor as confirmed and every correction as a personal attack. |
| **Nib Twelve-Fingers** | Chief Investigator | Breathless and suspicious. Lists, connected dots, questions nobody answered. Sometimes the pattern is real. |
| **Mossbottom Quill** | War Correspondent | Plain, accurate and frightened. The facts are right; the reporter is hiding behind them. |
| **Madame Pinchcheek** | Society & Gossip | Warm, nosy, confidently confused. Notices outfits, feuds and who left early, rarely why. |
| **The Corrections Desk** | Under protest | Grudging and brief. Admits the error, then blames someone else. |

The staff are defined in `chronicle-cloud/src/lib/gazette.ts`. Keep each voice consistent. Most of
the humor should come from *how* they report, not from a punchline at the end of every paragraph.

## Writing a story (DM)

1. **News desk** (sidebar, under Dungeon Master) → **Write a story**.
2. Fill in:
   - **Headline** and **Deck**, the italic line under the headline.
   - **Opening paragraph.** It appears in bold with a drop cap, and as the teaser on the front page.
   - **Section:** Breaking News, War Dispatches, Local News, Rumors, Interviews or Corrections.
   - **Kind of reporting:**
     - *Reported*: in-world reporting of something the party saw or heard.
     - *Rumor*: unchecked gossip, stamped **Unconfirmed**. A printed rumor is not canon.
     - *Editorial*: the editor's opinion, stamped **Opinion**.
     - *Correction*: stamped **Correction**. Choose the story it corrects.
   - **Reporter.** Their voice notes appear under the menu.
   - **Dateline, in-world date, issue number.** Leave a date blank rather than guess it.
   - **Lead story**, if it should headline the front page.
   - **Story picture** (optional): **Add image**, then crop it. It appears under the headline and,
     for the lead story, on the front page. See [IMAGES.md](IMAGES.md).
   - **Story.** Markdown. **Add image** and **Add gallery** above the text box place pictures for you. Link Chronicle pages with `[[page-address]]` or `[[page-address|shown text]]`;
     linked pages that players may read appear under *In the Chronicle*.
3. **Save story.** It is a private draft. **Preview as printed** shows exactly how it will look.

## Review and printing

Every story goes **Draft → In review → Approved → Printed**. The buttons on the story and on the
news desk move it along:

| Button | What it does |
|---|---|
| Send for review | Draft → In review |
| Approve | In review → Approved (still not visible to players) |
| Print for players | Approved → printed: players can read it |
| Send revision for review / Approve revision | For a printed story you edited: the approved revision replaces what players read |
| Discard revision | Drops the waiting revision; the printed story is unchanged |
| Unprint | Takes a printed story out of the paper (it stays approved) |
| Back to draft | Any state → Draft. A printed story disappears from players at once. |

The database enforces these rules, so they hold whatever screen or tool is used:

- A Gazette story **cannot be published unless it is approved**. That applies to the news desk, the
  general article editor and any direct database call.
- Players receive nothing about a story (headline, text, newspaper details) until it is printed.
- Only the DM, **on the Chronicle website**, can save, review or print stories. A connected
  assistant (ChatGPT, Codex) can propose a story draft through the usual preview-and-approve flow,
  but cannot send it for review, approve or print it.
- **Editing a printed story does not change what players read.** Your changes are saved as a
  *revision* that only you can see. Players keep reading the printed version until you **Send
  revision for review** and **Approve revision**. Then the new version replaces it in one step.
  **Discard revision** throws the changes away and leaves the printed story as it was. The news desk
  marks stories with a waiting revision.
- Nothing else can change a printed story's text, pictures or newspaper details: the general article
  editor, assistants and direct database writes are all refused.
- Editing a story that is approved but not printed yet sends it back to *In review*.
- **Unprint** or **Back to draft** on a story with a waiting revision takes it out of the paper and
  keeps the revision's text as the new draft, back in review.

**Before printing, check:** nothing in the story is DM-only, unplayed or a future plan. Printing
makes the whole story visible to every player.

## Where the party is now

**Wiki settings** has *Where the party is now* (a location page) and *How things stand* (one or two
lines). Both appear on the main page. Players only see the location once that page is published for
them; the line of text is shown as written, so keep spoilers out of it.

## Technical notes

- Migration `supabase/migrations/20261112001300_goblin_gazette.sql`:
  - adds the article type `news` and the table `news_stories` (section, reliability, reporter,
    dateline, in-world date, issue, lead flag, correction link, review state);
  - adds the publish guard on `articles` and the functions `save_news_story` and `news_transition`
    (website and DM only);
  - adds `campaign_settings.current_location_id` and `current_status`.

  It is additive and lists rollback statements in its header.
- Tests:
  - `tests/db/gazette.test.ts`: workflow, privacy, refusals for assistants and players;
  - `tests/e2e/gazette.spec.ts`: reading, writing, printing, phone layout;
  - `tests/e2e/player.spec.ts`: the network-level privacy scan now includes the Gazette.
- Fonts (self-hosted, OFL-1.1): UnifrakturMaguntia for the masthead, IM Fell English for headlines,
  Old Standard TT for the text. They load only on Gazette pages.

## Review is bound to what you saw (2026-11-14)

- The review and printing buttons in the story editor work on the **saved** story. If the form has
  unsaved changes they refuse and ask you to save first; leaving the page with unsaved text asks too.
- If the story (or its waiting revision) was saved in another tab after you opened it, approving or
  printing from the old tab is refused: reload, read the current text, then approve.
