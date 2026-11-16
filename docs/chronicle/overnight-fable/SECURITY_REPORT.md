# Security report

## Threat model

A signed-in player who knows the routes, table names and page addresses, using the API directly.

## Executed (local stack, synthetic data)

| Check | Result |
|---|---|
| Imported pages are DM-only drafts regardless of `visibility`/`status` in the file | Pass (unit + browser) |
| Player finds no imported text by home, lists, connections, direct address, or search | Pass (browser, every API response scanned for a marker string) |
| Player opening `/dm/import` gets no import form | Pass (browser) |
| Lore pack staged by the command-line loader is invisible to a player by list, search, suggestions, sections, connections, link records, notes, address lookup | Pass (database suite) |
| Dragon Nest secret terms absent from every non-planning page of the pack | Pass (unit) |
| Full database suite including the 15 audit tests | 89/89 pass; audit file unchanged |

## Findings

- PR #18 could leave a half-made page that later runs treated as finished. Fixed (pending mark).
- No new authorization path: the import uses the DM's session and existing table rules; no
  migration, no new database function.

## Remaining risks

- Page titles can be spoilers. "The four metallic dragon eggs" must stay unpublished.
- A DM could manually edit a pending mark away; harmless, but the page would no longer be replaced.
- MCP not built, so not assessed.
- Hosted project: 2 members at last check where 1 was expected; check Player access.
