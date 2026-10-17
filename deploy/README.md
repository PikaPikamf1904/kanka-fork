# Hosting Kanka for a small private group

Status: **prepared, not deployed.** Nothing in this directory has created an account,
a server or a charge. Researched 2026-10-17; free-tier terms change, so re-check the
items marked *verify* before you sign up.

## 1. Verdict

There is **no host that is guaranteed to cost $0 forever** for the real Kanka app (PHP 8.4,
Laravel, MariaDB, a queue worker, a scheduler, persistent uploads, always on).

The closest option, and the one this directory prepares, is the
**Google Cloud "Always Free" e2-micro VM** set up a specific way. Within the free
allowances it costs $0/month. It does not meet "guaranteed $0" because:

- Google requires a **billing account with a card**. Usage outside the free allowances
  (more than 1 GB/month outbound traffic, a public IPv4 address, the wrong disk type, a
  second VM) is billed automatically. A budget alert warns you; it does **not** stop charges.
- To avoid the public-IPv4 charge (about $3.65/month at $0.005/hour) the VM runs with
  **IPv6 only**. Public HTTPS then comes through **Tailscale Funnel** (free plan, a
  `*.ts.net` address, unpublished bandwidth limits). Whether Tailscale works from an
  IPv6-only VM is **not verified**, so step 0 of the plan is a 15-minute test.

If step 0 fails, the cheapest reliable fallbacks are not free: keep the IPv4 address
(about $3.65/month), or a small paid VPS (upstream notes Kanka runs on a €4/month Hetzner
VM). Both exceed your $0-recurring limit, so that would be your decision.

## 2. What Kanka actually needs (audited and measured)

| Component | Needed? | This plan |
|---|---|---|
| PHP 8.4 + bcmath, intl, gd, zip, mbstring, xml, curl, mysql, gmp | **Essential** (code uses 8.4-only syntax) | Debian 13 packages |
| MariaDB/MySQL | **Essential**. Search uses MySQL `FIELD()`, so SQLite is not an option. | MariaDB 11.8 on the VM, 128 MB buffer pool |
| Persistent disk for uploads | **Essential** | Default `public` disk on the VM disk |
| Queue worker | **Essential** (entity mapping/update jobs, imports, exports, map tiling) | `database` queue + systemd worker |
| Scheduler | **Essential** (calendar advance, cleanup, backups) | systemd timer, every minute |
| Redis | Optional | Not used (file cache/sessions, database queue) |
| Meilisearch | Optional: only the full-text search page | Off (`SCOUT_DRIVER=null`); quick search and mentions use MariaDB |
| S3/MinIO | Optional with the new `S3_DISK_DRIVER=local` | Exports/imports kept on local disk outside the web root |
| Thumbor | Optional | Off; original images are served directly |
| Reverb/websockets, Mailgun, Stripe, Discord, Sentry | Optional (kanka.io services) | Off |
| Email (SMTP) | Optional: password resets and invites by email | Off by default (logged); see §8 |
| Building assets (Composer, Vite) | Build time only | GitHub Actions, never on the 1 GB VM |

Memory, measured in a local emulation of this exact setup (PSS, so shared memory is
counted once):

| Process | Under 4 concurrent page loads | Idle |
|---|---|---|
| PHP-FPM workers (on-demand, max 4) | ~82 MB | ~1 MB (workers exit after 30 s) |
| Queue worker | ~75 MB | ~80 MB |
| MariaDB | ~167 MB | ~167 MB |
| nginx | ~8 MB | ~8 MB |
| **App stack total** | **~335 MB** | **~260 MB** |

Add roughly 150–250 MB for Debian, the Google guest agent and Tailscale: about 0.5–0.6 GB
of 1 GB. The plan adds a 2 GB swap file as a safety margin. The test data was tiny; the
MariaDB buffer pool is capped at 128 MB, so memory stays bounded as the campaign grows.

## 3. Options evaluated (no Oracle)

| Option | PHP + MariaDB | Persistent uploads | 24/7 | Cost | Fit |
|---|---|---|---|---|---|
| **GCP e2-micro, IPv6-only + Tailscale Funnel** | Yes (full VM) | Yes, 30 GB standard disk | Yes | $0 within free limits; card required | **Recommended, after step 0** |
| GCP e2-micro with public IPv4 | Yes | Yes | Yes | ~$3.65/month for the IPv4 address | Over budget |
| Render (free) | Docker only, no MySQL | No persistent disk on free | Sleeps after 15 min | $0 | No |
| Koyeb (free) | 512 MB, 0.1 vCPU | No volumes on free instance | Scales to zero after 1 h | $0 | No |
| Railway | Yes | Yes | Trial/credit only | ~$5/month after the trial | No |
| Fly.io | Yes | Yes | Yes | No free plan for new accounts | No |
| Northflank sandbox | Containers + 1 DB | Volumes unclear on free | Claimed always-on | $0, card required | Unverified; possible fallback |
| AWS (new accounts since July 2025) | Yes | Yes | Yes | Credits for ≤ 6 months, then paid | No |
| Free shared PHP hosts (Byet/InfinityFree style) | PHP 8.3, no SSH, no cron, no worker | Limited | Yes | $0 | No: Kanka needs 8.4, a worker and Composer |
| Your home PC | Yes | Yes | **No** (off when the PC is off) | $0 | Excluded by your requirements |

