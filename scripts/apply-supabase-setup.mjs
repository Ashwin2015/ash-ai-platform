import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUR_TABLES = [
  "schema_migrations",
  "users",
  "sessions",
  "projects",
  "conversations",
  "messages",
  "attachments",
  "memories",
  "knowledge_documents",
  "knowledge_chunks",
];
const FILES = [
  "20261101_001_init.sql",
  "20261101_002_rls.sql",
  "20261101_003_storage.sql",
  "20261102_004_owner.sql",
];

function loadEnvFile(filePath) {
  try {
    for (const raw of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const name = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[name] === undefined) process.env[name] = value;
    }
  } catch {}
}

loadEnvFile(path.join(root, ".env"));
loadEnvFile(path.join(root, ".env.local"));

const databaseUrl = process.env.DATABASE_URL || process.env.ASH_PLATFORM_DATABASE_URL || "";
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add the Supabase session-pooler URI in the environment, then rerun:");
  console.error("  npm.cmd run apply:supabase");
  process.exit(2);
}
if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
  console.error("DATABASE_URL must be a postgres:// or postgresql:// URI.");
  process.exit(2);
}

const { Pool } = createRequire(import.meta.url)("pg");
const { postgresPoolSsl } = await import("../src/storage/postgres.ts");
const pool = new Pool({ connectionString: databaseUrl, ssl: postgresPoolSsl(databaseUrl), max: 1 });

try {
  const existing = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const names = existing.rows.map((row) => String(row.table_name));
  const unexpected = names.filter((name) => !OUR_TABLES.includes(name));
  if (unexpected.length) {
    console.error("Stopped: unexpected public tables were found. Nothing was deleted.");
    console.error(`Tables: ${unexpected.join(", ")}`);
    process.exit(3);
  }

  const applied = names.includes("schema_migrations")
    ? (await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map((row) => String(row.version))
    : [];

  for (const file of FILES) {
    const version = file.replace(/\.sql$/, "");
    if (applied.includes(version)) {
      console.info(`Already applied: ${file}`);
      continue;
    }
    const sql = readFileSync(path.join(root, "supabase", "migrations", file), "utf8");
    await pool.query(sql);
    console.info(`Applied: ${file}`);
  }
  console.info("Supabase setup finished. Keep ASH_PLATFORM_APPLY_MIGRATIONS=0 on Render.");
} catch (error) {
  const message = error instanceof Error ? error.message.replace(databaseUrl, "[redacted]") : "query failed";
  console.error(`Setup failed: ${message}`);
  process.exit(1);
} finally {
  await pool.end();
}
