# Security and recovery

## Accounts

Passwords use scrypt. Session tokens are random and stored as SHA-256. Cookie requests require a CSRF token. Registration checks `ASH_PLATFORM_INVITE_CODE` when it is non-empty, before a user row is created. The owner flag does not grant access to other accounts.

Queries and files include the user id. Another user's conversation or attachment returns 404 in the automated tests.

Auth attempts are limited to 30 per minute per client address. Chat posts are limited to 40 per minute per user. Both limits live in the Node process and clear on restart.

## What is not claimed

No MFA, no team roles, no shared projects, no email password reset, and no external security review.

## Local recovery

`npm run backup` copies the local SQLite file and its `-wal` and `-shm` companions into `.data/backups/ash-platform-<timestamp>/`. It exits if `DATABASE_URL` is set, so it cannot be mistaken for a hosted backup.

The snapshot `ash-platform-2026-11-08T19-43-33-942Z` was opened in a temporary copy. `PRAGMA integrity_check` returned `ok`. The tables exist and the row counts were 0. That file is not a production backup and must not be restored over the hosted database.

Source snapshots, with `.env`, `.env.local`, `.git`, `node_modules`, and `.data` excluded:

- `.data/source-backups/pre-foundation-docs-20261108` (102 files)
- `.data/source-backups/pre-core-extract-20261108` (102 files)
- `.data/source-backups/pre-final-verification-20261110` (150 files)
- `.data/source-backups/pre-release-prep-20261111` (162 files; Android sources included; no APK, no keystore, no `.env.local`)

## Signing key

The release keystore and `keystore.properties` live only in `%LOCALAPPDATA%\ASH\keys`. They are outside this Git repository. A second copy on this same PC is in `%LOCALAPPDATA%\ASH\keys\backup-2026-11-11`. That copy is not a secure backup: it is lost with this disk.

Checked 2026-11-11: there is no removable drive. `E:` is an empty optical drive. `D:` is an internal fixed disk, and BitLocker status could not be read. No external encrypted destination was available, so the key was not copied off this PC. Before publishing, copy both files to an encrypted drive you control. Do not put them in Git, chat, or the website. Future APKs must use alias `ash-chat` and a higher `versionCode`.

## Hosted recovery

Checked 2026-11-11: this PC has no `DATABASE_URL`, no Supabase access token, no Render API token, and no `pg_dump`, `supabase`, or `render` command. A production dump cannot be created with the access on this machine. The hosted project is Supabase `pqrzjwynarkbadzbpuvw` (ASH AI Production, free). The free plan does not include scheduled backups in the dashboard. Do not pay for a plan unless you approve that cost. Do not run `pg_dump` until the destination and the exact command are approved.

To take a real backup after you approve it:

1. Copy `DATABASE_URL` from the Render dashboard into a shell that is not saved to Git.
2. Run `pg_dump --format=custom --no-owner --file <path-outside-git> "$DATABASE_URL"`.
3. Restore only into a new empty database: `pg_restore --no-owner --dbname <new-database-url> <dump>`.
4. Point a temporary local server at that new URL. Do not change the Render `DATABASE_URL`.
5. Delete the dump when the check is finished. Do not commit it.

Storage objects in bucket `ash-private-files` are not inside that SQL dump. Export them from the Supabase storage UI only if you approve a file backup. Do not upload the local SQLite file. Do not re-run the four SQL migrations as a routine step.

Rollback of application code is a Git revert on `main`, which the existing Render service deploys. Do not change env vars as part of that rollback.

## Core export

`node scripts/verify-ash-ai-core.mjs <folder>` fails if the folder contains `.env` files, SQLite files, or connection strings. A core export cannot restore user accounts.
