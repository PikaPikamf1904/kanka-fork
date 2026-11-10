# Next actions

| # | Item | Why | Depends on | Size | Approval | Files |
|---|---|---|---|---|---|---|
| 1 | Answer the questions in `LORE_EDITORIAL_REVIEW.md` | Most pages are honest stubs until then | DM | small | — | `chronicle-cloud/lore/dragonlance/pack.json` |
| 2 | Supply the campaign documents | Lets statements move to confirmed | DM | — | — | new private folder |
| 3 | Merge this branch into PR #18's branch, then into production | Puts the safe importer on the live site | review | small | yes | — |
| 4 | Import the pack on the live site | Gets drafts in front of the DM | 3 | small | yes | — |
| 5 | MCP: check current specs, then design auth | Long-term goal | docs | large | yes, before deploy | new Worker |
| 6 | Artwork: alt text and credit fields, broken-image fallback | DM uploads art by hand | — | medium | — | `src/components/MediaImage.tsx`, editor |
| 7 | Long dates in DM tools | Consistency | — | small | — | `src/pages/dm/DmPages.tsx`, `ArticleEditor.tsx` |
| 8 | Accessibility pass (keyboard, screen reader, reduced motion) | Quality | — | medium | — | all pages |
| 9 | Fix GitHub-triggered Cloudflare builds | Previews fail within seconds | Cloudflare log | small | — | Cloudflare dashboard |
