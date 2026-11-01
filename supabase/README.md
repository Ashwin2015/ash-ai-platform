# Supabase migrations

Apply in the **ASH AI Production** SQL editor (`pqrzjwynarkbadzbpuvw`), in this order:

1. `migrations/20261101_001_init.sql`
2. `migrations/20261101_002_rls.sql`
3. `migrations/20261101_003_storage.sql`

Or, with `DATABASE_URL` set in the environment (not in Git):

```powershell
npm.cmd run apply:supabase
```

The script stops if unexpected public tables exist. It does not drop data.

Do not set `ASH_PLATFORM_APPLY_MIGRATIONS=1` on Render. Local SQLite is unchanged.
