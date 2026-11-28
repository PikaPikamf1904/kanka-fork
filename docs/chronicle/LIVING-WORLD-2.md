# Living World 2: pages that know where they appear, an honest home page

What changed for players, why, and how it works. Built on 2026-11-28 from an audit of the live
campaign: the campaign has about forty well-written player pages, but almost none of them use
`[[links]]`, no session has a play date, and the timeline, mysteries and journals are empty. Most of
Chronicle's linking features therefore showed players nothing. The work below makes the existing
writing do more, instead of adding new sections.

## What players see

| Where | Before | Now |
|---|---|---|
| Character, place, NPC and other pages | "What links here" listed only pages with a `[[link]]`, so on real pages it was empty | **Appears in** lists every page whose published text names this one (characters: *In the session journals*, then *Also appears in*) |
| Session journal, side panel "At the table" | Only `[[linked]]` characters and places | Also every character, place, quest and item the session's text names |
| Gazette story, "In the Chronicle" | Only `[[linked]]` pages | Also the pages the story names |
| Knowledge graph | Built from links and saved connections (nearly empty for players) | Pages named in each other's text are joined too (dashed "mentions" lines, as for links) |
| Home, session card | "Latest dated session" never appeared (no session had a date) | Always shows a session: **Latest session** when the play order is known, otherwise **From the session journals**, with a link to read it |
| Home, "Where things stand" | Players saw the placeholder "Somewhere on Krynn" | Shown to players only when the DM has set a location or a status line |
| Home, quests | "Recently updated quests", finished and open mixed | **Open threads**: open quests first with their status; finished ones only counted |
| Home, recently updated | — | **New since your last visit** marks pages first published after the reader's previous visit (this browser only) |
| Home, a failing request | The whole page became an error | That card is left out, the page says what could not load, **Try again** |
| Sessions list and previous/next | Order fell back to the time pages were imported | One play order everywhere (below); numbers only when the order is known |
| Empty timeline | "No events have been recorded yet." | Points to the story so far in the session journals |

No notifications, counts, streaks or new menu entries were added.

## How "appears in" works

Database functions (migration `supabase/migrations/20261128000100_mentions.sql`), all `SECURITY INVOKER`:

- `mentions(page)`: pages whose published text names `page`.
- `named_in(page)`: pages named in `page`'s own text.
- `mention_links(players_only)`: every such pair, for the graph.

**What counts as naming a page** (case-sensitive, whole words): its title; the title without a leading
*The / A / An*; for characters, each name part of four or more letters that is not an honorific or a
common word ("Mara Venn" → *Mara*, *Venn*; "Mayor Raven" → *Raven*; "Swift Claw" → only the full name);
and every alias (redirect) of the page the reader can see ("fargab" → *Fargab*). To teach Chronicle
another name for a page, add a redirect to it in the editor.

**Privacy.** The functions read `articles`, `article_sections` and `redirects` through the caller's own
row-level security: a player only matches against published sections of pages they may read, through
aliases they may read, and only gets back pages they may read. A hidden page named in public text is
never returned, and a DM-only alias is never used for a player. The DM's *view as a player* never uses
these lists on article pages, and the graph's player view asks for player-visible data only.
Tests: `tests/db/mentions.test.ts` (drafts, DM-only sections, hidden pages, DM-only aliases, visitors),
`tests/e2e/mentions.spec.ts`.

**Performance** (local PostgreSQL, 600 synthetic pages with three sections each): the graph's
`mention_links` 1.8 s (one combined pattern per page text; the first version took 21.8 s), a page's
`mentions` 0.7 s, `named_in` under 0.4 s. At the campaign's real size these take milliseconds. Pages show
their text first and load the lists afterwards, so a slow list never delays reading. One combined
pattern takes the longest name where two overlap, so in rare cases an edge is missed (886 of 887 in the
benchmark).

**Limits.** A name that is also an ordinary capitalized word at the start of a sentence can produce a
false "appears in" (it only ever points to a page the reader can read anyway). A nickname that is not
in the title or an alias is not recognised.

## Session play order

`src/lib/sessionOrder.ts`, used by the home page, the Sessions list and the previous/next links:

1. the page's play date, or a date in an infobox field labelled *Date*, *Played*, *Date played* or
   *Session date* (for example `November 10, 2026` or `2026-11-10`);
2. a session number in an infobox field labelled *Session* or *Session number*;
3. otherwise the title.

The order is **known** when every session has a date or a number. Until then the home card says *From
the session journals* rather than *Latest session*, the Sessions list shows no numbers, and the DM sees
a one-line hint there.

**DM step to fix it:** open each session journal in the editor and add an infobox field *Date played*
with the real date (or *Session* with its number). Nothing else is needed.

## New since your last visit

`src/lib/lastVisit.ts`. A visit lasts until the reader has been away for two hours; the home page then
remembers when the previous visit began, in this browser, per signed-in user (people sharing a device
are kept apart). Pages whose publish time is later are marked. The first visit on a device marks
nothing. Nothing is sent to the server.

## Gazette package import fix

A package's notes or letters placed after the last story used to be read as part of that story and
would have been printed. A top-level `# ` heading now ends a story (`src/lib/gazettePackage.ts`,
regression test in `src/lib/gazettePackage.test.ts`).

## Deploying (owner steps)

1. Apply `20261128000100_mentions.sql` to the hosted project **before** deploying the website. It only
   adds functions (no tables, no data changes). Rollback statements are in its header.
2. Reload the API schema if your host does not do it automatically (`notify pgrst, 'reload schema';`).
   The website tolerates the functions being missing (the lists are simply empty), but each page would
   log a 404 in the browser console until they exist.
3. Deploy the website.
