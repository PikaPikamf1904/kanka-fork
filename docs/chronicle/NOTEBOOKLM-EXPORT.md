# Chronicle knowledge export (for NotebookLM)

A DM-only page that turns everything in Chronicle into Markdown files for keeping, and for use as
sources in NotebookLM ("The Vault"). It reads; it never writes.

## Where it is

DM desk → **Export knowledge (NotebookLM)** (`/dm/export`). The page has two downloads and five
choices:

| Download | What you get | For |
|---|---|---|
| **NotebookLM knowledge document (Markdown)** | `Chronicle-Knowledge-YYYY-MM-DD.md`, everything in one file. If it would exceed NotebookLM's limit, a ZIP of `Chronicle-Knowledge-Part-1-of-N.md` … instead. | Uploading to NotebookLM |
| **Complete Chronicle archive (ZIP)** | `Chronicle-Export-YYYY-MM-DD.zip`: one Markdown file per page, in folders by kind, plus overview, timeline, connections, mysteries, maps, DM notes and planning. | Keeping and browsing (NotebookLM cannot open a ZIP) |

| Choice (all on by default) | Off means |
|---|---|
| Include DM secrets | Only what players can read in the wiki: no DM-only or draft pages, sections, facts, connections, categories, former addresses, timeline entries or map pins; no mysteries, dossiers or DM notes. |
| Include future campaign plans | Leaves out sections, facts and pages marked "planned, not yet played". |
| Include DM notes and research | Leaves out DM notes, the DM notes on mysteries, and your own Knowledge Studio collections. |
| Include session history | Leaves out session journals and the timeline. |
| Include saved connections | Leaves out connections. |

## Using it with NotebookLM

1. In Chronicle, as the DM: DM desk → **Export knowledge (NotebookLM)** → **NotebookLM knowledge document**.
2. Open your notebook (The Vault) in NotebookLM → **Add source** → **Upload** → choose the `.md` file.
   If you got a ZIP of parts, unzip it and upload each `.md` file (each is one source).
3. To refresh after more sessions: export again, delete the old source in NotebookLM, upload the new one.

NotebookLM's limits (Google's help, checked 2026-11-24): 500,000 words per source, 200 MB per
uploaded file, 50 sources per notebook on the free plan. The export starts a new part at 400,000
words and never splits a page across parts.

NotebookLM is a Google service: uploading the DM export gives Google a copy of your secrets under
your Google account's terms.

## What each page contains

Title, Chronicle ID (the page's address), type, visibility, Gazette details, categories, former
addresses, import reference, last update, a link back to Chronicle, the summary, the facts, every
section, its connections (from and to the page), timeline entries, maps, and DM notes. Wiki links
become links to the page (in the archive, to the other file; in the NotebookLM document, to the page
in Chronicle). Pictures become `[Picture: caption]`; no image or signed address is included.

## Labels: facts versus ideas

Each section and fact carries two labels, taken only from what Chronicle stores:

| Your category | Chronicle's stored data | Label in the export |
|---|---|---|
| Established Dragonlance lore | provenance `official_reference` | Established lore (official reference) |
| Confirmed campaign canon | provenance `table_confirmed` | Campaign canon (confirmed at the table) |
| DM-approved secret | provenance `dm_confirmed` on DM-only material | DM-confirmed (a DM-approved secret) · DM only |
| — | provenance `dm_confirmed` that players can read | DM-confirmed · Known to players |
| — | provenance `transcript_uncertain` | From session transcripts, not yet confirmed |
| Planned future content | provenance `planned_unplayed` | Planned, not yet played |
| Brainstorming / speculation | nothing stores this | not guessed: DM notes and anything without provenance are **Unclassified** |

Visibility is "Known to players", "DM only (secret)" or "DM only (draft)", using the same rules as
the database. Gazette stories keep their reliability ("rumor" and "satire" are flagged as not
established fact). The README in each export counts every label, including those that nothing
carries. In production today no record is marked `official_reference` or `table_confirmed`, so those
two categories are empty until you mark material that way.

## Connections

Only saved connections (the `relations` table) are connections. Each is written exactly as stored,
source → kind → target, with the custom description in quotes, who may see it, and the IDs of both
pages, the kind and the connection itself. Mentions in text are never turned into connections. A
connection to a page that is not in the export (for example a session, with session history off)
is left out and counted.

## Never exported

Players' private journals, scratchpads, the investigation board, players' own Knowledge Studio
collections (even shared ones), bookmarks, reading lists, feedback, accounts, devices, access codes,
invitations, revisions, import batches, sign-in data, and pictures. The loader cannot read them: they
are not in its list of tables (`TABLES_READ` in `src/lib/knowledgeExport/load.ts`), and a test checks
the list.

## Security

- **No export endpoint and no server-side copy.** The file is built in the DM's browser from the
  DM's own reads and saved on the DM's device. Nothing is uploaded, stored, cached or logged by
  Chronicle, Cloudflare or Supabase; the page logs no content and errors show only a message.
- **The database decides.** Every read is an ordinary query under the signed-in person's Row Level
  Security, the same rules that guard the wiki. There is no service key in the browser.
- **DM check.** The page is under `/dm` (players get "not found"), and the loader refuses anyone whose
  own membership row is not an active DM. A player cannot pass that check by claiming the DM's id:
  players cannot read the DM's membership row. Even code changed to skip the check would only get
  what that person can already read in the wiki (tested by reading every table directly as a player).
- **Read-only.** Only `select` queries; a test compares fingerprints of the content tables before and
  after an export.
- **Complete or nothing.** Each table is counted, then read in ordered pages; if the numbers differ
  (an edit during the export, or a server row limit), the export stops with an error instead of
  saving a file with gaps.

## Size

The whole wiki is read into memory in the browser (a few MB for thousands of pages) and written as
text; a test builds 3,000 pages with 12,000 sections in well under the time limit. There is no
upload, so a large export costs nothing on the server.

## Tests

- `tests/unit/knowledgeExport.test.ts`: the builder on a synthetic campaign (labels, connections,
  links, escaping, file names, duplicates, choices, empty and large campaigns, splitting, and the
  committed sample below).
- `tests/unit/zip.test.ts`: the archive opens in a standard ZIP reader with UTF-8 names intact.
- `tests/db/knowledge-export.test.ts`: the real loader through the real API with signed tokens for
  the DM, a player, a revoked player and an anonymous visitor.
- `tests/e2e/knowledge-export.spec.ts`: real sign-ins and real downloads, on desktop and a phone.

## Sample

`docs/chronicle/notebooklm-export-sample/` is the export of the synthetic test campaign
(`src/lib/knowledgeExport/sample.fixture.ts`): the archive under `Chronicle-Export/` and the
NotebookLM document `Chronicle-Knowledge.md`. Regenerate it with
`UPDATE_SAMPLE=1 npx vitest run --project unit tests/unit/knowledgeExport.test.ts`.
