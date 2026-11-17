# Migrations written on 2026-11-17 (development branch, not applied to any hosted database)

All seven are additive: new tables, functions, policies and one new column. No existing row is
changed and no existing table is dropped. Each file is idempotent (it can be applied twice) and
ends with `notify pgrst, 'reload schema'`. Each header comment has a local rollback note.

| File | Purpose | SHA-256 |
|---|---|---|
| `20261117000100_reader_notes.sql` | Reading lists, bookmarks, private scratchpads, Character Journals | `a27600f6c6fc114548a9d1cd82a3665c9b0f7acdb40b8d0b3da8dad36a245839` |
| `20261117000200_mystery_studio.sql` | Mysteries, clues with release rules, hints, discoveries | `72e86229c29888926750bf326ff2438fdd943d00931fb7e8ae4595acf908eaea` |
| `20261117000300_investigation_board.sql` | Party board: sections, cards, connections, activity | `3ca875f64698f248fc78441199983d10702d08f4b7337077f243916888fb653a` |
| `20261117000400_feedback.sql` | Feedback Center: named and anonymous feedback | `7fb37ea654c95c39ab0673620e47973fdb35c1ca8f8719eb85d109e2daa05614` |
| `20261117000500_player_invitations.sql` | Personal invitations, one account per player, per-device revocation (changes `private.is_member()`) | `48613aa2a3569c3aa5fef1f71bb60bc096acb246e3ed1aedbb3311b07e5db4bc` |
| `20261117000600_research.sql` | Knowledge Studio research collections | `971869ae1be7aab22a39b57d5a3116f25617ca6dbd6c0d96dece75b7c086dfa9` |
| `20261117000700_maintenance_switch.sql` | The DM's website maintenance switch; a trigger stops direct API writes to `maintenance_until`, so the 8-hour cap cannot be skipped | `05829d0edb7aff011b00018324b88c0c7afb8495769859717805025d6d60ddc6` |

## What was tested, locally only

- **Fresh install:** `scripts/local-stack.sh up` applies every migration in order on a disposable
  PostgreSQL 17.12; the full database suite passes on it (377 tests at the checkpoint before the last
  UI work).
- **Applied twice:** each file was applied a second time to the running database without error.
- **Upgrade rehearsal from the pre-sprint schema:** `PGBIN=/opt/pg17/bin bash scripts/upgrade-simulation.sh 20261116000200`
  — stack at `20261116000200` with production-shaped synthetic data, then the seven files one
  transaction each: all applied; data fingerprint unchanged; schema and Storage policies identical
  to a fresh install.
- **Upgrade rehearsal from production's last recorded migration (`20261112001300`) with a copy of
  production's own data (2026-11-17):** read-only export with `scripts/export-logical-backup.sh`,
  restored with `scripts/restore-logical-backup.mjs` into a local stack stopped at `20261112001300`
  (every table matched), then all 22 pending migrations applied one transaction each: all applied;
  data fingerprint (articles, sections, members, relations, provenance) unchanged; DM reads all 52
  pages, an outsider reads 0, an anonymous visitor is refused. See RELEASE-RUNBOOK-2026-11-17.md.
- **Database authorization tests:** `tests/db/reader-notes.test.ts`, `invitations.test.ts`,
  `mystery-board.test.ts`, `feedback.test.ts`, `research.test.ts`, `maintenance-switch.test.ts`, and the
  reference-leak sweep, which now plants rows in the new tables. Roles tested: DM (with and without
  MFA), player, second player, removed member, authenticated outsider, anonymous visitor, and
  assistant (OAuth) sessions.

## Before production (not done; needs the owner)

1. A complete current backup in persistent private storage and a passing isolated restore rehearsal
   (standing rule).
2. Owner approval of the exact bundle, including the earlier pending migrations listed in
   IMPLEMENTATION-STATUS.md.
3. `20261117000500` changes `private.is_member()`, which every membership policy uses. Review it on
   its own. It only adds a condition (a revoked device session is refused); sessions without a device
   row are unaffected.
4. The invitation flow needs the `/api/join` Pages Function with the same secrets as `/api/enroll`
   (`SUPABASE_SECRET_KEY`, `IP_HASH_SECRET`), and the hosted Auth service must allow the admin
   `generate_link` and `verify` calls (standard Supabase Auth). Test it once on a preview deployment
   against a non-production project before relying on it.
5. Recompute the hashes above from the files at release time; they change if a file is edited.
   Hashes above were recomputed on 2026-11-17 after the maintenance guard was added.

## Security review notes (2026-11-17)

- `private.is_member()` (`…0500`): still SECURITY DEFINER with `search_path = ''`; it reads only the
  caller's own membership (`auth.uid()`) and adds one extra refusal (a revoked device session). A
  token without a `session_id` claim matches no device row and keeps today's behaviour. It can only
  make membership narrower, never wider.
- `campaign_settings.maintenance_until` (`…0700`): `authenticated` holds table-level UPDATE (needed
  by the DM's settings policy), so before this fix the DM could write any time directly and skip
  the cap. A BEFORE UPDATE trigger now refuses any change to the column unless it comes from
  `set_maintenance` (which runs as the owner). Players were never able to write it (RLS:
  `settings_dm`) and cannot read the column. Covered by `tests/db/maintenance-switch.test.ts`.
- Saved player sign-ins (`src/lib/accounts.ts`): players who joined on a device keep their own
  refresh token in that browser's localStorage, up to 6, so a family device can switch between
  them. The DM is never saved (only role `player`). The token is the same secret supabase-js
  already keeps for the active session, so XSS exposure is unchanged; anyone with the unlocked
  device can switch to a saved player, which is the intended trade-off. Sign-out removes that
  player's entry; a revoked device or member fails on the next switch and is removed. On a device
  the family does not trust, players should sign out after each session.
