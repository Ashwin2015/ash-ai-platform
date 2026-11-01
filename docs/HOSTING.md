# Hosted private test

See [HOSTING-SETUP.md](./HOSTING-SETUP.md) for dashboard steps.

**What changed in the schema:** Postgres now creates `projects` before `conversations` and uses composite foreign keys `(user_id, project_id)`, `(user_id, conversation_id)` and `(user_id, document_id)` so one account cannot point at another account’s rows. Memory rows must match their scope. RLS still denies `anon` / `authenticated`. Storage bucket `ash-private-files` is private and restricted.

**What was executed against Supabase:** nothing from this workstation. `DATABASE_URL` and the service role are not present in local env. Apply SQL in the dashboard or `npm.cmd run apply:supabase` after you set those secrets locally for one run.

Hosted mode **requires** `DATABASE_URL` (Postgres) plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. SQLite remains for this PC only. Keep `ASH_PLATFORM_APPLY_MIGRATIONS=0` on Render.

Render free services sleep. The first request after idle can take ~50 seconds.
