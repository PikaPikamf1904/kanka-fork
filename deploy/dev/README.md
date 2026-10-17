# Developing and rehearsing on the PC

Everything here runs in disposable Docker containers on the development PC. Nothing touches
Big Bertha. Commands run in Git Bash from the repository folder.

## Tests, static analysis and builds

`run.sh` copies the checkout into the `kanka-work` Docker volume (read-only mount, so
`vendor/`, `node_modules/` and test output never land in the working tree) and runs
commands in a Debian 13 + PHP 8.4 image that matches Big Bertha.

```bash
deploy/dev/run.sh setup
```

```bash
deploy/dev/run.sh pest
```

```bash
deploy/dev/run.sh pest tests/Feature/Auth
```

```bash
deploy/dev/run.sh pest-mariadb tests/Feature/Privacy
```

```bash
deploy/dev/run.sh exec "vendor/bin/phpstan analyse --memory-limit=2G"
```

```bash
deploy/dev/run.sh exec "vendor/bin/pint --test"
```

```bash
deploy/dev/run.sh exec "yarn install --frozen-lockfile && yarn build"
```

`pest` runs the whole suite without stopping at the first failure. Tests use SQLite and
synthetic data only; never point them at a real campaign database.

`pest-mariadb` runs the same tests against a throwaway MariaDB started inside the
container (no password, no network, gone when the run ends). Use it for anything that
touches search: Kanka's search uses MariaDB-only SQL, so those tests skip on SQLite.

Privacy tests: two of Kanka's visibility scopes (`VisibilityIDScope`, `PrivateScope`) turn
themselves off when the app runs in the console, which includes tests. A test that checks
what a player can see must make the app behave as a web request, or it passes for the
wrong reason. Call `$this->asWebRequest()` after creating the fixtures and again after
switching user; it also forgets what Kanka's services cached for the previous user. Web
mode switches CSRF protection back on, so a POST then needs a token (see the docblock).
`tests/Feature/Privacy/DmOnlyContentTest.php` shows the pattern: each test builds DM-only
content whose names start with `dmonly`, then checks that no page or JSON response a
player can reach contains that text, and that the DM still sees it.

## Staging rehearsal (a Big Bertha look-alike)

`staging.sh` starts a Debian 13 machine with systemd in a container and runs the real kit
in it: `provision.sh`, `kanka-release`, the workers, backups, restore and `kanka-verify`.
The wiki is then on `http://127.0.0.1:8088`, reachable from this PC only.

```bash
deploy/dev/staging.sh up
```

```bash
KANKA_DEPLOY_PUBKEY_FILE=<a throwaway .pub> deploy/dev/staging.sh provision
```

```bash
deploy/local/build-release.sh
```

```bash
deploy/dev/staging.sh deploy deploy/local/out/<release>.tar.gz --first-install
```

```bash
deploy/dev/staging.sh verify
```

Run any command inside, as root, with `staging.sh sh '<command>'`, for example
`staging.sh sh 'kanka-backup'` or `staging.sh sh 'runuser -u kanka -- kanka-release --list'`.
Delete the machine and everything in it with:

```bash
deploy/dev/staging.sh down
```

What to rehearse after changing the kit: a first install, a second deploy (backup,
migrate, health check), `--reload`, `--rollback` with and without a newer migration,
`kanka-backup`, a restore and `kanka-restore --undo`, and `kanka-verify`. The results of
the last run are listed in the guide under
[What has been tested](../README.md#what-has-been-tested).

Use a throwaway SSH key for staging (`ssh-keygen -t ed25519 -f <scratch>/stagingkey -N ''`),
not your real one. Never copy a real `.env`, database or backup into the staging machine.

Shell scripts must keep LF line endings (`.gitattributes` enforces it). A script saved
with CRLF fails on Debian with `$'\r': command not found`.

## Trying Trail-Code safely (optional, not done)

Trail-Code builds a local code map that Claude Code reads through hooks. It is **not**
installed in this repo, because it writes machine-wide hooks under `~/.claude`, suggests
committing `.claude/`, `.mcp.json` and `.trail/` (this repo is public), sends usage stats
unless told not to, and reads past session transcripts. See
[KANKA-CE-AUDIT.md](../KANKA-CE-AUDIT.md#trail-code).

If you want to see what it would do, only in a throwaway container on a copy of the repo:

1. Check who publishes the package first. Its README says `@trailhq/trail-code`, but the
   `package.json` in its repository (version 0.23.0) is named `@nanonets/graft`. Install
   only a package whose publisher you have confirmed.
2. Run it with telemetry off and a container-only home folder, so no hooks reach the PC:

   ```bash
   MSYS_NO_PATHCONV=1 docker run --rm -it -e DO_NOT_TRACK=1 -e HOME=/tmp/home -v "$(cygpath -w "$PWD"):/src:ro" node:22-bookworm bash
   ```

3. Inside the container:

   ```bash
   cp -a /src /work && cd /work && npm install -g @trailhq/trail-code && trail init --dry-run --agents claude
   ```

   `--dry-run` only prints what it would write. Everything is gone when you leave the
   container.

Never commit `.trail/`, `.claude/` or `.mcp.json` from it, and never run it against the
real working copy without deciding that first.

## Working with helpers (other agents, branches)

- One branch per feature, stacked on `bigbertha/self-hosting` when it needs the deploy kit.
  Nothing is merged into `develop` without the owner's approval.
- A helper (another model or tool) gets its own branch or worktree and a written brief:
  the files it may touch, what done looks like, and the tests to run.
- Review a helper's diff and run the tests yourself before committing it.
- Never give a helper `.env` files, backups, database dumps, SSH keys or real campaign
  content.
