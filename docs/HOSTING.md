# Hosted private test

See [HOSTING-SETUP.md](./HOSTING-SETUP.md) for dashboard steps.

**What changed in the schema:** Postgres now creates `projects` before `conversations` and uses composite foreign keys `(user_id, project_id)`, `(user_id, conversation_id)` and `(user_id, document_id)` so one account cannot point at another account’s rows. Memory rows must match their scope. RLS still denies `anon` / `authenticated`. Storage bucket `ash-private-files` is private and restricted.

**What this PC should not do:** do not put the production database URL or service role in `.env.local`, and do not re-run the SQL against the live database as a routine step. The four files in `supabase/migrations` are the hosted schema, including `20261102_004_owner.sql`. Local SQLite is a separate database.

Hosted mode **requires** `DATABASE_URL` (Postgres) plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. SQLite remains for this PC only. Keep `ASH_PLATFORM_APPLY_MIGRATIONS=0` on Render.

Render free services sleep. The first request after idle can take ~50 seconds.
