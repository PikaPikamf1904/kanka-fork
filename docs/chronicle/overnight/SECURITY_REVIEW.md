# Security review (overnight branch)

## Areas checked

- New lore-pack loader: can it create anything a player can see? Can it overwrite DM work?
- Kanka importer: privacy decisions on unusual input.
- DM desk change: does the new list read anything through a different path?
- Regression: the full database suite, including the 15 audit tests (file unchanged).

## Defects found and fixed

| Severity | Defect | Fix |
|---|---|---|
| Medium | Kanka importer read an unrecognised privacy value (for example `"yes"`) as "not private". With `--trust-public-entities` such an entry, post or attribute would have been imported player-visible. | Only `false`, `0`, `"0"` count as public; everything else is private. Tested. |
| Low | One malformed export file aborted the whole import with a crash. | Bad files and parts are skipped and reported. Tested. |
| Low | Importer could not see more than 1000 existing rows on the hosted service, so a large re-import failed part-way. | Paged reads. |

No defect was found in the deployed application or the database rules.

## Tests added

- `tests/db/lore-pack.test.ts`: after staging the pack, a player gets zero results from article
  lists, full-text search for pack keywords, title suggestions, sections, connections, link
  records, DM notes and address look-up of a spoiler page.
- `importer/lore-pack.test.ts`: a pack asking for player visibility or published status is refused.
- `importer/robustness.test.ts`: damaged entries stay DM-only; odd privacy flags fail closed.

## Not changed

- No migration was added or edited. The eight hosted migrations are untouched.
- No hosted data was written. Hosted reads were limited to row counts.
- Secrets: none read, printed or committed.

## Remaining risks and manual checks

1. **Second member on the hosted project.** A row count shows 2 members and 1 access code, where
   the last check showed 1 member. If you did not enroll a test device yourself, look at
   Player access in the DM tools and remove the device.
2. **Page titles are spoilers.** "The four metallic dragon eggs" must not be linked from
   player-visible text. The editor warns about links to hidden pages; it cannot judge a title.
3. Still unverified on the live site: DM two-step sign-in, a full enrollment with a real code, and
   player restrictions through a real session.
4. Development-tool advisories from before are unchanged.
