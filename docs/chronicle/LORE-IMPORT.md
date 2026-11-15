# Importing campaign lore

Chronicle can take a large collection of notes and organise it into wiki pages. Nothing is saved
until you review it, and everything an import saves is a **DM-only, unpublished draft**.

## Two ways in

- **On the website:** DM desk → *Import lore* → *a staged import* (`/dm/import/batches`). Choose up
  to 200 files (Markdown `.md` or lore packages `.json`, 5 MB in total), check what was read, and
  *Stage for review*.
- **Through an assistant:** ask it to import your notes; it calls `chronicle_stage_import`, which
  stages the batch and gives you its review link. The assistant can read the batch and explain it
  (`chronicle_get_import_batch`), but only you can approve and save.

The older one-file package import (`/dm/import`) still works for a single JSON package.

## Writing notes

One page per file, with optional details at the top:

```markdown
---
title: Kalaman
type: location            # character, location, faction, item, quest, session, event, lore
canon: confirmed          # confirmed, uncertain, rumor or planned
tags: [Solamnia, Cities]  # existing categories are linked; unknown ones are only reported
aliases: [The Harbour City]
---
A one-paragraph summary.

## History
Text. Link pages with [[Lord Bakaris]] or [[lord-bakaris|the lord]].

## Facts
- Ruler: …

## DM notes
Stays a private note.
```

Or several pages in one file, each starting with `# Title`. A `## Facts` (or `Infobox`,
`Details`) section becomes infobox facts; `## DM notes` (or `Secrets`, `GM notes`) becomes private
notes. Files in a folder named `characters`, `locations`, `factions`… take that type.

**Canon.** Material is *unconfirmed* unless it says `canon: confirmed`. `rumor` is for in-world
hearsay (for example a Gazette story): its sections are headed "Rumour (unconfirmed)" and its
source is recorded as uncertain. `planned` is for prepared material not yet played. Every saved
section and fact records its source file.

## Reviewing a batch (`/dm/import/<id>`)

- **Totals:** new pages, additions to existing pages, possible duplicates, conflicting facts,
  stated and suggested connections, already saved.
- **Each entry:** proposed type (and whether it is a guess, with the reason; change it if wrong),
  canon level, source file, and what would happen:
  - *New page*: approved by default.
  - *Adds to an existing page* (same address, a redirect, the same title or an alias): **not
    approved unless you tick it**. It would only add DM-only sections headed "(imported from …)",
    facts whose label the page does not have yet, and private notes. A fact that disagrees with
    the wiki is listed as a conflict and **never changed**; saving adds a private note about it.
  - *May be the same subject as* another entry of this import: check before approving both.
  - Links to pages that do not exist, and categories that do not exist, are listed.
- **Connections:** stated ones (from JSON packages) are approved with their pages; ones suggested
  from a link are not approved unless you tick them. Connections are DM-only.
- **Filters** and *Approve all shown* / *Reject all shown* for working through hundreds of entries.
- **Save approved entries as DM-only drafts:** saves in parts of 20 pages, re-reading the wiki
  before each part. If a page changed while you were reviewing, that part is refused and nothing
  in it is saved; review and save again. A lost connection is retried once with the same key, so
  nothing is saved twice. If saving stops, *Continue saving* resumes where it stopped; parts that
  were saved but not recorded (closed tab) are found again in Chronicle's own record.
- **Download report:** a Markdown summary of every entry, decision, conflict and saved part.
- **Discard import:** removes the batch; pages already saved stay as drafts.

After saving, each page is a draft on the DM desk. Read it, add artwork, and publish it from its
editor when it is ready. An import never publishes and never changes what players see.

## Limits

200 files, 1 MB per file, 5 MB and 1,000 entries per batch; 30 sections and 30 facts per page.
Split larger collections into several batches.

## Verified

- `src/lib/loreImport.test.ts` (17): parsing, classification, matching, conflicts, rumours,
  bounded parts, stable keys, connections waiting for both pages.
- `tests/db/import-batches.test.ts` (7): who can see and change batches; drafts saved once even
  when every part is retried; additions never replace text or facts and need the current
  version; an interrupted 45-page import resumes from Chronicle's own record.
- `tests/db/mcp-campaign.test.ts`: staging and reading batches through MCP.
- `tests/e2e/lore-import.spec.ts`: desktop and phone review, a lost answer, players see nothing.
