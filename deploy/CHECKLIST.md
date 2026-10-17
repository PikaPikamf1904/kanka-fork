# Big Bertha checklist

Tick these by hand. Commands are in the [guide](README.md).

## Before installing

- [ ] The host key shown at Big Bertha's own screen matches the one the PC was shown
      (guide step 1). If not, stop.
- [ ] `diagnose.sh` from the PC shows Debian 13, at least 20 GB free, the right date and
      time, and nothing unexpected listening.
- [ ] The router always gives Big Bertha the same address (DHCP reservation).
- [ ] BIOS: power comes back on after a power cut.

## Right after installing

- [ ] `kanka-verify`: no FAIL.
- [ ] `BACKUP_ARCHIVE_PASSWORD` is in your password manager.
- [ ] `kanka-backup` runs, then `kanka-restore --list` shows the new archive.
- [ ] `kanka-restore <that archive>` (no `--yes`) reports a database dump and images.
- [ ] `deploy/local/pull-backups.sh` on the PC copies it to `deploy/local/backups/`.

## In the browser (phone or tablet on the home Wi-Fi)

- [ ] `http://192.168.1.239` opens the login page.
- [ ] Registering without the invite code is refused; with it, it works.
- [ ] Your DM account creates the campaign, and an uploaded image shows.
- [ ] With a test player account: a character marked **Admin** (DM-only) does not appear
      in lists, search, mentions or the relationship graph. Delete the test account after.
- [ ] A campaign export finishes (Campaign → Export) and only campaign admins can download it.

## After the first week

- [ ] `kanka-backup --list` shows two backups a day.
- [ ] `kanka-verify` still has no FAIL.
- [ ] `df -h /srv` has room to spare.
- [ ] After a reboot (`systemctl reboot`), the wiki comes back without help.

## Never

- Forward router ports to Big Bertha, or expose MariaDB or SSH to the internet.
- Paste `.env` or a backup archive anywhere public.
- Run `kanka-release` as root (it refuses).
