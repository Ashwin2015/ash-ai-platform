import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { AuthService } from "../src/security/auth.ts";
import { PostgresDatabase } from "../src/storage/postgres.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const initSql = readFileSync(path.join(root, "supabase", "migrations", "20261101_001_init.sql"), "utf8");
const oldInitSql = initSql
  .replace(/\s*,\s*is_owner INTEGER NOT NULL DEFAULT 0/, "")
  .replace(/CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner[\s\S]*?;/, "");

function fakePool(db) {
  const query = async (text, params = []) => {
    const result = await db.query(text, params);
    return { rows: result.rows || [], rowCount: result.affectedRows ?? result.rows?.length ?? 0 };
  };
  return {
    query,
    connect: async () => ({ query, release() {} }),
    end: async () => {},
  };
}

async function withPostgres(sql, options, work) {
  const db = new PGlite();
  await db.exec(sql);
  const database = new PostgresDatabase("postgres://pglite/test", {
    applyMigrations: false,
    pool: fakePool(db),
    ...options,
  });
  const auth = new AuthService(database, "", 3_600, () => Date.now());
  try {
    await work({ database, auth, db });
  } finally {
    await db.close();
  }
}

test("PostgreSQL registers the first account as owner and later accounts as users", async () => {
  await withPostgres(initSql, {}, async ({ auth, database }) => {
    const first = await auth.register("One@Example.test", "correct-horse-battery");
    assert.equal(first.email, "one@example.test");
    assert.equal(first.isOwner, true);
    const session = await auth.login("one@example.test", "correct-horse-battery");
    assert.equal(session.user.isOwner, true);
    const me = await auth.authenticate(`Bearer ${session.token}`);
    assert.equal(me.email, "one@example.test");

    const second = await auth.register("two@example.test", "another-strong-password");
    assert.equal(second.isOwner, false);
    const secondLogin = await auth.login("two@example.test", "another-strong-password");
    assert.equal(secondLogin.user.isOwner, false);

    await assert.rejects(
      () => auth.register("one@example.test", "correct-horse-battery"),
      /already exists/,
    );
    await assert.rejects(
      () => auth.login("one@example.test", "wrong-password-here"),
      /not accepted/,
    );

    await auth.revoke(`Bearer ${session.token}`);
    await assert.rejects(() => auth.authenticate(`Bearer ${session.token}`), /invalid or expired/);
    const again = await auth.login("one@example.test", "correct-horse-battery");
    assert.equal(again.user.isOwner, true);

    const now = Date.now();
    const conversationId = randomUUID();
    await database.createConversation(first.id, conversationId, "Owner chat", now);
    const own = await database.listConversations(first.id);
    const other = await database.listConversations(second.id);
    assert.equal(own.some((item) => item.id === conversationId), true);
    assert.equal(other.some((item) => item.id === conversationId), false);
  });
});

test("PostgreSQL adds is_owner on a pre-owner schema and then registers", async () => {
  await withPostgres(oldInitSql, { skipOwnerSchema: true }, async ({ auth }) => {
    const first = await auth.register("legacy@example.test", "correct-horse-battery");
    assert.equal(first.isOwner, true);
    const second = await auth.register("later@example.test", "another-strong-password");
    assert.equal(second.isOwner, false);
    const login = await auth.login("legacy@example.test", "correct-horse-battery");
    assert.equal(login.user.isOwner, true);
  });
});
