import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PlatformError } from "../errors.ts";
import type {
  AttachmentRecord,
  ConversationRecord,
  KnowledgeChunkRecord,
  KnowledgeDocumentRecord,
  MemoryRecord,
  MessageRecord,
  ProjectRecord,
  UserRecord,
} from "./database.ts";

type PgResult = { rows: Record<string, unknown>[]; rowCount: number | null };
type PgQueryable = {
  query: (text: string, params?: unknown[]) => Promise<PgResult>;
};
type PgPool = PgQueryable & {
  connect: () => Promise<PgQueryable & { release: () => void }>;
  end: () => Promise<void>;
};

function loadPg() {
  try {
    return createRequire(import.meta.url)("pg") as { Pool: new (config: object) => PgPool };
  } catch {
    throw new Error("The pg package is required for PostgreSQL. Run npm.cmd install in ASH-AI-PLATFORM.");
  }
}

function toPg(sql: string) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function postgresHost(connectionString: string) {
  try {
    return new URL(connectionString.replace(/^postgres(ql)?:/i, "http:")).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return "";
  }
}

export function postgresPoolSsl(connectionString: string) {
  const host = postgresHost(connectionString);
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") return false;
  // TLS stays on. Supabase's pooler chain is rejected by Node 24 as SELF_SIGNED_CERT_IN_CHAIN
  // when rejectUnauthorized is true, which blocked every hosted login and register.
  return { rejectUnauthorized: false };
}

function asBuffer(value: unknown) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  }
  if (typeof value === "string") {
    const hex = value.startsWith("\\x") || value.startsWith("\\\\x")
      ? value.replace(/^\\+x/i, "")
      : /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0
        ? value
        : "";
    if (hex) return Buffer.from(hex, "hex");
  }
  throw new Error("Password material must be binary.");
}

function pgCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
}

function pgConstraint(error: unknown) {
  return error && typeof error === "object" && "constraint" in error ? String((error as { constraint: string }).constraint) : "";
}

function logSchemaWarning(scope: string, error: unknown) {
  const err = error && typeof error === "object" ? error as Record<string, unknown> : {};
  console.error(JSON.stringify({
    level: "error",
    scope,
    driverCode: typeof err.code === "string" ? err.code : undefined,
    message: String(err.message || error).slice(0, 400),
  }));
}

