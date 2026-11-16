# Free-tier limits (checked 2026-11-09)

Checked through web search of the providers' own pages; the provider sites themselves were not
reachable from the build environment. **Re-check the live pricing pages before relying on a
number.** No paid feature is used.

## Supabase Free

| Limit | Value | Source |
|---|---|---|
| Database size | 500 MB per project | supabase.com/changelog (0.5 GB database size per project) |
| File storage | 1 GB | supabase.com/pricing |
| Largest upload | 50 MB (cannot be raised on Free) | supabase.com/docs/guides/storage/uploads/file-limits |
| Image transformations | Not available on Free | supabase.com/docs/guides/storage/serving/image-transformations |
| Egress | 5 GB uncached + 5 GB cached per month | supabase.com/docs/guides/platform/manage-your-usage/egress |
| Monthly active users | 50,000 | supabase.com/pricing |
| TOTP MFA | Free | supabase.com/docs/guides/auth/auth-mfa/totp |
| Inactivity pause | After 1 week; restorable for 90 days | supabase.com/kb/faqs/platform/free-project-pausing |
| Backups | None automatic; manual `supabase db dump` / `pg_dump` | supabase.com/kb/faqs/platform/free-plan-backups |
| API keys | Legacy anon/service_role keys are being retired by late 2026; use publishable/secret keys | supabase.com/docs/guides/getting-started/api-keys |

## Cloudflare Pages Free

| Limit | Value | Source |
|---|---|---|
| Builds | 500 per month, 1 at a time, 20 minutes each | developers.cloudflare.com/pages/platform/limits |
| Files per site | 20,000 | same |
| Largest file | 25 MiB | same |
| Functions | Share the Workers Free quota: 100,000 requests/day | developers.cloudflare.com/pages/functions/pricing |
| Static requests | Unlimited | same |
| Subdomain | `<project>.pages.dev`, free | — |

Only `/api/*` runs a Function (`public/_routes.json`), so page loads do not count against the
100,000/day quota; only enrollment does.

## How Chronicle stays inside the limits

| Concern | Measure |
|---|---|
| Images | Resized in the browser to WebP (1,600 px articles, 2,400 px banner, 4,096 px maps) before upload; originals are never stored. |
| Uploads | Bucket caps files at 10 MB and accepts PNG, JPEG, WebP, GIF only. |
| History | Last 30 revisions per article are kept. |
| Search | PostgreSQL full-text search; no paid search service. |
| Rate-limit table | Attempts older than 7 days are deleted on each enrollment. |
| Bundle | ~175 KB gzip on first load; maps, Markdown and DM tools load on demand. |

## Capacity estimate

| Item | Assumption | Space |
|---|---|---|
| Articles | 1,000 × ~6 KB text | ~6 MB |
| Search indexes and other indexes | ~2–3× text | ~15 MB |
| Revisions | up to 30 per article × ~8 KB, typical use far less | 10–50 MB |
| Other rows (relations, markers, timeline, members) | — | < 5 MB |
| **Database total** | | **~30–75 MB of 500 MB** |
| Article images | ~200 KB each after resizing | ~4,000 images per GB |
| Map images | ~1–2 MB each | — |

Egress example: six players, four sessions a month, 50 image views of 200 KB each per session
is about 240 MB a month (5 GB allowed).
