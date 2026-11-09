# RLS test matrix

All tests run against real PostgreSQL 16 with Supabase's roles and init scripts, GoTrue,
PostgREST and storage-api (`chronicle-cloud/scripts/local-stack.sh`). Database tests switch to
`anon`/`authenticated` with JWT claims exactly as PostgREST does. Browser tests drive the built
app through Cloudflare's runtime (`wrangler pages dev`).

Legend: ✔ allowed and tested, ✘ refused and tested.

| Data / action | Anon | Signed-in non-member | Revoked device | Player | DM (no MFA) | DM with MFA, aal1 | DM with MFA, aal2 |
|---|---|---|---|---|---|---|---|
| Published player articles | ✘ | ✘ | ✘ | ✔ | ✔ | ✔ | ✔ |
| DM-only / draft articles | ✘ | ✘ | ✘ | ✘ | ✔ | ✘ | ✔ |
| DM-only / draft sections of a visible article | ✘ | ✘ | ✘ | ✘ | ✔ | ✘ | ✔ |
| DM-only infobox fields | ✘ | ✘ | ✘ | ✘ | ✔ | — | ✔ |
| DM notes, revisions | ✘ | ✘ | ✘ | ✘ | ✔ | ✘ | ✔ |
| DM-only categories, their counts | ✘ | ✘ | ✘ | ✘ | ✔ | — | ✔ |
| Relations (hidden kind or hidden end) | ✘ | ✘ | ✘ | ✘ | ✔ | — | ✔ |
| Backlinks from DM sections | ✘ | ✘ | ✘ | ✘ | ✔ | — | ✔ |
| DM redirects | ✘ | ✘ | ✘ | ✘ | ✔ | — | ✔ |
| Hidden timeline events | ✘ | ✘ | ✘ | ✘ | ✔ | — | ✔ |
| Hidden maps / markers | ✘ | ✘ | ✘ | ✘ | ✔ | — | ✔ |
| Search hits / snippets from hidden text | ✘ | ✘ | ✘ | ✘ | ✔ | — | ✔ |
| Player-visible images (storage) | ✘ | — | — | ✔ | ✔ | — | ✔ |
| DM images: download, list, signed URL | ✘ | — | — | ✘ | ✔ | — | ✔ |
| Upload / delete files | ✘ | — | — | ✘ | ✔ | — | ✔ |
| SVG upload | ✘ | — | — | ✘ | ✘ | — | ✘ |
| Insert/update/delete content | ✘ | — | — | ✘ | ✔ | — | ✔ |
| Change own role / un-revoke / add members | ✘ | — | — | ✘ | — | — | — |
| Access-code hashes | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Create / rotate / revoke codes, remove devices | ✘ | — | — | ✘ | ✔ | — | ✔ |
| Enrollment functions (server only) | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Preview as player | ✘ | — | — | ✘ | ✔ | — | ✔ |
| Public sign-up, anonymous sign-in | ✘ | | | | | | |

"—" means not separately tested for that role; the row's rule follows from the same policy.

## Other guards

- Forged claims (`user_role`, `app_metadata.role`, `user_metadata.role`, `aal2` for a player)
  grant nothing.
- `anon` has no privilege on any table, column or function in `public`, even though the local
  stack reproduces Supabase's default of granting them.
- Every table in `public` has RLS enabled; every `SECURITY DEFINER` function pins `search_path`.
- Weakening one policy (`sections_read` to "any member") made 5 tests fail; restored, all pass.
- A browser test records every API response a player receives across 18 pages (home, articles,
  lists, categories, timeline, connections, maps, search) and checks none contains any of 20
  secret phrases from the sample campaign.
- Preview-as-player output equals what a real player session receives.

## Files

`tests/db/privacy.test.ts`, `functions.test.ts`, `enroll-integration.test.ts`,
`privileges.test.ts`, `importer.test.ts`; `functions/_lib/enroll.test.ts`;
`tests/e2e/player.spec.ts`, `dm.spec.ts`, `z-mfa.spec.ts`.