export class PostgresDatabase {
  private readonly pool: PgPool;
  private readonly applyMigrations: boolean;
  private readonly migrationsDirectory: string;
  private readonly skipOwnerSchema: boolean;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string, options: {
    applyMigrations?: boolean;
    migrationsDirectory?: string;
    pool?: PgPool;
    skipOwnerSchema?: boolean;
  } = {}) {
    if (options.pool) {
      this.pool = options.pool;
    } else {
      const { Pool } = loadPg();
      this.pool = new Pool({
        connectionString,
        max: 5,
        ssl: postgresPoolSsl(connectionString),
      });
    }
    this.applyMigrations = options.applyMigrations === true;
    this.migrationsDirectory = options.migrationsDirectory || path.resolve("supabase", "migrations");
    this.skipOwnerSchema = options.skipOwnerSchema === true;
  }

  private async ensure() {
    if (!this.ready) {
      this.ready = this.boot().catch((error) => {
        this.ready = null;
        throw error;
      });
    }
    await this.ready;
  }

  private async boot() {
    const listed = await this.pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    const expected = new Set([
      "schema_migrations", "users", "sessions", "projects", "conversations", "messages",
      "attachments", "memories", "knowledge_documents", "knowledge_chunks",
    ]);
    const names = listed.rows.map((row) => String(row.table_name));
    const unexpected = names.filter((name) => !expected.has(name));
    if (unexpected.length) {
      throw new PlatformError(
        "provider_unavailable",
        "PostgreSQL public schema contains unexpected tables. Setup was not applied.",
        503,
      );
    }
    const tables = names.includes("users");
    if (tables) {
      if (!this.skipOwnerSchema) await this.ensureOwnerSchema();
      if (!this.applyMigrations) return;
    }
    if (!this.applyMigrations) {
      throw new PlatformError(
        "provider_unavailable",
        "PostgreSQL has no ASH AI tables yet. Apply supabase/migrations in the Supabase SQL editor after owner approval.",
        503,
      );
    }
    const files = [
      "20261101_001_init.sql",
      "20261101_002_rls.sql",
      "20261102_004_owner.sql",
    ];
    for (const file of files) {
      const sql = readFileSync(path.join(this.migrationsDirectory, file), "utf8");
      await this.pool.query(sql);
    }
    await this.ensureOwnerSchema();
  }

  private async ensureOwnerSchema() {
    await this.pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_owner INTEGER NOT NULL DEFAULT 0");
    try {
      await this.pool.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata TEXT");
    } catch (error) {
      logSchemaWarning("messages_metadata", error);
    }
    try {
      await this.pool.query("CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner ON users (is_owner) WHERE is_owner = 1");
    } catch (error) {
      logSchemaWarning("users_single_owner", error);
    }
    try {
      await this.pool.query(`
        UPDATE users SET is_owner = 1
        WHERE id = (SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1)
          AND NOT EXISTS (SELECT 1 FROM users WHERE is_owner = 1)
      `);
    } catch (error) {
      logSchemaWarning("promote_existing_owner", error);
    }
  }

  private async transact<T>(work: (query: (sql: string, params?: unknown[]) => Promise<PgResult>) => Promise<T>) {
    await this.ensure();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work((sql, params = []) => client.query(toPg(sql), params));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  private async run(sql: string, params: unknown[] = []) {
    await this.ensure();
    return this.pool.query(toPg(sql), params);
  }

  private async one(sql: string, params: unknown[] = []) {
    const result = await this.run(sql, params);
    return result.rows[0];
  }

  private async many(sql: string, params: unknown[] = []) {
    return (await this.run(sql, params)).rows;
  }

  private async insertUser(user: UserRecord, createdAt: number, isOwner?: number) {
    const salt = Buffer.from(user.passwordSalt);
    const hash = Buffer.from(user.passwordHash);
    const ownerSql = isOwner === undefined
      ? "CASE WHEN EXISTS (SELECT 1 FROM users WHERE is_owner = 1) THEN 0 ELSE 1 END"
      : "?";
    const params = isOwner === undefined
      ? [user.id, user.email, salt, hash, createdAt]
      : [user.id, user.email, salt, hash, createdAt, isOwner];
    const result = await this.run(
      `INSERT INTO users (id, email, password_salt, password_hash, created_at, is_owner)
       VALUES (?, ?, ?::bytea, ?::bytea, ?::bigint, ${ownerSql})
       RETURNING is_owner`,
      params,
    );
    user.isOwner = Boolean(Number(result.rows[0]?.is_owner));
  }

  private rethrowUserInsert(error: unknown): never {
    const constraint = `${pgConstraint(error)} ${error instanceof Error ? error.message : ""}`;
    if (pgCode(error) === "23505" && /email/i.test(constraint)) throw new Error("UNIQUE constraint failed");
    throw error;
  }

  async createUser(user: UserRecord, createdAt: number) {
    try {
      await this.insertUser(user, createdAt);
    } catch (error) {
      if (pgCode(error) === "42703") {
        await this.ensureOwnerSchema();
        await this.insertUser(user, createdAt);
        return;
      }
      if (pgCode(error) === "23505" && /email/i.test(`${pgConstraint(error)} ${error instanceof Error ? error.message : ""}`)) {
        throw new Error("UNIQUE constraint failed");
      }
      if (pgCode(error) === "23505") {
        try {
          await this.insertUser(user, createdAt, 0);
          return;
        } catch (second) {
          this.rethrowUserInsert(second);
        }
      }
      throw error;
    }
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.one("SELECT id, email, password_salt, password_hash, is_owner FROM users WHERE email = ?", [email]);
    return row ? {
      id: String(row.id),
      email: String(row.email),
      passwordSalt: asBuffer(row.password_salt),
      passwordHash: asBuffer(row.password_hash),
      isOwner: Boolean(row.is_owner),
    } : null;
  }

  async findUserById(id: string) {
    const row = await this.one("SELECT id, email, is_owner FROM users WHERE id = ?", [id]);
    return row ? { id: String(row.id), email: String(row.email), isOwner: Boolean(row.is_owner) } : null;
  }

  async deleteUser(userId: string) {
    await this.run("DELETE FROM users WHERE id = ?", [userId]);
  }

  async listUserIds() {
    return (await this.many("SELECT id FROM users")).map((row) => String(row.id));
  }

  async createSession(tokenHash: string, userId: string, expiresAt: number, createdAt: number) {
    await this.run(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
      [tokenHash, userId, expiresAt, createdAt],
    );
  }

  async findSession(tokenHash: string, now: number) {
    const row = await this.one(
      "SELECT users.id, users.email, users.is_owner, sessions.expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?",
      [tokenHash],
    );
    if (!row) return null;
    if (Number(row.expires_at) <= now) {
      await this.deleteSession(tokenHash);
      return null;
    }
    return { id: String(row.id), email: String(row.email), isOwner: Boolean(row.is_owner), expiresAt: Number(row.expires_at) };
  }

  async deleteSession(tokenHash: string) {
    await this.run("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]);
  }

  async deleteUserSessions(userId: string) {
    await this.run("DELETE FROM sessions WHERE user_id = ?", [userId]);
  }

  async createConversation(userId: string, conversationId: string, title: string, now: number, projectId: string | null = null) {
    await this.run(
      "INSERT INTO conversations (id, user_id, title, created_at, updated_at, project_id) VALUES (?, ?, ?, ?, ?, ?)",
      [conversationId, userId, title, now, now, projectId],
    );
  }

  async renameConversation(userId: string, conversationId: string, title: string, now: number) {
    const result = await this.run(
      "UPDATE conversations SET title = ?, updated_at = ? WHERE user_id = ? AND id = ?",
      [title, now, userId, conversationId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listConversations(userId: string, query = "", projectId?: string | null): Promise<ConversationRecord[]> {
    const projectClause = projectId === undefined
      ? ""
      : projectId === null
        ? "AND conversations.project_id IS NULL"
        : "AND conversations.project_id = ?";
    const searchClause = query
      ? `AND (conversations.title LIKE ? OR EXISTS (
            SELECT 1 FROM messages AS search_messages
            WHERE search_messages.user_id = conversations.user_id
              AND search_messages.conversation_id = conversations.id
              AND search_messages.content LIKE ?
          ))`
      : "";
    const params: unknown[] = [userId];
    if (projectId) params.push(projectId);
    if (query) params.push(`%${query}%`, `%${query}%`);
    const rows = await this.many(`
      SELECT conversations.id, conversations.title, conversations.created_at, conversations.updated_at,
             conversations.project_id, COUNT(messages.id) AS message_count
      FROM conversations
      LEFT JOIN messages ON messages.user_id = conversations.user_id AND messages.conversation_id = conversations.id
      WHERE conversations.user_id = ?
        ${projectClause}
        ${searchClause}
      GROUP BY conversations.user_id, conversations.id, conversations.title, conversations.created_at, conversations.updated_at, conversations.project_id
      ORDER BY conversations.updated_at DESC
      LIMIT 100
    `, params);
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      messageCount: Number(row.message_count ?? 0),
      projectId: (row.project_id as string | null) ?? null,
    }));
  }

  async findConversation(userId: string, conversationId: string): Promise<ConversationRecord | null> {
    const row = await this.one(
      "SELECT id, title, created_at, updated_at, project_id FROM conversations WHERE user_id = ? AND id = ?",
      [userId, conversationId],
    );
    return row ? {
      id: String(row.id),
      title: String(row.title),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      projectId: (row.project_id as string | null) ?? null,
    } : null;
  }

  async appendMessage(userId: string, conversationId: string, message: MessageRecord) {
    await this.run(
      "INSERT INTO messages (id, user_id, conversation_id, role, content, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [message.id, userId, conversationId, message.role, message.content, message.createdAt, message.metadata ?? null],
    );
    await this.run(
      "UPDATE conversations SET updated_at = ? WHERE user_id = ? AND id = ?",
      [message.createdAt, userId, conversationId],
    );
  }

  async listMessages(userId: string, conversationId: string): Promise<MessageRecord[]> {
    const rows = await this.many(
      "SELECT id, role, content, created_at, metadata FROM messages WHERE user_id = ? AND conversation_id = ? ORDER BY created_at, id",
      [userId, conversationId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      role: row.role as "user" | "assistant",
      content: String(row.content),
      createdAt: Number(row.created_at),
      metadata: (row.metadata as string | null) ?? null,
    }));
  }

  async deleteMessagesFrom(userId: string, conversationId: string, createdAt: number) {
    await this.run(
      "DELETE FROM messages WHERE user_id = ? AND conversation_id = ? AND created_at >= ?",
      [userId, conversationId, createdAt],
    );
  }

  async findMessage(userId: string, conversationId: string, messageId: string) {
    const row = await this.one(
      "SELECT id, role, content, created_at, metadata FROM messages WHERE user_id = ? AND conversation_id = ? AND id = ?",
      [userId, conversationId, messageId],
    );
    return row ? {
      id: String(row.id),
      role: row.role as "user" | "assistant",
      content: String(row.content),
      createdAt: Number(row.created_at),
      metadata: (row.metadata as string | null) ?? null,
    } : null;
  }

  async deleteConversation(userId: string, conversationId: string) {
    const result = await this.run("DELETE FROM conversations WHERE user_id = ? AND id = ?", [userId, conversationId]);
    return (result.rowCount ?? 0) > 0;
  }

  async createProject(userId: string, project: ProjectRecord) {
    await this.run(
      "INSERT INTO projects (id, user_id, name, instructions, local_only, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [project.id, userId, project.name, project.instructions, project.localOnly ? 1 : 0, project.createdAt, project.updatedAt],
    );
  }

  async listProjects(userId: string): Promise<ProjectRecord[]> {
    const rows = await this.many(
      "SELECT id, name, instructions, local_only, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC",
      [userId],
    );
    return rows.map((row) => this.mapProject(row));
  }

  async findProject(userId: string, projectId: string): Promise<ProjectRecord | null> {
    const row = await this.one(
      "SELECT id, name, instructions, local_only, created_at, updated_at FROM projects WHERE user_id = ? AND id = ?",
      [userId, projectId],
    );
    return row ? this.mapProject(row) : null;
  }

  async updateProject(userId: string, projectId: string, patch: { name?: string; instructions?: string; localOnly?: boolean }, now: number) {
    const current = await this.findProject(userId, projectId);
    if (!current) return false;
    await this.run(
      "UPDATE projects SET name = ?, instructions = ?, local_only = ?, updated_at = ? WHERE user_id = ? AND id = ?",
      [patch.name ?? current.name, patch.instructions ?? current.instructions, (patch.localOnly ?? current.localOnly) ? 1 : 0, now, userId, projectId],
    );
    return true;
  }

  async deleteProject(userId: string, projectId: string) {
    await this.run("UPDATE conversations SET project_id = NULL WHERE user_id = ? AND project_id = ?", [userId, projectId]);
    const result = await this.run("DELETE FROM projects WHERE user_id = ? AND id = ?", [userId, projectId]);
    return (result.rowCount ?? 0) > 0;
  }

  async createAttachment(record: AttachmentRecord) {
    await this.run(`
      INSERT INTO attachments (id, user_id, project_id, conversation_id, kind, file_name, mime_type, size, storage_name, extracted_text, page_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      record.id, record.userId, record.projectId, record.conversationId, record.kind, record.fileName,
      record.mimeType, record.size, record.storageName, record.extractedText, record.pageCount, record.createdAt,
    ]);
  }

  async findAttachment(userId: string, attachmentId: string): Promise<AttachmentRecord | null> {
    const row = await this.one("SELECT * FROM attachments WHERE user_id = ? AND id = ?", [userId, attachmentId]);
    return row ? this.mapAttachment(row) : null;
  }

  async listAttachments(userId: string, projectId?: string | null) {
    const rows = projectId
      ? await this.many("SELECT * FROM attachments WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC", [userId, projectId])
      : await this.many("SELECT * FROM attachments WHERE user_id = ? ORDER BY created_at DESC LIMIT 200", [userId]);
    return rows.map((row) => this.mapAttachment(row));
  }

  async deleteAttachment(userId: string, attachmentId: string) {
    const current = await this.findAttachment(userId, attachmentId);
    if (!current) return null;
    await this.run("DELETE FROM attachments WHERE user_id = ? AND id = ?", [userId, attachmentId]);
    return current;
  }

  async createMemory(userId: string, memory: MemoryRecord) {
    await this.run(
      "INSERT INTO memories (id, user_id, scope, project_id, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [memory.id, userId, memory.scope, memory.projectId, memory.content, memory.status, memory.createdAt, memory.updatedAt],
    );
  }

  async listMemories(userId: string, scope?: "personal" | "project", projectId?: string | null, status?: "pending" | "approved") {
    const clauses = ["user_id = ?"];
    const params: unknown[] = [userId];
    if (scope) {
      clauses.push("scope = ?");
      params.push(scope);
    }
    if (projectId !== undefined) {
      if (projectId === null) clauses.push("project_id IS NULL");
      else {
        clauses.push("project_id = ?");
        params.push(projectId);
      }
    }
    if (status) {
      clauses.push("status = ?");
      params.push(status);
    }
    const rows = await this.many(`
      SELECT id, scope, project_id, content, status, created_at, updated_at FROM memories
      WHERE ${clauses.join(" AND ")}
      ORDER BY updated_at DESC
    `, params);
    return rows.map((row) => ({
      id: String(row.id),
      scope: row.scope as "personal" | "project",
      projectId: (row.project_id as string | null) ?? null,
      content: String(row.content),
      status: row.status as "pending" | "approved",
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
  }

  async updateMemory(userId: string, memoryId: string, patch: { content?: string; status?: "pending" | "approved" }, now: number) {
    const row = await this.one("SELECT content, status FROM memories WHERE user_id = ? AND id = ?", [userId, memoryId]);
    if (!row) return false;
    await this.run("UPDATE memories SET content = ?, status = ?, updated_at = ? WHERE user_id = ? AND id = ?", [
      patch.content ?? String(row.content),
      patch.status ?? String(row.status),
      now,
      userId,
      memoryId,
    ]);
    return true;
  }

  async deleteMemory(userId: string, memoryId: string) {
    const result = await this.run("DELETE FROM memories WHERE user_id = ? AND id = ?", [userId, memoryId]);
    return (result.rowCount ?? 0) > 0;
  }

  async createKnowledgeDocument(userId: string, document: KnowledgeDocumentRecord) {
    await this.run(
      "INSERT INTO knowledge_documents (id, user_id, project_id, attachment_id, title, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [document.id, userId, document.projectId, document.attachmentId, document.title, document.createdAt],
    );
  }

  async createKnowledgeChunk(userId: string, chunk: KnowledgeChunkRecord) {
    await this.run(
      "INSERT INTO knowledge_chunks (id, user_id, document_id, project_id, ordinal, content, embedding, page) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [chunk.id, userId, chunk.documentId, chunk.projectId, chunk.ordinal, chunk.content, chunk.embedding, chunk.page],
    );
  }

  async listKnowledgeChunks(userId: string, projectId: string | null) {
    const rows = projectId === null
      ? await this.many(
        "SELECT id, document_id, project_id, ordinal, content, embedding, page FROM knowledge_chunks WHERE user_id = ? AND project_id IS NULL ORDER BY ordinal",
        [userId],
      )
      : await this.many(
        "SELECT id, document_id, project_id, ordinal, content, embedding, page FROM knowledge_chunks WHERE user_id = ? AND project_id = ? ORDER BY ordinal",
        [userId, projectId],
      );
    return rows.map((row) => ({
      id: String(row.id),
      documentId: String(row.document_id),
      projectId: (row.project_id as string | null) ?? null,
      ordinal: Number(row.ordinal),
      content: String(row.content),
      embedding: (row.embedding as string | null) ?? null,
      page: row.page === null || row.page === undefined ? null : Number(row.page),
    }));
  }

  async exportUser(userId: string) {
    return {
      user: await this.findUserById(userId),
      conversations: await this.listConversations(userId),
      projects: await this.listProjects(userId),
      memories: await this.listMemories(userId),
      attachments: (await this.listAttachments(userId)).map((item) => ({ ...item, storageName: undefined })),
    };
  }

  private mapProject(row: Record<string, unknown>): ProjectRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      instructions: String(row.instructions),
      localOnly: Boolean(row.local_only),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private mapAttachment(row: Record<string, unknown>): AttachmentRecord {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      projectId: (row.project_id as string | null) ?? null,
      conversationId: (row.conversation_id as string | null) ?? null,
      kind: row.kind as "image" | "pdf",
      fileName: String(row.file_name),
      mimeType: String(row.mime_type),
      size: Number(row.size),
      storageName: String(row.storage_name),
      extractedText: String(row.extracted_text ?? ""),
      pageCount: Number(row.page_count ?? 0),
      createdAt: Number(row.created_at),
    };
  }

  async close() {
    await this.pool.end();
  }
}
