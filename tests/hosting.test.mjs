import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("postgres migration SQL matches local schema tables and is additive", () => {
  const init = readFileSync(path.join(root, "supabase", "migrations", "20261101_001_init.sql"), "utf8");
  for (const table of [
    "users", "sessions", "conversations", "messages", "projects",
    "attachments", "memories", "knowledge_documents", "knowledge_chunks", "schema_migrations",
  ]) {
    assert.match(init, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(init, /password_salt BYTEA/);
  assert.match(init, /email_verified/);
  assert.match(init, /FOREIGN KEY \(user_id, project_id\)/);
  assert.match(init, /FOREIGN KEY \(user_id, conversation_id\)/);
  assert.match(init, /FOREIGN KEY \(user_id, document_id\)/);
  assert.match(init, /scope = 'personal' AND project_id IS NULL/);
  assert.doesNotMatch(init, /DROP TABLE/i);
  assert.doesNotMatch(init, /TRUNCATE/i);
  const rls = readFileSync(path.join(root, "supabase", "migrations", "20261101_002_rls.sql"), "utf8");
  assert.match(rls, /ENABLE ROW LEVEL SECURITY/);
  assert.match(rls, /TO anon, authenticated USING \(false\)/);
  const storage = readFileSync(path.join(root, "supabase", "migrations", "20261101_003_storage.sql"), "utf8");
  assert.match(storage, /ash-private-files/);
  assert.match(storage, /AS RESTRICTIVE/);
  assert.match(storage, /VALUES \('ash-private-files'/);
});
