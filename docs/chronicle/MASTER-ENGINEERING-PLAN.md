# Chronicle engineering execution plan

This is an abbreviated execution record of the owner's 2026-11-12 instructions, not a copy of the separate Sol architecture report. That report was not attached as a separate document and was not found in the audited checkout. Obtain it before treating its detailed designs as known. The repository and verified behavior govern implementation.

## Safety and baseline

Work on an isolated local branch based on the audited Gazette branch. Do not change production, publish content, apply live migrations, push production, merge existing PRs, force-push, expose secrets, or rewrite historical migrations. In particular migration 14 has no authorization for live application. Use synthetic fixtures and forward-only migrations. Preserve the DM/player boundary, Gazette, existing campaign history, and visual identity. Unknown chronology and quest status must not be invented.

## Priority and acceptance

- CH-000: record actual refs, changes, tools, tests, blockers and progress. Save the full Sol report when supplied, after sanitization.
- CH-001: prevent destructive tests from reaching non-disposable databases or live sites; fail setup on migration errors, verify the complete schema, isolate screenshots, and use synthetic fixtures. Storage verification is a separate requirement.
- CH-101: enforce OAuth write and access-management restrictions in the database without a forgeable context flag; retain website, player, preview and approved-application paths, membership and MFA.
- CH-102: protect player-visible content across every MCP change-set operation and reject forbidden or stale operations atomically.
- CH-103: enforce Gazette review for news edits, transitions, sections, visibility and metadata; preserve the approved printed version during review.
- CH-104: protect private media metadata and synchronize access when references, visibility or parent articles change, including concurrent operations.
- CH-200–202: safe media upload and deletion, private immutable full-frame sources with display derivatives, then complete and test the image UI.
- CH-300–301: compare-and-swap Gazette revision identity throughout transitions; support reviewable DM-only MCP news drafts without editorial authority.
- CH-400–402 and CH-404: truthful home selections, session chronology, editor data-loss prevention and relation presentation, map validation and privacy. CH-403 needs owner review of existing previews before any real-content changes.
- CH-302, CH-500–501, CH-600–603: Gazette front page, MCP and privacy testing, documentation/CI, measured accessibility/performance, public content inventory, and old Worker investigation after higher priorities.

For each migration use the project's supported tooling, verify dependencies/order and privileges, test fresh and upgrade-from-13 paths, record its checksum and recovery plan, and do not apply to production. For each completed defect reproduce, regression-test, fix, review, run focused and broader safe tests, commit, and update the status. Stop dependent work on a privacy regression, unknown target, inconsistent history or missing production authorization; continue independent work.
