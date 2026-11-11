# ASH AI hosting setup

The hosted service is already running. Do not re-apply these SQL files against the live database unless you are adding a new migration. They are additive, but a second manual run is not a routine step.

Dedicated project: **ASH AI Production**, id `pqrzjwynarkbadzbpuvw`, Europe (Paris), free. Public API URL: `https://pqrzjwynarkbadzbpuvw.supabase.co`

## Apply the database (required)

In the Supabase SQL editor, run these files **in order**. They are idempotent (`IF NOT EXISTS` / `ON CONFLICT`).

1. `supabase/migrations/20261101_001_init.sql` — tables, indexes, ownership foreign keys  
2. `supabase/migrations/20261101_002_rls.sql` — RLS deny + revoke from `anon`/`authenticated`  
3. `supabase/migrations/20261101_003_storage.sql` — private bucket `ash-private-files`  
4. `supabase/migrations/20261102_004_owner.sql` — `users.is_owner`  

Or set `DATABASE_URL` (session pooler) in your shell only, then:

`npm.cmd run apply:supabase`

If the script reports unexpected public tables, stop and inspect. It will not delete them.

After 001: tables exist. After 002: RLS is on. After 003: bucket is private. Keep `ASH_PLATFORM_APPLY_MIGRATIONS=0` on Render.

Do not upload the local SQLite file. Invite-gated accounts do not send a verification email; `email_verified` default `1` only means SMTP is not used.

## Render environment names

Set as values:

- `NODE_VERSION` = `24.13.0`
- `ASH_PLATFORM_HOST` = `0.0.0.0`
- `ASH_PLATFORM_SERVE_CHAT` = `1`
- `ASH_PLATFORM_APPLY_MIGRATIONS` = `0`
- `SUPABASE_STORAGE_BUCKET` = `ash-private-files`
- `SUPABASE_URL` = `https://pqrzjwynarkbadzbpuvw.supabase.co`

Set as secrets:

- `ASH_PLATFORM_PUBLIC_ORIGIN`
- `DATABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ASH_PLATFORM_BOOTSTRAP_KEY` (unused by the server; safe to leave set)
- `ASH_PLATFORM_INVITE_CODE` (required for new registration when non-empty; existing accounts still sign in without it)
- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`

Leave `ASH_CHAT_PUBLIC_ORIGIN` empty. Never put the service role or API keys in the frontend.

## Backup

Local: `npm.cmd run backup` writes the SQLite file plus any `-wal` and `-shm` companions under `.data/backups/`. The 8 Nov snapshot is empty of accounts. It is not a copy of the hosted database.

Hosted accounts are in Supabase project `pqrzjwynarkbadzbpuvw`. The free plan does not provide a scheduled backup. This machine has no `DATABASE_URL`, so no production dump was taken. After approval, dump with `pg_dump` and restore into a new database only. See `docs/ASH-SECURITY-AND-RECOVERY.md`. Account export (`GET /api/v1/account/export`) is one signed-in account, not a full database backup.
