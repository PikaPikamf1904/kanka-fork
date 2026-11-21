# Maintenance notice

A banner at the top of every page:

> Declan is currently performing maintenance on Chronicle. Some features may be temporarily
> unavailable or behave unexpectedly. Please save your work before refreshing.

## Two ways to turn it on

| Switch | Where | Who sees it |
|---|---|---|
| **DM switch** (everyday) | Wiki settings → Maintenance notice. Choose 30 minutes, 1, 2 or 8 hours; it turns itself off. "Turn off now" ends it early. | Everyone signed in. It appears at once on the DM's own page and within 2 minutes on other open pages (sooner when a tab is brought back to the front). |
| **Cloudflare switch** (emergency) | Cloudflare Pages → Settings → Variables: `MAINTENANCE_MODE=on` for Production, then redeploy. Remove it (or set `off`) and redeploy to end. | Everyone, including the "Who's at the table?" screen. Works even if the database is down. |

The DM switch is stored in the database (`campaign_settings.maintenance_until`) and can only be
changed through `set_maintenance`, which allows the DM alone, for at most 8 hours. Members can only
read whether it is on and until when.

## Removed (2026-11-21)

An earlier version could also be turned on by a "deploy record" in a Workers KV namespace,
written through `POST /api/status` with a secret token, and by "development heartbeats" from a
helper script. Neither the KV namespace nor the token was ever configured in production, so that
path could not do anything. It was removed with `scripts/maintenance-heartbeat.sh`.
`/api/status` now only answers `GET`.