## 4. Recommended architecture

```
players' browsers ──HTTPS──▶ Tailscale Funnel (https://kanka.<tailnet>.ts.net)
                                   │  (TLS ends here; free Let's Encrypt cert for *.ts.net)
                                   ▼
GCP e2-micro (us-central1/us-east1/us-west1), Debian 13, IPv6-only, no public IPv4
  tailscaled ──▶ nginx 127.0.0.1:80 ──▶ PHP 8.4-FPM (on-demand pool)
                                   ├─▶ MariaDB 11.8 (localhost socket)
                                   ├─▶ /srv/kanka/shared/storage (uploads, backups, logs)
  kanka-queue.service (database queue)    kanka-scheduler.timer (every minute)

GitHub Actions "Deploy" (manual) ──Tailscale (tag:ci)──▶ ssh kanka@vm ──▶ release.sh
```

- No public ports. nginx and MariaDB listen on localhost only; admin SSH goes through
  Google's IAP tunnel or Tailscale.
- GitHub builds everything (`composer install --no-dev`, `yarn build`) and ships a
  tarball; the VM never needs to reach github.com (which has no IPv6).
- Releases are atomic (`releases/<id>` plus a `current` symlink). A database-only backup
  runs before every migration. A failed health check automatically restores the previous
  release.

## 5. What was verified, and what was not

Verified here, using an Ubuntu 25.10 container with PHP 8.4.11, nginx and PHP-FPM driven by
these exact config files, plus a MariaDB 11.8 container:

- `composer install --no-dev` and `yarn build` produce a working 104 MB release.
- `release.sh --first-install`: all migrations and seeders run on MariaDB 11.8; config,
  route, view and event caches all build.
- Through nginx/PHP-FPM: login, campaign creation with an image upload, character
  create/view, dashboard and lists.
- Queue: jobs processed by the database worker.
- Encrypted backups (AES-256) containing the DB dump and uploads.
- Normal deploy (backup, then migrate), `--rollback`, and automatic restore after a
  failed health check.
- Every scheduled task runs without error.
- Signed import uploads: a 50 MB upload succeeds; unsigned and tampered URLs return 404;
  over 100 MB returns 413.
- Uploads are served with caching and never executed as PHP; `/.env` is denied.
- Responses are gzipped: pages are 10–13 KB; first-visit JS+CSS is ~153 KB, then
  cached for a year.

**Not verified:**

- Anything on a real GCP VM or on Debian 13 itself.
- Tailscale on an IPv6-only VM, and Funnel's real bandwidth limits.
- The GitHub Actions workflow on GitHub's runners (it can only run once the secrets exist).
- Registration's `email:dns` check (the test container had no DNS).
- Email delivery.
- Real phones.

## 6. Egress estimate (the main cost risk)

The free tier includes 1 GB/month of outbound traffic from North America (excluding China
and Australia). Estimate for 6 players: ~300 page views each per month ≈ 25 MB of HTML;
first-visit assets ≈ 1 MB per device; then images. Uploaded portraits and maps dominate:
a 5 MB map viewed once by 6 people is 30 MB (then cached for 30 days). A typical month
should fit, but **many large maps or frequent new devices could exceed 1 GB**. The
overage is billed at Google's internet egress rate (verify the current price). Keep map
images reasonably sized, and watch the budget alert.

## 7. Deployment plan (you do these steps; nothing here has been done)

**Step 0: proof of concept, about 15 minutes, before anything else.**

1. Create a Google Cloud account and project with a billing account (card required).
   Immediately create a **budget of $1 with email alerts at 50/90/100%**.
2. Create the network and VM (Cloud Shell). These commands have not been run, so check
   them against the current `gcloud` docs:
   ```
   gcloud compute networks create kanka-net --subnet-mode=custom
   gcloud compute networks subnets create kanka-subnet --network=kanka-net \
     --region=us-central1 --range=10.10.0.0/24 --stack-type=IPV4_IPV6 --ipv6-access-type=EXTERNAL
   gcloud compute firewall-rules create kanka-iap-ssh --network=kanka-net \
     --allow=tcp:22 --source-ranges=35.235.240.0/20      # Google IAP only
   gcloud compute instances create kanka --zone=us-central1-a --machine-type=e2-micro \
     --subnet=kanka-subnet --stack-type=IPV4_IPV6 --ipv6-network-tier=PREMIUM --no-address \
     --image-family=debian-13 --image-project=debian-cloud \
     --boot-disk-type=pd-standard --boot-disk-size=30GB
   ```
   `--no-address` means no external IPv4 (no IP charge). `pd-standard` is the free disk
   type; the console's default "balanced" disk is billed.
