# Maintenance notice

When maintenance is on, every page shows this banner:

> Declan is currently performing maintenance on Chronicle. Some features may be temporarily
> unavailable or behave unexpectedly. Please save your work before refreshing.

The website checks `/api/status` (a Cloudflare Pages Function) when a page loads, every two
minutes, and whenever the tab becomes visible again. Visitors learn only whether to show the
notice: nothing about who is working or how. If the status can't be read, no notice is shown, so
there are no false alarms.

## Three ways to turn it on

| Source | How | When it shows |
|---|---|---|
| **Manual switch** | Set `MAINTENANCE_MODE=on` in the Pages project's environment variables, then redeploy. Remove it to turn the notice off. | Always while set |
| **Deploy** | A deploy step posts `deploy start` (and `end`) to `/api/status` | Until `end`, or until the time limit (at most one hour) expires |
| **Development** | A development session posts `development` heartbeats | **Only** if `MAINTENANCE_SHOW_DEVELOPMENT=on`. Editing a draft branch doesn't disturb the live site, so by default development is recorded but not shown. |

Records expire on their own (default 15 minutes, at most 1 hour). A session that crashes without
sending `end` can't leave the notice on.

## One-time setup for deploy and development reports (owner)

The manual switch needs none of this. Nothing here has been configured on the live project.

1. Create a Workers KV namespace and bind it to the Pages project as `CHRONICLE_STATUS`.
2. Add a secret `MAINTENANCE_TOKEN` of at least 32 random characters, for example from
   `openssl rand -hex 32`. Without it, the write endpoint answers "not found".
3. Wherever a report should come from, set `CHRONICLE_STATUS_URL=https://<site>/api/status` and
   `CHRONICLE_STATUS_TOKEN=<the same secret>`. Then call `scripts/maintenance-heartbeat.sh`:
   - **Deploys** (for example a GitHub Actions step around a production deploy):
     `scripts/maintenance-heartbeat.sh deploy start 600` before, and
     `scripts/maintenance-heartbeat.sh deploy end` after.
   - **Claude Code sessions** (optional): add hooks to your own user settings
     (`~/.claude/settings.json`), not to the repository, so only your machine reports:
     ```json
     { "hooks": {
         "SessionStart": [{ "hooks": [{ "type": "command", "command": "bash chronicle-cloud/scripts/maintenance-heartbeat.sh development start" }] }],
         "Stop": [{ "hooks": [{ "type": "command", "command": "bash chronicle-cloud/scripts/maintenance-heartbeat.sh development heartbeat" }] }],
         "SessionEnd": [{ "hooks": [{ "type": "command", "command": "bash chronicle-cloud/scripts/maintenance-heartbeat.sh development end" }] }]
     } }
     ```
     The script does nothing when the two variables aren't set. It never prints the token, and
     it sends no prompts, transcripts or file contents: only `kind`, `state` and a time limit.

## Security

- Writing needs the bearer token. The token is compared in constant time.
- Without a token configured, the endpoint answers 404. Without a KV store bound, it answers 501.
- Request bodies are limited to 1 KB. Only `deploy` and `development` are accepted.
- Reading is public and returns only `{ notice, message }`.

## Not verified

The Pages Function and the banner are tested locally: unit tests for the status logic, and a
browser test for the endpoint and the banner. Binding KV, setting the secret and calling the script
from a real deploy or session haven't been done. They need the owner's Cloudflare account.
