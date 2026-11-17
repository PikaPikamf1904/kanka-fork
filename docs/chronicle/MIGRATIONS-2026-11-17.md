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
| `20261117000700_maintenance_switch.sql` | The DM's website maintenance switch | `953fa415e07ea6e3108808e6279f55e9223ea7f58636030a1b08b34f4e419494` |

## What was tested, locally only

- **Fresh install:** `scripts/local-stack.sh up` applies every migration in order on a disposable
  PostgreSQL 17.12; the full database suite passes on it (377 tests at the checkpoint before the last
  UI work).
- **Applied twice:** each file was applied a second time to the running database without error.
- **Upgrade rehearsal from the pre-sprint schema:** `PGBIN=/opt/pg17/bin bash scripts/upgrade-simulation.sh 20261116000200`
  — stack at `20261116000200` with production-shaped synthetic data, then the seven files one
  transaction each: all applied; data fingerprint unchanged; schema and Storage policies identical
  to a fresh install.
- **Upgrade rehearsal from production's last recorded migration (`20261112001300`)**, covering the
  whole pending bundle: see IMPLEMENTATION-STATUS.md for the result of the latest run.
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
