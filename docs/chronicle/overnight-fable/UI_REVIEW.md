# UI review

Checked from the existing screenshots (`docs/chronicle-cloud/screenshots`) and the source. No new
screenshots were taken; the browser suite does not keep them.

## Problems found

1. A new wiki's home page showed empty "Important characters" and "Important places" panels.
2. Players saw the same empty page with no explanation.
3. Quests did not appear on the home page at all.
4. Dates were shown as `10/17/2026` (ambiguous between countries); an invalid date would show "Invalid Date".
5. Article text ran the full width of wide screens.
6. The import screen had a seven-column-wide table with no way to choose pages.

## Changed

- Empty wiki: a four-step getting-started list for the DM, a one-line message for players. Panels
  with nothing in them are hidden.
- Quests panel (five most recently updated) on the home page.
- Dates written out ("17 October 2026") through one helper.
- Article paragraphs and lists limited to about 70 characters per line; lead paragraph slightly larger.
- Import screen as described in `IMPORT_REVIEW.md`; the table scrolls inside its panel on phones
  (the browser test checks there is no horizontal page scroll).

## Tested

`tests/e2e/home-empty.spec.ts` (new): DM guidance and player message on an empty wiki, no empty
panels, no horizontal scroll. The existing suite covers phone and tablet layouts of the main pages.

## Not done

Artwork workflow (credit, focal point, broken-image fallback), keyboard and screen-reader pass,
reduced-motion check, other date displays in DM tools (access codes, revisions).
