# Summary

Branch `fable/chronicle-human-first-overnight`, built on PR #18 (`cf9d26ad9`) with PR #17's branch
merged in. Nothing here is deployed, and the hosted database was not written to.

## What changed

- **Lore import screen (`/dm/import`) is now safe to use.** It lists every bad entry instead of
  stopping at the first, lets the DM pick pages, shows what will happen to each, shows progress, and
  reports per-page results. A page that fails is removed; a page left half-made by a crash is
  recognised and replaced on the next run. Existing pages are never changed. Whatever the file says,
  everything arrives as a DM-only draft.
- **First Dragonlance lore pack** (`chronicle-cloud/lore/dragonlance/pack.json`): 26 draft pages,
  36 sections, 21 connections. Written from the DM's two briefs only, because none of the campaign
  documents were available. Every statement carries a source and a certainty level; none is marked
  confirmed.
- **Home page:** a short getting-started list for the DM when the wiki is empty, a plain message for
  players, a quests panel, no empty panels, dates written out.
- **Reading:** article text and the lead paragraph have a comfortable line length.
- From PR #17 (merged in): the command-line lore loader, Kanka importer hardening, DM review queue.

## Usable now (locally)

Import the pack at `/dm/import`, review the drafts from the DM desk, edit and publish page by page.

## Blocked or not done

- Campaign source documents: none available, so the lore is thin and full of questions.
- MCP: design notes only (`MCP_DESIGN.md`); no code.
- Artwork workflow, maps, timeline, accessibility pass: not started.

## Needs the DM

1. Read `LORE_EDITORIAL_REVIEW.md` and answer its questions (83 of them; the first ten matter most).
2. Approve importing the pack into the live wiki (private drafts only) once satisfied.
3. Decide whether to merge this branch into PR #18's branch.
