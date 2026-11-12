# Chronicle beta

**Beta site:** https://beta.chronicle-wiki-preview.pages.dev (Cloudflare Pages builds the `beta`
branch there automatically; production is not affected).

The beta site runs the newest features against the **same live Chronicle data and sign-in** as the
main site. Nothing in the beta features writes to the database: they only read what the signed-in
person may already read (Row Level Security applies exactly as on the main site), and anything
they remember is kept in that browser on that device.

Player sign-up with an access code does **not** work on the beta site, because preview builds have
no server keys. Sign in as the DM with your account. In practice the beta site is a DM preview.

## The five features

| # | Feature | Where | Stored |
|---|---|---|---|
| 1 | **Quick jump**: fuzzy-find any page, place or DM tool | <kbd>Ctrl</kbd>+<kbd>K</kbd> / <kbd>⌘K</kbd>, <kbd>/</kbd>, or ⤳ in the header | nothing |
| 2 | **Link previews**: picture, type and summary of a linked page | rest the mouse on, or Tab to, a link in article text | nothing |
| 3 | **Since your last visit**: pages new or changed since you last opened Chronicle | main page | the time of your last visit, this device |
| 4 | **Connections web**: the connections drawn as an interactive web | Connections → **Web** | nothing |
| 5 | **Table screen** (DM): initiative with HP and conditions, dice (advantage, `4d6kh3`), pinned pages, table notes | sidebar → Table screen, or `/dm/table` | this device only |

`/beta` lists them with "Try it" buttons. On the beta site a **BETA** badge in the header links there.

Privacy notes:
- Quick jump and link previews only list pages the reader can open. A player never sees DM-only
  pages or DM tools there (tested).
- The caches behind quick jump and previews are cleared on every sign-in and sign-out, so a
  shared device never shows the previous person's pages.
- Table screen notes and pins stay in the DM's browser. Don't use the table screen on a device
  players also use, or clear the notes afterwards.

## Keeping or dropping a feature

Everything lives in `chronicle-cloud/src/beta/`, plus a few connecting lines:

| Feature | Files | Connected in |
|---|---|---|
| Quick jump | `QuickJump.tsx`, `fuzzy.ts`, `api.ts` (`pageIndex`) | `components/Layout.tsx` |
| Link previews | `PreviewLink.tsx`, `api.ts` (`getPreview`) | `components/MarkdownImpl.tsx` |
| Since your last visit | `WhatsNew.tsx`, `api.ts` (`changedSince`), `store.ts` | `pages/HomePage.tsx` |
| Connections web | `ConnectionsWeb.tsx`, `graphLayout.ts` | `pages/BrowsePages.tsx` (List/Web toggle) |
| Table screen | `TableScreen.tsx`, `dice.ts`, `initiative.ts` | `App.tsx` route `/dm/table`, sidebar link in `Layout.tsx` |
| Shared | `beta.css`, `store.ts`, `BetaPage.tsx`; cache clearing in `lib/session.tsx` | `App.tsx` route `/beta` |

To drop one, delete its files and its connecting lines; the rest keeps working.

## Tests

- `src/beta/beta.test.ts` (unit, 9): fuzzy matching, dice expressions and limits, initiative order,
  hit points and saved-state checks, graph layout.
- `tests/e2e/beta.spec.ts` (browser, 6): each feature on desktop and phone, with player checks
  for quick jump, link previews, what's new and the connections web; players cannot open the
  table screen.
- Screenshots (synthetic sample world): `docs/chronicle/screenshots-beta/`.