3. `gcloud compute ssh kanka --zone=us-central1-a --tunnel-through-iap`, then install
   Tailscale and run `sudo tailscale up --ssh`. **If the node cannot join the tailnet over
   IPv6, stop here** and decide on a fallback (§1).
4. In the Tailscale admin console, enable MagicDNS and HTTPS certificates, and allow
   Funnel for this node. Test with `sudo tailscale funnel --bg 80`, then open
   `https://kanka.<tailnet>.ts.net` from a phone on mobile data.

**Step 1: provision.** Copy this repository's `deploy/` folder to the VM
(`gcloud compute scp --recurse deploy kanka:~ --tunnel-through-iap`), then run:

```
sudo DEPLOY_PUBKEY="ssh-ed25519 AAAA... github-deploy" bash ~/deploy/server/provision.sh
sudo nano /srv/kanka/shared/.env     # set APP_URL to the ts.net URL, APP_EMAIL, MAIL_FROM_ADDRESS
sudo tailscale funnel --bg 80
```

`provision.sh` generates the APP key, database password and backup password into `.env`
(mode 600). They never leave the server.

**Step 2: GitHub deployment.**

- In Tailscale, create a tag `tag:ci` and an OAuth client that can add devices with that
  tag. In the access policy, allow `tag:ci` → the VM on port 22 only.
- Create a dedicated SSH key pair for deploys; its public key is the `DEPLOY_PUBKEY` from
  step 1.
- Add these repository secrets:
  - `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`
  - `DEPLOY_SSH_KEY` (the private key)
  - `DEPLOY_HOST` (the VM's Tailscale name, e.g. `kanka`)
  - `DEPLOY_KNOWN_HOSTS` (output of `ssh-keyscan kanka`, run from a tailnet device)
- Optionally add required reviewers to the `production` environment.
- Run **Actions → Deploy → Run workflow** with *First install* ticked, once. Later deploys
  leave it unticked.

**Step 3: first use.** Register your DM account and have players register. Then set
`APP_REGISTRATION_ENABLED=false` in `.env` and run
`sudo -u kanka php /srv/kanka/current/artisan config:cache` so strangers can't sign up.

## 8. Operations

- **Rollback:** `sudo -u kanka bash /srv/kanka/current/deploy/server/release.sh --rollback`.
  Database migrations are not reversed; restore a backup if a migration must be undone.
- **Campaign exports:** the zip is built on the server under
  `shared/storage/app/s3/exports/<campaign id>/`, but the UI's download link will not work.
  Upstream serves exports from a public bucket at a guessable path, and this setup
  deliberately keeps them off the web. Copy them with `gcloud compute scp --tunnel-through-iap`.
  Imports (up to 100 MB) work through signed upload URLs.
- **Backups:** encrypted DB + uploads twice a day to `storage/app/Kanka/`, pruned by
  `backup:clean`. They live on the same disk, so **copy them off the server**:
  `gcloud compute scp --tunnel-through-iap kanka:/srv/kanka/shared/storage/app/Kanka/*.zip .`
  Or point `BACKUP_DISK=backup` at any S3-compatible bucket using the `HETZNER_S3_*` variables.
  Keep `BACKUP_ARCHIVE_PASSWORD` somewhere safe; backups cannot be opened without it.
- **Restore test:** unzip a backup with the password, then
  `gunzip < db-dumps/mariadb-kanka.sql.gz | mariadb kanka`, and copy uploads back into
  `shared/storage/app/public`.
- **Email:** to enable password resets, set `MAIL_DRIVER=smtp` and fill `MAIL_HOST`,
  `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD` and `MAIL_ENCRYPTION`. For example, use a
  Gmail account with an app password (free; Google's sending limits apply).
- **Updates:** `unattended-upgrades` installs Debian security updates. Kanka updates
  arrive by merging upstream into this fork and running the Deploy workflow.

## 9. Configuration changes made for self-hosting

All default to upstream behaviour, so kanka.io-style installs are unaffected:

| Setting | Effect when set as in `env.production.example` |
|---|---|
| `DB_REPLICA_ENABLED=false` | Guests use the main DB connection (no replica server) |
| `APP_SAAS_SCHEDULE=false` | No kanka.io onboarding emails, subscription, PayPal, Discord or report jobs |
| (logs DB unset) | Log anonymisation is skipped, and `model:prune` excludes `UserLog`/`ApiLog` instead of crashing |
| `S3_DISK_DRIVER=local` | Exports and imports stored on local disk outside the web root; imports use signed upload URLs |
| `BACKUP_INCLUDE_UPLOADS=true` | Backups include uploaded images, not only the database |
| `DB_BINARY_DUMP_OPTIONS` | Drops `--column-statistics=0`, which MariaDB's dump tool rejects |
