# ASH AI hosting setup

Do not deploy until SQL has been applied in Supabase.

Dedicated project: **ASH AI Production**, id `pqrzjwynarkbadzbpuvw`, Europe (Paris), free. Public API URL: `https://pqrzjwynarkbadzbpuvw.supabase.co`

## Apply the database (required)

In the Supabase SQL editor, run these files **in order**. They are idempotent (`IF NOT EXISTS` / `ON CONFLICT`).

1. `supabase/migrations/20261101_001_init.sql` — tables, indexes, ownership foreign keys  
2. `supabase/migrations/20261101_002_rls.sql` — RLS deny + revoke from `anon`/`authenticated`  
3. `supabase/migrations/20261101_003_storage.sql` — private bucket `ash-private-files`  

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
- `ASH_PLATFORM_BOOTSTRAP_KEY` (unused by registration; safe to leave set)
- `ASH_PLATFORM_INVITE_CODE` (unused by registration; safe to leave set)
- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`

Leave `ASH_CHAT_PUBLIC_ORIGIN` empty. Never put the service role or API keys in the frontend.

## Backup

Local: `npm.cmd run backup` copies SQLite under `.data/backups/`. Hosted: use Supabase dashboard backups / point-in-time if your plan includes it. Account export: `GET /api/v1/account/export` while signed in.
