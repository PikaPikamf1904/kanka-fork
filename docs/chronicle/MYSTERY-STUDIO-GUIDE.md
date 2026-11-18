# Chronicle: Mystery Studio guide

Status: this describes the Mystery Studio on the development branch. It is **not deployed**. Source: migration `chronicle-cloud/supabase/migrations/20261117000200_mystery_studio.sql`, `src/pages/dm/MysteryStudio.tsx`, `src/pages/MysteriesPage.tsx`, `src/components/Clues.tsx`, `src/lib/clues.ts` and `src/lib/mysteryData.ts`.

The Mystery Studio lets the DM prepare clues that players find between sessions. It is a layer on top of the wiki: a clue is a document (a letter, a notice, a symbol) that turns up on a wiki page or a map when it is released.

## Part 1: for the DM

### Where it lives

- **Mystery Studio** (route `/dm/mysteries`, also in the command palette as "Mystery Studio").
- **Mysteries** panel on the DM desk. It shows how many releases are scheduled, and when the next one is due, with a link to the studio.

The DM's account can read everything. Nothing in the studio is shown to players until you release it.

### The overview

The top of the studio shows counts: scheduled, released and clues in all. It also has:

- **Waiting to be released**: scheduled clues, soonest first.
- **What players have found**: each discovery, with the player's name, the clue and the time. If a player has since been removed, it reads "A former player".

### Mysteries

Choose **New mystery**. Each mystery has:

| Field | Who sees it | Notes |
|---|---|---|
| Working title | Only you | Your name for the mystery. |
| Title players see | Players | If blank, players see "An unnamed mystery". |
| Summary | Only you | The migration keeps summaries and DM notes DM-only. |
| DM notes | Only you | Up to 20,000 characters. |
| Colour | Players, once visible | Used for the mystery's card on the Mysteries page. |
| Status | Derived | See below. |

Mystery titles, summaries and DM notes never reach players. Players see only a spoiler-safe name, and only once at least one of the mystery's clues is visible to them.

### Mystery statuses

| Status | What players see |
|---|---|
| **Draft** | Nothing. None of its clues are shown, even released ones. |
| **Active** | Its released clues, on the pages and maps they are attached to, and on the Mysteries page. |
| **Concluded** | The same as Active. Use it when the mystery is solved, so its clues stay available to read. |
| **Archived** | Nothing. Use it to put a mystery away without deleting it. |

Use **Archive** to retire a mystery. **Restore** returns an archived mystery to Draft. **Delete** removes the mystery and all its clues. It asks you to confirm, and players who found a clue lose it too.

### Clues

Open a mystery and choose **Add a clue**. A clue has:

- **Kind**: Letter, Document, Notice, Correspondence, Symbol or Note. The kind sets the look of the document.
- **Clue title**: up to 120 characters.
- **Text (Markdown)**: up to 20,000 characters. A preview shows the document as players will see it.
- **Source line** (optional): an in-world signature, up to 160 characters. For example: "Sealed with the mark of the Blue Wing".
- **Where it is found**:
  - **Nowhere in particular**: the clue is listed on the Mysteries page only.
  - **On a page**: search for the page and attach to it.
  - **On a map**: choose the map.
- **Needs this clue found first** (optional): another clue in the same mystery. A player can see this clue only after finding that one.
- **Order**: a number that sets the order in lists.
- **Release at a set time** (optional): see "Release" below.

A clue attached to a page or map is visible to a player only if that player can read that page or map. If the page is hidden from them, the clue is hidden too.

### Release, schedule and withdraw

Each clue is in one of three states, shown on its row:

- **Not released**: hidden from players.
- **Scheduled**: it will be released at the time you set. Nothing needs to run for this to happen. The database checks the time every time a player reads.
- **Released**: visible to players, subject to the rules above.

Buttons on each clue:

- **Release now** sets the clue released immediately.
- **Withdraw** hides a released or scheduled clue again, and clears its scheduled time.
- **Edit** and **Delete** as usual.

### Hints

