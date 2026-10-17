# Shared-password entrance

An optional gate in front of the whole site for visitors who are **not logged in**. It is a gate only: it never logs anyone in and grants no permissions. Visitors who pass it are still guests, so Kanka's normal permission rules apply (guests only see campaigns whose visibility is Public, and only what the campaign's Public role may read). The DM logs in at `/login` as usual (throttling and 2FA unchanged). Players who need to edit use normal accounts via `/login`.

## Enable it

In the server's environment file:

```
ENTRANCE_ENABLED=true
ENTRANCE_MANAGER_IDS=<your user id>      # comma separated; may change the password from the web
ENTRANCE_REMEMBER_DAYS=30                # optional
```

Then clear the config cache (`php artisan config:cache`). The entrance is off by default.

## Set or change the password

- On the server: `sudo -u kanka php artisan entrance:password` (asks twice, minimum 10 characters), or `--clear` to remove it. Without a password the entrance stays closed to visitors.
- In the browser: Settings -> `/settings/entrance`, for the accounts in `ENTRANCE_MANAGER_IDS` only (asks to confirm your account password first).
- `php artisan entrance:status` shows enabled / configured / last changed (never the hash).

Changing the password makes everyone enter again. The hash is kept in `storage/app/entrance/entrance.json` (directory 0700, file 0600), never in the database or logs.

## What visitors can see

1. Make the campaign **Public** (campaign settings -> visibility).
2. Give the campaign's **Public** role read permission for the entity types players may see.
3. Keep DM notes private: mark entries, posts and attributes as private / admin-only. Guests never see those, and the Public role is read-only.

## Things to know

- Uploaded images under `/storage` are static files served directly by the web server. They are **not** gated by the entrance. Their paths are random, but anyone holding a direct link can load them.
- Use HTTPS. The entrance cookie is only marked Secure when the request is HTTPS (or `SESSION_SECURE_COOKIE=true`).
- The API (`/api`), webhooks and OAuth endpoints are not behind the entrance; they have their own authentication.
- Failed attempts are limited to 5 per minute and 30 per hour per IP. Failures are logged as "Failed entrance attempt" with the IP only.
