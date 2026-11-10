# Overnight status

## Branch

- Work branch: `fable/chronicle-overnight-lore`, created from `feature/chronicle-cloudflare-supabase`
  at `f94f850663ad37edac19e82522d300ff8e379037`.
- The deployed branch, PR #16 and the hosted database were not changed.
- Commits on this branch, oldest first: lore pack and loader (`91154c0df`), importer hardening
  (`b95f4a297`), DM desk review queue (`9aa5c518f`), then this handoff.

## Completed

1. **Source check.** None of the eight named campaign files is reachable (not in the repository,
   on any branch, in the working machine or in the hosted database).
2. **Lore pack**: 28 draft pages and 16 connections, built only from the brief. 75 statements,
   each with a certainty level: 0 confirmed, 19 reported by the DM, 8 needing verification,
   10 planned, 38 uncertain.
3. **Lore-pack loader** with validation, a generated review document, staging and rollback.
4. **Kanka importer**: survives malformed files, privacy flags fail closed, paged reads.
5. **DM desk**: full review queue with a count and a filter by type.
6. Handoff documents in this folder.

## Test results (all local, synthetic data)

| Suite | Result |
|---|---|
| Unit (`npm test`) | 61 passed (28 before) |
| Database (`npm run test:db`) | 89 passed (83 before); the 15 audit tests are unchanged |
| Browser (`bash scripts/e2e-local.sh`) | 17 passed |
| Lint, typecheck | clean |
| `npm run lore:check` | pack valid |
| Kanka dry run on the synthetic fixture | 4 articles, all DM-only |

Not run: anything against the hosted project or the live website; mobile layout checks beyond
the existing browser suite.

## Unfinished

- The lore is thin because the sources were missing: most pages are honest stubs with questions.
- No real Kanka export has been tested.
- Maps and timeline: guidance only (`NEXT_ACTIONS.md`), nothing built.
- The live checks listed in `NEXT_ACTIONS.md`.

## Blockers

- Campaign source files are not available to the session.
- The live website cannot be reached from the working machine, so it was not tested.

## Next steps

See `NEXT_ACTIONS.md`.
