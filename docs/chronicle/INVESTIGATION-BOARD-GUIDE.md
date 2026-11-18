# Chronicle: Investigation board guide

Status: this describes the Investigation Board on the development branch. It is **not deployed**. Source: migration `chronicle-cloud/supabase/migrations/20261117000300_investigation_board.sql`, `chronicle-cloud/src/pages/BoardPage.tsx`, `src/lib/boardLogic.ts`, `src/lib/boardData.ts`, `src/components/Clues.tsx` (the pin buttons) and `src/pages/dm/Theories.tsx`.

## What the board is

The Investigation Board is one shared board for the whole party. Everyone who is signed in to the campaign (players and the DM) sees the same cards and connections. Open it from the menu (**Investigation board**) or the command palette. The address is `/board`.

The board holds four kinds of card:

- **Pinned page**: a link to something you have found on the wiki, a map, or a clue.
- **Note**: a card with a title and optional details, for anything you want to remember.
- **Theory**: a guess the party is testing. Theories have a status (see below).
- **Connection**: a labelled line between two cards.

A card is not a fact of the story. The board's own text says so: **theories are the party's guesses, not facts of the story.** Nothing on the board feeds the wiki, the search or the knowledge graph. The DM's canon stays on the wiki.

## Adding cards

The toolbar at the top has three add buttons: **Pin a page**, **Add a note** and **Add a theory**. Each one opens a panel.

### Pinning a page

- In the **Pin a page** panel, type into **Find a page to pin** (at least two letters). Matching pages appear as **Pin <page title>** buttons. Choose one.
- You can also pin from a wiki page: the **Save** menu on a page has a **Pin this page** button. Once a page is pinned, the button reads **On the board** and links to the board.
- Clues have **Pin to the board** on the clue document (see the Mystery Studio guide).

A pin stores only what it points to (a kind and an identifier). It does not copy the page's text. The board shows the page's current title and summary, read from the wiki each time you open it.

Rules for pins:

- You can pin only what you can read right now. If you cannot read a page, it cannot be pinned.
- The DM may pin only what **players** can read. The DM's pin therefore never puts a hidden page on the shared board.

### Notes and theories

- A **note** has a title (required, up to 120 characters) and optional details (up to 2,000 characters).
- A **theory** has the same fields, and a status: **Unresolved** (the default), **Solved** or **Disproven**.
- A theory's card says **Theory** and shows its status. The details panel repeats that it is a guess.

New cards get a default colour: notes are amber, theories are violet, pins are parchment. Seven colours are available for any card: parchment, crimson, azure, emerald, amber, violet and slate.

Cards are placed near the middle of what you can currently see, so a new card does not land off-screen.

## Connecting cards

1. Open a card. Its details panel is on the side (or below, on a phone).
2. Choose **Connect to…**.
3. Choose the other card. Optionally write what links them, for example "was seen with" (up to 80 characters).
4. Choose **Connect**.

Connections are straight lines between two cards, with the label written on the line. Two cards can be connected only once, in either direction. Any member can make a connection. Only the person who made it, or the DM, can remove it, with **Remove connection**.

## Sections

Sections group cards by mystery. The **Sections** panel lets you add a section (up to 80 characters) in one of the seven colours. Each card has a **Section** choice in its details. The toolbar's **Show section** filter shows one section, the cards with no section, or everything.

- Anyone can add a section.
- Only the person who made a section, or the DM, can rename or delete it.
- Deleting a section does not delete its cards. They stay on the board with no section.

## Marks

Each card can carry any of four marks: **Suspicious**, **Important**, **Investigated** and **Unconfirmed**. Choose a mark to turn it on, and again to turn it off. Anyone can change marks.

## Who can change what

| Action | Who |
|---|---|
| Add a pin, note, theory or connection | Any member. |
| Move a card | Any member. |
| Change marks | Any member. |
| Set a theory's status | Any member. |
| Change a card's section | Any member. |
| Change a card's **text** (title and details), or a note's or theory's colour | The person who wrote the card, or the DM. |
| Change a pin's colour | The person who pinned it, or the DM. |
| Delete a note or theory, or **Unpin** a pin | The person who wrote it, or the DM. |
| Remove a connection | The person who made it, or the DM. |
| Rename or delete a section | The person who made it, or the DM. |

If a card's author account has been deleted, only the DM can change its text or delete it.

When two people change the same card at the same time, the second change is not applied. The board shows "Someone else changed this card; the board was refreshed." It reloads so you can see the newer version and try again.

## Moving cards

- **Mouse or pen**: press and drag a card.
- **Touch**: drag a card with a finger. Drag an empty part of the board to scroll it.
- **Zoom**: use the mouse wheel, pinch with two fingers, or use the **Zoom in**, **Zoom out** and **Reset view** buttons.
- **Keyboard**: press Tab until a card is focused. Press Enter or Space to open its details. Press an arrow key to nudge the card; each press moves it a small step, and the new place is saved a moment after you stop pressing.

A moved card's new place is saved for everyone. The board refreshes itself about every ten seconds while the tab is open, so you see other people's changes without reloading.

## List view on a phone

On a screen narrower than 600 pixels the board opens in **List view** by default. You can switch between **List view** and **Board view** with the toolbar button.

The list shows each section, then its cards. Each card lists its marks and its connections as text ("Connected to <title> (<label>)"). Choose a card to open its details.

## Save as image

**Save as image** downloads a PNG of the cards you are currently showing, with the section filter applied, and the connections between them. The image is drawn from the board's data, not a screenshot.

## Recent activity

The **Recent activity** panel shows the latest changes, with who made them and when. Each line names the person and the action, for example "<name> added Note: <title>", "<name> connected two cards" or "<name> changed the status of a theory". It shows the 15 most recent.

Activity never shows the title of a pinned page. Only text that a member wrote (the title of a note or theory, a connection's label, a theory status) appears there.

## "This evidence is no longer available"

A pin points to a wiki page, map or clue. The board shows the pin only if that target can still be read by the person looking. If the page has been hidden or removed, the card shows **This evidence is no longer available** instead of its title. Nothing about the hidden page is kept on the board, so the card cannot leak it. The card can still be unpinned.

## Limits

- The board holds up to 500 cards.
- A player can add up to 30 cards in an hour. The DM is not limited this way.
- A card's title and details have length limits, shown in each form.

## The DM's Party theories page

The DM has a read-only page called **Party theories** (menu link, or `/dm/theories`). It lists every theory card on the board, with:

- the theory's title and details,
- who wrote it (and whether it was the DM),
- its status,
- its section,
- the cards it is connected to.

The page says that these are speculation, not canon, and cannot change anything. A link goes to the board, where the theories appear in place.

## Summary for players

- The board is shared. Everyone sees the same cards.
- Pin what you have found, write notes, and guess with theories.
- Connect cards and give the line a label if it helps.
- Only you and the DM can change the words on your own cards. Anyone can move cards, mark them or change a theory's status.
- A theory is a guess. It is not part of the story unless the DM writes it into the wiki.