Each clue can have hints. A hint has text (up to 2,000 characters) and its own release rules: **Release hint now**, **Withdraw hint**, or a **Release at** time. Players see a hint only when it is released, and only in the clue's document, under "Hints".

### Preview as a player

Under **Preview as a player**, choose a player. The studio then lists the clues that player can see right now, each marked "found" or "not found yet". If the player can see nothing, the studio says so.

The preview is computed by the database for that player. It uses the same rules as the player's own view.

### Visibility rules (from the migration header)

A player can select a clue only when **all** of these hold:

1. Its mystery is **Active** or **Concluded**.
2. It has been released by hand (`released_at`), or its scheduled time has passed (`release_at`).
3. The page or map it is attached to is readable by that player.
4. Its prerequisite clue, if any, has been discovered by that player.

These are checked in the database on every read. Unreleased clues never reach a response, a search, a count or the board. No background job releases anything.

Other facts from the migration:

- Players see a mystery's name only through `mystery_index()`, and only when at least one of its clues is visible to them.
- `dm_preview_clues(player)` lets the DM see exactly what one player would see.
- Assistants (OAuth and MCP connections) can neither read nor write any of it.
- Clues are not part of the site search, and they are not in the knowledge graph. The search and graph code does not read the clue tables.

## Part 2: for players

Clues turn up while you read. You will know when one is there.

- **"Something catches your eye…"** appears on a wiki page or a map when a clue is attached to it and you can see it. Choose it to open the document.
- Opening a clue **records that you found it**. The button then shows the clue's title and kind, marked "you found". Finding is recorded once, and it is not an error to open a clue again.
- A clue's document may have **Hints** under it. You see the hints the DM has released.
- **Pin to the board** on a clue document adds it to the Investigation Board, where you can connect it to other cards.
- Some clues need another clue found first. They do not appear until you have found the earlier one.
- The **Mysteries** page (`/mysteries`, in the menu and the command palette) lists the mysteries you have started to uncover. Each card says how many clues you have found out of the ones you have seen. A clue you have seen but not opened says "Not found yet. Have another look at <page>" if it is attached to a page.

## Worked example (synthetic names)

Imagine a mystery about barrels that go missing between two towns.

**Setup (DM).**

1. Create a mystery. Working title: "Barrels to Hollin Ford". Title players see: "The Quiet Barrels". Status: **Active**.
2. Add clue 1: kind **Letter**, title "A note about forty barrels". Text: a short letter asking for forty barrels of lamp oil to be sent to Hollin Ford by the new moon. Source line: "Signed with a single initial". Attach it to the wiki page **Hollin Ford Quay**. Choose **Release now**.
3. Add clue 2: kind **Symbol**, title "A gull with a broken wing". Text: a description of a mark chalked on a door. Attach it to the wiki page **The Tallow Chandlery**. Set **Needs this clue found first** to clue 1. Set a release time for next Thursday, or leave it unscheduled and choose **Release now** when you are ready.
4. Add a hint to clue 2, released now: "The chandler's ledger mentions the same gull."

**What the player does.**

1. Ada opens the **Hollin Ford Quay** page. A button reads "Something catches your eye…". She opens it, reads the letter and sees its source line. The letter is recorded as found, and the button now shows its title.
2. She chooses **Pin to the board**. The letter becomes a card on the Investigation Board.
3. She opens **The Tallow Chandlery**. The gull clue is there, because she has found the letter. She opens it and reads the hint.
4. She pins the gull clue too. On the board she connects the two cards with the label "same hand?".
5. She adds a theory card, "The chandler is paying the ferrymen", and connects it to the gull card. The theory is a guess. It is not part of the story unless the DM writes it into the wiki.
6. On the **Mysteries** page, "The Quiet Barrels" now shows "2 clues found of 2 seen".

**What the DM sees.** In the studio, the "What players have found" list shows Ada's two finds with the times. The DM's **Party theories** page lists the theory card, with its connection.

Nothing here appears in site search or the knowledge graph. The clues are found on the pages, and the board is where the party keeps its connections.
