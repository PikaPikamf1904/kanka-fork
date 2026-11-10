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
| Image of a draft / hidden / deleted article or map (row and download) | ✘ | — | ✘ | ✘ | ✔ | — | ✔ |
| API upload that starts player-visible | ✘ | — | — | ✘ | ✘ | — | ✘ |
| Revoke a DM row (own or another) through the API | ✘ | — | — | ✘ | ✘ | — | ✘ |
| Restore a revision that publishes content | ✘ | — | — | ✘ | ✘ | — | ✘ |

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

## Media visibility (migration `…0600_audit_fixes`)

- `media.visibility` is derived by triggers: `players` only while the image is the main image of a
  published player article, the image of a published player map, or the cover banner. Publishing,
  unpublishing, hiding, replacing or deleting the page updates it in the same transaction. An image
  shared by several pages stays visible while any visible page uses it.
- API uploads must start `dm`. Downloads were tested through the local Storage API
  (`tests/db/media-sync.test.ts`).
- Signed URLs cannot be revoked. They are issued for 10 minutes and the browser cache is cleared on
  every sign-in and sign-out, so a file hidden after a player loaded it stays reachable through an
  already issued URL for at most 10 minutes.
- An image used only inline in text (`![](media:path)`) is not tracked and stays DM-only.
- Restoring a revision always gives a draft. Enrollment attempts are serialised; at most 20
  successful enrollments per address per hour and 200 per day for the whole wiki.

## Files

`tests/db/privacy.test.ts`, `audit.test.ts`, `media-sync.test.ts`, `functions.test.ts`, `enroll-integration.test.ts`,
`privileges.test.ts`, `importer.test.ts`; `functions/_lib/enroll.test.ts`;
`tests/e2e/player.spec.ts`, `dm.spec.ts`, `z-mfa.spec.ts`.

## Live check (hosted project)

`chronicle-cloud/supabase/checks/live-rls-check.sql` runs the core cases against a hosted project
inside one transaction that always rolls back (it ends with a deliberate error that carries the
results). Paste it into the SQL Editor. Expected values in the error message:

| Key | Expected |
|---|---|
| `anon_articles`, `anon_search`, `anon_settings` | `denied` |
| `ou_rows_visible`, `rv_rows_visible` | `0` |
| `p_articles` | `["public-article","public-three","public-two"]` |
| `p_sections_A` / `p_sections_B` | `["Known history"]` / `0` |
| `p_infobox` | `["Race"]` |
| `p_dm_notes`, `p_revisions`, `p_codes` | `0` |
| `p_categories` / `p_category_counts` | `["sailors"]` / `[{"sailors":1}]` |
| `p_relations` | `["resides_in"]` |
| `p_backlinks_D` / `p_backlinks_E` | `["public-article"]` / `0` |
| `p_redirects` / `p_resolve_dm_redirect` | `["old-captain-name"]` / `0` |
| `p_timeline`, `p_maps`, `p_markers`, `p_media` | `["Visible event"]`, `["world"]`, `["Harbour"]`, `["public/harbour.webp"]` |
| `p_search_secret_hits`, `p_search_shared_snippet_leaks`, `p_suggest_hidden` | `0` |
| `p_code_hash`, `p_insert`, `p_promote`, `p_enroll_fn`, `p_create_code`, `p_preview` | `denied` |
| `p_update_rows`, `p_reveal_rows` | `0` |
| `dm_articles`, `dm_notes`, `dm_markers` | `5`, `1`, `4` |
| `dm_preview_sections` / `dm_preview_hidden` | only "Known history" / `false` |
| `mfa_aal1_notes` / `mfa_aal1_articles` / `mfa_aal2_notes` | `0` / `3` / `1` |
| `svc_wrong_code` / `svc_right_code` | `invalid` / `ok` |
| `dm_self_revoke`, `dm_media_insert_players` | `denied` (needs migration 6) |
| `p_media_published_hero` / `p_media_unpublished_hero` | `1` / `0` (needs migration 6) |

Verified on the local stack (all values as above, nothing left behind).
