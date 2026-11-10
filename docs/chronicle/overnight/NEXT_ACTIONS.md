# Next actions

## Needs the DM (in this order)

1. **Check the second member row** on the hosted project (see `SECURITY_REVIEW.md`, item 1).
2. **Answer the questions in `LORE_REVIEW.md`.** The fastest wins: who the current player
   characters are; whether "Charlie" is Charlie Jennings and what he did; who the six unassigned
   figures are; where the party is based now.
3. **Supply the source files** listed in `CANON_AUDIT.md` (upload them to the session or commit
   them to a private folder). With them the pack can move statements to "confirmed" and gain real
   detail.
4. **Approve staging the pack** on the hosted wiki (procedure in `IMPORT_REPORT.md`). It only
   creates DM-only drafts.
5. Finish the live checks: DM two-step sign-in, one full enrollment, one player session.

## Next implementation steps

1. Update the pack from the DM's answers and the source files; regenerate `LORE_REVIEW.md`
   (`npm run lore:check -- --review ../docs/chronicle/overnight/LORE_REVIEW.md`).
2. Write the player-safe Halloween recap as its own section, separate from the DM section, so it
   can be published alone.
3. Run a real Kanka export through `npm run import:dry-run` and read the report.
4. Merge this branch into `feature/chronicle-cloudflare-supabase` when reviewed (that deploys it).

## Maps and timeline: how to prepare them safely

Nothing was built here; the existing map and timeline tools are enough to start.

- **Do not place anything yet.** No coordinates or distances are known from the available
  sources. A marker's position is a statement of fact; wait for the DM's map.
- **One regional map first** (the area the party actually operates in), uploaded by the DM in the
  map editor. Maps start as DM-only drafts.
- **Markers**: create each as DM-only, link it to its article, and switch a marker to "players"
  only when the place has been visited. A marker linked to a hidden article is hidden from
  players automatically, whatever its own setting.
- **Never create a marker for the Dragon Nest facility on a player-visible map** until the
  operation has been played; use a separate DM-only map for planning.
- **Timeline**: the pack has a "Campaign timeline" page. When session dates are known, add
  timeline entries in the DM tools (DM-only, draft) and link each to its session article; an entry
  linked to a hidden article stays hidden.
- These hiding rules are covered by the existing database tests (hidden markers, hidden maps,
  timeline entries about hidden pages).

## Ideas not started

- A lore-pack field for player-safe text, so a pack can carry both versions of a recap.
- Import reference columns on timeline entries so packs can create them safely (needs a
  migration).
- Kanka images and maps, once a real export shows their format.
