-- Additive: first registered account is the only owner. Existing rows are not deleted.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_owner INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner ON users (is_owner) WHERE is_owner = 1;
UPDATE users SET is_owner = 1
WHERE id = (SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM users WHERE is_owner = 1);
INSERT INTO schema_migrations (version)
VALUES ('20261102_004_owner')
ON CONFLICT (version) DO NOTHING;
