# Running the wiki on Big Bertha

Big Bertha is the Debian 13 computer at home (HP Pavilion, 4 GB RAM, dual-core CPU, HDD,
Ethernet, last seen at `192.168.1.239`). This folder installs the real Kanka app on it and
keeps it running, backed up and up to date. Nothing here uses a cloud service, an account
or a subscription, and nothing makes the wiki reachable from the internet.

Status: **rehearsed, not installed.** Every step below has been run end to end on a
disposable Debian 13 machine on the development PC (see [What has been tested](#what-has-been-tested)).
Nothing has been changed on Big Bertha yet.

Contents: [First install](#first-install) · [Everyday use](#everyday-use) ·
[Accounts](#accounts) · [Backups](#backups) · [Restore](#restore) ·
[Playing away from home](#playing-away-from-home) · [Email](#email) ·
[Keeping the machine on](#keeping-the-machine-on) · [When something is wrong](#when-something-is-wrong) ·
[Reference](#reference)

How to read the commands:

- **PC** commands run in Git Bash on the Windows PC, inside this repository folder.
- **Bertha (root)** commands run on Big Bertha after `su -` (type the root password).
  Log in first with `ssh pika@192.168.1.239`, or use Big Bertha's own keyboard.
- One command per box. Copy the whole box.

---

## First install

About an hour, most of it waiting. You need: Git and Docker Desktop on the PC, Big Bertha
switched on and plugged into the router, and its root password.

### 1. Check you are talking to the right machine

The PC currently refuses to connect: *"Host key for 192.168.1.239 has changed"*. That is
expected after reinstalling Debian, but it is also what a different machine on that
address would look like, so check before trusting it.

On **Big Bertha's own keyboard and screen**, log in and run:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

It prints a line containing `SHA256:...`. The PC was shown
`SHA256:PT038nG12qzsR8ID0ZMmY5uKLzY0EdLnq/ZRvOOi5GQ`.

- **They match:** forget the old key on the **PC**:

  ```bash
  ssh-keygen -R 192.168.1.239
  ```

- **They differ:** stop. Something else is answering on that address. Check the router's
  list of devices for Big Bertha's real address.

While you are at the keyboard, `ip -4 addr show` shows Big Bertha's current address. If it
is no longer `192.168.1.239`, use the new one everywhere below, and consider asking the
router to always give Big Bertha the same address ("DHCP reservation").

### 2. Make a key for deploying (PC, once)

```bash
ssh-keygen -t ed25519
```

Press Enter to accept the file name. A passphrase is recommended; you then type it on each
update. Skip this if `~/.ssh/id_ed25519.pub` already exists. Only the `.pub` half ever leaves
the PC.

### 3. Read-only health check (PC)

```bash
ssh pika@192.168.1.239 'bash -s' < deploy/server/diagnose.sh
```

It asks for pika's password, changes nothing, and reports the Debian version, memory, disk,
swap, clock, listening ports and whether anything is already installed. Look for anything
marked as a problem before going on.

### 4. Copy the kit (PC)

```bash
deploy/local/push-kit.sh
```

This copies `deploy/server`, the settings template and your public key to
`/home/pika/kanka-kit`. Nothing is installed yet.

### 5. Install (Bertha, root)

```bash
ssh pika@192.168.1.239
```

```bash
su -
```

```bash
bash /home/pika/kanka-kit/server/provision.sh
```

It takes 5–15 minutes on the HDD. It installs nginx, PHP 8.4, MariaDB and sudo from
Debian; creates the `kanka` user and `/srv/kanka`; generates the app key and the database
and backup passwords into `/srv/kanka/shared/.env` (readable by `kanka` only); adds a 2 GB
swap file if there is none; and sets up the background workers, the scheduler, automatic
security updates and crash recovery. It never touches disks, the bootloader, passwords,
the firewall, SSH settings or the router. It is safe to run again at any time.

### 6. Fill in your settings (Bertha, root)

```bash
nano /srv/kanka/shared/.env
```

Change these lines, then save with Ctrl+O, Enter, Ctrl+X:

| Setting | What to put |
|---|---|
| `APP_EMAIL` | Your email address (shown as the contact on error pages) |
| `MAIL_FROM_ADDRESS` | Same address, or leave it until you [set up email](#email) |
| `APP_REGISTRATION_CODE` | An invite code your players will type to sign up, e.g. `solace-inn-1357` |
| `APP_URL` | Leave as `http://192.168.1.239` unless the address changed |

Leave everything else alone. Never paste this file anywhere: it holds the passwords.

### 7. Build a release (PC)

```bash
deploy/local/build-release.sh
```

It builds the current commit inside Docker (10–20 minutes the first time, faster later) and
writes `deploy/local/out/kanka-<date>-<commit>.tar.gz`. Big Bertha never compiles anything.

Alternative without Docker: on GitHub, **Actions → Release build → Run workflow**, then
download the `kanka-release` artifact, unzip it, and put the `.tar.gz` into `deploy/local/out/`.

### 8. Deploy it (PC)

```bash
deploy/local/push-release.sh --first-install
```

`--first-install` creates the database tables and reference data, **once**. Never use it
again: later updates have no flag. The script stops with an error if anything fails,
before the site goes live.

### 9. Check everything (Bertha, root)

```bash
kanka-verify
```

Every line should say PASS. Two WARNs are normal on day one: "no backup archive yet"
(the first one runs at 02:00 or 14:00, or run `kanka-backup`) and the scheduler line if
you check within a minute of deploying. Anything marked FAIL says what to fix.

The [checklist](CHECKLIST.md) lists everything worth confirming by hand afterwards.

### 10. Create your DM account

Open `http://192.168.1.239` on any device at home, choose **Register**, and use the invite
code from step 6. Create the Dragonlance campaign; you are its admin. Invite players from
the campaign's **Members** page, or give them the invite code to register themselves.

---

## Everyday use

**Open the wiki:** `http://192.168.1.239` from any phone, tablet or computer on the home
Wi-Fi. Add it to the tablet's home screen.

### Update to a newer version (PC)

```bash
deploy/local/build-release.sh
```

```bash
deploy/local/push-release.sh
```

What happens on Big Bertha: the new release is unpacked next to the live one, a database
backup is taken, the database is migrated, caches are built, then the site switches to the
new release in one step. Background jobs finish what they are doing first. If the new
version does not answer its health check, the previous release comes back automatically.
The last 3 releases are kept.

### Undo a bad update (Bertha, root)

Go back to the previous code:

```bash
sudo -u kanka kanka-release --rollback
```

If the bad update changed the database, `--rollback` stops and says so, because old code
on a newer database can break pages or damage data. It prints the backup taken just before
that update and the command that restores it. Run that first, then `--rollback` again:

```bash
kanka-restore <the file it printed> --db-only --yes
```

Anything typed into the wiki since that update is lost by this. Only if you are sure the
old code copes with the newer database: `sudo -u kanka kanka-release --rollback --force`.

See which releases are installed (the live one has a `*`):

```bash
sudo -u kanka kanka-release --list
```

### Change a setting (Bertha, root)

Edit the file, save, then apply it:

```bash
nano /srv/kanka/shared/.env
```

```bash
sudo -u kanka kanka-release --reload
```

`--reload` re-reads the settings, restarts the PHP processes and the background workers,
and checks the site still answers. No code changes.

---

## Accounts

There are three ways to control who can sign up. Pick one.

**Invite code (recommended while players are joining).** Set `APP_REGISTRATION_CODE` in
`.env` and run `--reload`. The sign-up form asks for the code, wrong guesses are limited
to 6 a minute, and the code is never sent to the browser.

**Sign-up off (once everyone has an account).** Set `APP_REGISTRATION_ENABLED=false` and
run `--reload`. Add later players from Big Bertha:

```bash
sudo -u kanka php /srv/kanka/current/artisan users:create player@example.com "Player Name"
```

It asks for their password twice and never shows it. Give it to the player in person and
have them change it under **Settings → Account**.

**Open sign-up.** Leave the code empty. Fine while the wiki is only reachable at home.

**Forgotten password:** with [email](#email) set up, use **Forgot your password?** on the
login page. Without email, `artisan users:reset-password` exists but prints the new
password on screen, so run it only where nobody else can see.

---

## Backups

**Automatic:** an encrypted backup of the database and every uploaded image runs at 02:00
and 14:00 into `/srv/kanka/backups/`. Older ones are thinned out every night: all kept for
7 days, then one a day for 14 more days, one a week for 8 weeks, one a month for 6 months
and one a year for 2 years. If they pass 100 GB, the oldest go first. Each update also
takes a database backup first, and does not migrate unless that backup holds the database.

**The backup password** is `BACKUP_ARCHIVE_PASSWORD` in `.env`. Without it no backup can be
opened, and it is lost if the disk dies. Copy it into your password manager now:

```bash
grep '^BACKUP_ARCHIVE_PASSWORD=' /srv/kanka/shared/.env
```

**Take one now** (before anything risky):

```bash
kanka-backup
```

Add `--db-only` for a quick database-only backup, or `--list` to see them all.

**Copy backups off the machine (PC).** The backups live on the same disk as the wiki, so a
dead disk loses both. Once a week or after a big session:

```bash
deploy/local/pull-backups.sh
```

It copies new archives into `deploy/local/backups/` (git-ignored). They stay encrypted.
Keep a second copy on a USB stick. Do not put them in a public or shared folder.

---

## Restore

All restores run on **Bertha, as root**. Nothing changes until you add `--yes`.

List the backups:

```bash
kanka-restore --list
```

Check one and see what would happen (safe):

```bash
kanka-restore /srv/kanka/backups/Kanka/<file>.zip
```

Restore the database and uploaded images:

```bash
kanka-restore /srv/kanka/backups/Kanka/<file>.zip --yes
```

Add `--db-only` to keep today's images, or `--ask-password` for a backup made with a
different password (for example from before a reinstall). To restore a backup copied back
from the PC, upload it first with `scp <file>.zip pika@192.168.1.239:` and use
`/home/pika/<file>.zip`.

The wiki shows a maintenance page during the restore. The current database and images are
kept first, and the restore prints where (`pre-restore-<time>`). If anything fails before
the switch, the site comes back unchanged.

### The restore went wrong: put things back

Use the `<time>` from the `pre-restore-<time>` copies the restore printed:

```bash
kanka-restore --undo <time>
```

This puts back the database and images exactly as they were before the restore (keeping
what it replaces as `pre-undo-<time>`). Delete the `pre-restore` and `pre-undo` copies once
you are happy: they are not encrypted.

---

## Playing away from home

Out of the box the wiki works **only on the home network**. That is the safest setup and
needs nothing more. To reach it from elsewhere, these are the choices. None is set up; each
needs an account you would create yourself, so it is your call.

| Option | Who can reach it | Needs | Notes |
|---|---|---|---|
| **Home network only** (current) | Devices on your Wi-Fi | Nothing | Safest |
| **Tailscale Serve** (recommended) | Only devices you add to your Tailscale network | Free Tailscale account; the Tailscale app on Big Bertha and on each player's device | Private HTTPS address like `https://bigbertha.<name>.ts.net`. The free plan's user and device limits apply (verify current terms) |
| Tailscale Funnel | Anyone on the internet who has the address | Same account | Public. Kanka's logins and permissions then face the whole internet. Not recommended for DM notes |
| Cloudflare Tunnel | Anyone on the internet, or only allowed emails with Cloudflare Access | Cloudflare account and your own domain | More setup; a domain usually costs money |

**Never** forward router ports to Big Bertha, and never expose MariaDB or SSH. The kit
keeps MariaDB on the machine itself and changes no SSH or firewall settings.

If you choose Tailscale Serve, the outline is below. It is **not tested**; run each step
yourself.

1. Install Tailscale on Big Bertha from Tailscale's Debian instructions, then run
   `tailscale up` and sign in.
2. Run `tailscale serve --bg 80`. It prints the `https://...ts.net` address.
3. In `.env`, set `APP_URL` to that address, `APP_FORCE_HTTPS=true` and
   `SESSION_SECURE_COOKIE=true`, then `sudo -u kanka kanka-release --reload`.
4. From then on everyone uses the `ts.net` address, at home too: `http://192.168.1.239`
   redirects to an `https://` address that does not exist.

`TRUSTED_PROXIES=127.0.0.1` is already set, so Kanka trusts the HTTPS hint from Tailscale on
the same machine and from nowhere else. If pages keep reloading after step 3, set
`APP_FORCE_HTTPS=false` again and `--reload`.

---

## Email

Email is off: messages are written to the log. The wiki works without it, apart from
"forgot password" and email notifications. To turn it on, for example with a Gmail account
and a Google [app password](https://support.google.com/accounts/answer/185833), set in
`.env`:

```
MAIL_DRIVER=smtp
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_ENCRYPTION=tls
MAIL_USERNAME=you@gmail.com
MAIL_PASSWORD=<the app password>
MAIL_FROM_ADDRESS=you@gmail.com
```

then `sudo -u kanka kanka-release --reload`. Gmail's daily sending limits apply.

---

## Keeping the machine on

Every service starts by itself at boot and restarts within seconds if it crashes. To make
sure Big Bertha comes back after a power cut:

- **BIOS:** look for "After Power Loss", "AC Power Recovery" or similar and set it to
  **Power On** (on HP: F10 at start-up, usually under Advanced → Power-On Options).
- **If it is a laptop:** closing the lid suspends it. On Bertha as root, edit
  `/etc/systemd/logind.conf`, set `HandleLidSwitch=ignore` and
  `HandleLidSwitchExternalPower=ignore`, then reboot. Remove the battery or keep it at
  partial charge if the BIOS allows, since a battery on permanent charge can swell.

Debian security updates install automatically. They never restart the wiki in a way
that loses data.

---

## When something is wrong

Start here (Bertha, root). It names what is broken:

```bash
kanka-verify
```

| Symptom | Look at |
|---|---|
| Page does not load at all | `systemctl status nginx php8.4-fpm mariadb` |
| "Something went wrong" page | `tail -n 50 /srv/kanka/shared/storage/logs/laravel.log` |
| Exports, imports or map tiles never finish | `journalctl -u kanka-queue-heavy -n 50` |
| Mentions or search out of date | `journalctl -u kanka-queue -n 50` |
| Disk nearly full | `df -h`, then `kanka-backup --list` |
| Wrong address after a router change | `ip -4 addr show`, then `APP_URL` in `.env` and `--reload` |

The read-only report also works from the PC, with nothing installed on the PC:

```bash
ssh pika@192.168.1.239 'bash -s' < deploy/server/diagnose.sh
```

---

## Reference

### What runs on Big Bertha

```
browser ──http──▶ nginx :80 ──▶ PHP 8.4-FPM (on demand, up to 6 workers)
                                   ├─▶ MariaDB (127.0.0.1 only)
                                   └─▶ /srv/kanka/shared/storage (uploads, exports, logs)
kanka-queue        background jobs: mentions, notifications, search updates
kanka-queue-heavy  one big job at a time: exports, imports, map tiling (low priority)
kanka-scheduler    every minute: calendars, cleanup, backups at 02:00 and 14:00
```

```
/srv/kanka/
  current -> releases/<id>     the live code (switched in one step)
  releases/                    the last 3 releases
  shared/.env                  settings and passwords (kanka only)
  shared/storage/              uploads, private exports, logs, cache
  backups/                     encrypted backups and pre-restore copies (kanka only)
```

Commands installed on Big Bertha:

| Command | Run as | Does |
|---|---|---|
| `kanka-verify` | root | Health and lock-down check; changes nothing |
| `kanka-diagnose` | anyone | Read-only machine report |
| `kanka-backup [--db-only\|--list]` | root or kanka | Backup now |
| `kanka-restore` | root | Restore a backup (dry run without `--yes`) |
| `kanka-release <file>\|--rollback\|--reload\|--list` | kanka (`sudo -u kanka`) | Deploy, undo, apply settings |

### Memory on a 4 GB machine

Measured on the staging machine at idle, after the first install (PSS, so shared memory
is counted once). Big Bertha will be close, and nginx smaller (it starts one process per
core, and the staging PC has more cores).

| Part | Idle | Limit set by this kit |
|---|---|---|
| MariaDB | 288 MB | 512 MB buffer pool, 40 connections |
| PHP-FPM (web pages) | 58 MB | Up to 6 workers, 256 MB each at most; idle workers exit after 60 s |
| `kanka-queue` | 64 MB | 400 MB (systemd `MemoryMax`) |
| `kanka-queue-heavy` | 64 MB | Slowed at 1.2 GB, stopped at 1.6 GB |
| nginx | 11 MB | |
| **Total** | **about 490 MB** | |

Debian itself adds about 150 MB. The 2 GB swap file (swappiness 10) only absorbs a rare
peak, such as a big export while several people are browsing. One heavy job runs at a
time, at low priority, so it slows itself rather than the wiki.

### What Kanka needs, and what this setup uses

| Component | Needed? | Here |
|---|---|---|
| PHP 8.4 with bcmath, intl, gd, zip, mbstring, xml, curl, mysql, gmp | Essential | Debian 13 packages |
| MariaDB or MySQL | Essential (search uses MySQL-only SQL; SQLite will not work) | MariaDB from Debian, local only |
| Disk for uploads | Essential | `/srv/kanka/shared/storage` |
| Queue worker | Essential (mentions, exports, imports, map tiles) | Two systemd workers, database queue |
| Scheduler | Essential (calendars, cleanup, backups) | systemd timer, every minute |
| Redis | Optional | Not used (file cache and sessions) |
| Meilisearch | Optional (only the full-text search page) | Off; quick search and mentions use MariaDB |
| S3 / MinIO | Optional with `S3_DISK_DRIVER=local` | Exports and imports on local disk outside the web root |
| Thumbor | Optional | Off; original images are served |
| Websockets, Stripe, Mailgun, Discord, Sentry | kanka.io services | Off |
| Building (Composer, Vite) | Build time only | On the PC (Docker) or GitHub Actions |

### Settings this fork adds for self-hosting

All default to upstream behaviour, so a kanka.io-style install is unaffected.

| Setting | Effect as set in `env.production.example` |
|---|---|
| `DB_REPLICA_ENABLED=false` | Guests use the main database connection (no replica server) |
| `APP_SAAS_SCHEDULE=false` | No kanka.io subscription, PayPal, Discord, onboarding-email or report jobs |
| (logs database unset) | Log anonymisation is skipped; `model:prune` skips `UserLog`/`ApiLog` instead of failing |
| `S3_DISK_DRIVER=local` | Exports and imports stored on local disk outside the web root; imports use signed upload links |
| `QUEUE_HEAVY_DRIVER=database` | Exports, imports and map tiling go to the low-priority worker |
| `BACKUP_INCLUDE_UPLOADS=true` | Backups include uploaded images, not only the database |
| `BACKUP_ROOT` | Backups go to `/srv/kanka/backups`, outside the app's storage |
| `DB_BINARY_DUMP_OPTIONS` | Drops `--column-statistics=0`, which MariaDB's dump tool rejects |
| `APP_REGISTRATION_CODE` | Sign-up requires this invite code; new Google/Facebook/X sign-ups are refused |

### What has been tested

On a disposable Debian 13 machine with systemd (a container on the development PC,
`deploy/dev/staging.sh`; see [dev/README.md](dev/README.md)), using these exact files:

**Install and update** (latest run 2026-10-17, fresh machine each time):

- Provisioning on a minimal Debian 13 that has no `sudo` installs it. Running provision again
  on a live machine is safe.
- The public key sent by `push-kit.sh` is installed for `kanka` (folder 700, file 600). A
  file holding anything other than one public key line is refused.
- First install: `/up` returns 200 and `/` returns 302. `kanka-verify`: 47 PASS, 3 expected
  WARN (no backup yet, scheduler not run yet, `APP_URL` unreachable from inside a container),
  0 FAIL. MariaDB listens only on 127.0.0.1, port 80 is the only other open port, `.env`
  and backups are private, and `.env` cannot be fetched through nginx.
- `kanka-release` refuses to run as root.
- An update takes a database backup, checks the archive holds a database dump, migrates,
  switches, and passes its health check.
- `--reload` applies a changed `.env` setting.
- `--rollback` refuses when the database has a migration the older code never ran, and
  prints the `kanka-restore` command for the backup taken before that update.
  `--rollback --force` rolls back anyway.

**Backups and restore:**

- Backup archives are encrypted and hold the database and uploaded images
  (`public/...`).
- A restore swaps in all 141 tables and the uploads, after saving a checked copy of
  the current database (not empty, valid gzip).
- `kanka-restore --undo` puts back the database and images from before the restore, and
  images are served again afterwards. A malformed `--undo` time is refused.
- If a restore fails before the swap, the site comes back unchanged.

**Recovery:**

- After a reboot, every service comes back by itself.
- `kill -9` on nginx, PHP-FPM or MariaDB: each is restarted within 10 seconds.

**Not tested yet:** Big Bertha's real hardware, HDD speed and network; a real reboot after a
power cut; Tailscale; email delivery; the GitHub workflow on GitHub's runners.

### Why not containers (Kanka Community Edition)?

Reviewed in [KANKA-CE-AUDIT.md](KANKA-CE-AUDIT.md): its Docker stack adds services Big
Bertha does not need, uses more memory, and one of its patches unlocks paid features.
This kit borrows two of its ideas (the invite code and creating users from the terminal).
