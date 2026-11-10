# Import review

## Formats accepted at `/dm/import`

Simple:

```json
{ "articles": [ { "slug": "gears", "title": "Gears", "type": "character", "subtitle": "", "summary": "",
  "sections": [{ "heading": "In the story", "body": "Markdown text" }],
  "infobox": [{ "label": "Nature", "value": "Mechanical" }],
  "notes": [{ "title": "Provenance", "body": "Private note" }] } ] }
```

Lore pack (`chronicle-cloud/lore/*/pack.json`): adds `facts`, `questions` (both become private DM
notes) and `relations` between pages of the same pack.

## Validation (`src/lib/lorePackage.ts`)

- File: valid JSON, at most 2 MB, 1 to 200 articles.
- Per entry: address of lower-case letters, digits and single hyphens (max 160); title 1 to 200;
  one of the nine types; 1 to 30 sections with text; up to 30 infobox fields; length limits on every
  field; no control characters. Unknown properties are dropped.
- Bad entries are listed by position and name; good entries can still be imported.
- Same address twice: the second is refused. Same title twice: warning.
- `visibility` or `status` anywhere in the file is ignored, and the DM is told the file asked for it.
- Links to pages that exist neither in the file nor in the wiki are listed.
- Connections must join two different valid pages of the package.

## Writing

- Uses the DM's own signed-in session; the database's rules decide what is allowed. No server key.
- Each page: insert with mark `import:pending:<slug>`, then sections, infobox and notes in one request
  each, then the mark becomes `import:<slug>`. Everything DM-only and draft.
- A failure deletes the half-made page. If even that fails (browser closed, network gone), the
  pending mark tells the next import to replace it.
- The list of existing pages is fetched again just before writing; existing pages are never changed.
- Connections are created only between pages that exist after the run; duplicates are skipped.
- Stop button finishes the current page and skips the rest.

## Tests

- `src/lib/lorePackage.test.ts`: 13 unit tests (valid, empty, wrong shape, malformed entries, bad
  addresses, duplicates, 200 vs 201 articles, unsupported type, empty sections, long fields, special
  characters, extra properties, injected visibility/status, broken connections, missing links).
- `tests/e2e/import.spec.ts`: 4 browser tests on the local stack: non-JSON and empty files; preview
  with bad entries and an injected failure leaving nothing behind; a simulated crash recovered on the
  next run; a repeat import creating nothing; a player finding none of it by list, address, search or
  connection.
- Not covered: navigating away mid-import (only a browser warning is shown).

## Importing the Dragonlance pack (not done)

1. Sign in as the DM on the live site; open DM desk → Import a lore package.
2. Choose `chronicle-cloud/lore/dragonlance/pack.json`. Expect 26 pages, 21 connections, no errors.
3. Import. All 26 arrive as private drafts in the DM desk review list.
4. Edit and publish page by page. Never publish the Dragon Nest pages before they are played.

This needs this branch deployed first; the live site still has the older version.
