# Access control

**Rule: a player never receives anything the DM has not revealed.** It is enforced by
PostgreSQL Row Level Security on every table, not by hiding things in the browser.

## Who is who

| Who | How they sign in | What they can read | What they can write |
|---|---|---|---|
| Visitor (no session) | — | Nothing. `anon` has no privilege on any table or function. | Nothing |
| Signed in, not a member | — | Nothing (every policy requires active membership) | Nothing |
| Player device | Shared access code → its own Auth user | Rows with `visibility = 'players'` and `status = 'published'` whose parent page/map is also visible | Nothing |
| Revoked device | — | Nothing, from the next request on | Nothing |
| DM | Email + password, plus TOTP once enabled | Everything | Everything |

Roles come only from `campaign_members`, which players cannot write. Role claims in the token,
`user_metadata` and `app_metadata` are never read (tested with forged claims).

## Player access code

1. The player enters the code and a name on the access screen.
2. The browser posts them to `/api/enroll` (Cloudflare Pages Function). Cross-site requests are
   refused (Origin check); input is length-limited; optional Cloudflare Turnstile.
3. The function hashes the client IP with HMAC (raw IPs are never stored) and calls
   `begin_enrollment`, which applies rate limits (5 failures per address per 15 minutes,
   100 failures per hour overall) and checks the code against **bcrypt hashes**.
4. On success it creates a new Auth user for this device with a random 32-byte password that is
   never stored or shown, adds it as a player (`complete_enrollment`, which re-checks the code),
   signs it in and returns only the session to the browser. On any failure the new user is
   deleted.
5. supabase-js keeps the device signed in with its refresh token until the player leaves or the
   DM removes the device.

The DM can create, rotate (revokes all older codes), expire, cap and revoke codes, and remove
devices one by one or all at once. Codes are shown once at creation; only hashes are stored and
the hash column is not selectable even by the DM. Rotating a code does not remove devices
already in; remove them too if a code leaked.

Public sign-up and anonymous sign-in are both **disabled** in Supabase Auth, so nobody can
create an account except through enrollment or the DM's dashboard.

### Trade-offs, stated plainly

- The shared code is a shared secret: anyone who has it can enroll a device until it is rotated.
  Each device is still a separate, removable identity, and the DM sees every device by name.
- The browser keeps the Supabase session in `localStorage` (supabase-js default for a static
  app), not an HttpOnly cookie. Defences: strict CSP (`script-src 'self'`), no raw HTML anywhere
  (lint rule), no third-party scripts except optional Turnstile. A session-cookie design would
  need a server for every API call, which costs Function requests.
- Free projects cannot time-box sessions; a device stays signed in until it leaves or is
  removed. Removal takes effect on the next request because every policy re-checks membership.

## DM account

- Created by hand in the Supabase dashboard; membership row added with SQL (see setup guide).
- Sign-in page is reachable from a small "Sign in with an account" link; it is not an admin
  backdoor, and knowing it grants nothing.
- **Two-step sign-in (TOTP)** can be turned on in Wiki settings. Once a factor is verified, the
  database's `private.is_dm()` requires an `aal2` session, so a stolen password alone shows only
  player content.

## Where secrets could leak, and what stops it

| Path | Protection |
|---|---|
| Search and suggestions | `SECURITY INVOKER` functions over RLS-filtered rows; snippets come only from visible sections |
| Category counts | Computed under the caller's RLS; DM-only categories are invisible including their names |
| Backlinks | Links come from sections; a link is only as visible as the section it is written in |
| Relations | Hidden unless the relation and both pages are visible |
| Map markers | Hidden if DM-only, if the map is hidden, or if linked to a hidden page |
| Timeline | Hidden if DM-only, draft, or tied to a hidden page |
| Redirects | DM-only redirects (for example a secret true name) never resolve for players |
| Previews and cards | Same tables, same RLS |
| Images | Private bucket; a file is readable only if its `media` row is player-visible; no listing; signed URLs can only be created by someone allowed to read the file |
| Browser source, caches | The built app contains no content; `index.html` is `no-cache`, `/api` is `no-store`; Supabase responses are per-user |
| Error pages | "Nothing written here yet" for both missing and hidden pages |
| Sitemaps, indexing | No sitemap; `robots.txt` disallows all; `X-Robots-Tag: noindex` |
| Exports | Not built in the new app; Kanka exports stay admin-only in Kanka |
| Player text linking hidden pages | Editor warns; the importer replaces such mentions with "(unrevealed)" |

`SECURITY DEFINER` functions (membership helpers, access-code management, enrollment) pin
`search_path`, check the caller's role first, and are tested for that.
