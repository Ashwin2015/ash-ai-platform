import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type UserRecord = { id: string; email: string; passwordSalt: Uint8Array; passwordHash: Uint8Array };
export type ConversationRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
  projectId?: string | null;
};
export type MessageRecord = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  metadata?: string | null;
};
export type ProjectRecord = {
  id: string;
  name: string;
  instructions: string;
  localOnly: boolean;
  createdAt: number;
  updatedAt: number;
};
export type AttachmentRecord = {
  id: string;
  userId: string;
  projectId: string | null;
  conversationId: string | null;
  kind: "image" | "pdf";
  fileName: string;
  mimeType: string;
  size: number;
  storageName: string;
  extractedText: string;
  pageCount: number;
  createdAt: number;
};
export type MemoryRecord = {
  id: string;
  scope: "personal" | "project";
  projectId: string | null;
  content: string;
  status: "pending" | "approved";
  createdAt: number;
  updatedAt: number;
};
export type KnowledgeDocumentRecord = {
  id: string;
  projectId: string | null;
  attachmentId: string | null;
  title: string;
  createdAt: number;
};
export type KnowledgeChunkRecord = {
  id: string;
  documentId: string;
  projectId: string | null;
  ordinal: number;
  content: string;
  embedding: string | null;
  page: number | null;
};

type UserRow = { id: string; email: string; password_salt: Uint8Array; password_hash: Uint8Array };
type ConversationRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count?: number;
  project_id?: string | null;
};
type MessageRow = { id: string; role: "user" | "assistant"; content: string; created_at: number; metadata?: string | null };

export class PlatformDatabase {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON");
    if (databasePath !== ":memory:") this.database.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    const version = this.database.prepare("PRAGMA user_version").get() as { user_version: number };
    if (version.user_version > 3) throw new Error("The platform database schema is newer than this application.");
    if (version.user_version < 1) {
      this.database.exec(`
        BEGIN;
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_salt BLOB NOT NULL,
          password_hash BLOB NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX sessions_user_id_idx ON sessions(user_id);
        CREATE TABLE conversations (
          id TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, id)
        );
        CREATE INDEX conversations_updated_idx ON conversations(user_id, updated_at DESC);
        CREATE TABLE messages (
          id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, conversation_id, id),
          FOREIGN KEY (user_id, conversation_id)
            REFERENCES conversations(user_id, id) ON DELETE CASCADE
        );
        CREATE INDEX messages_conversation_idx ON messages(user_id, conversation_id, created_at);
        PRAGMA user_version = 1;
        COMMIT;
      `);
    }
    const current = this.database.prepare("PRAGMA user_version").get() as { user_version: number };
    if (current.user_version === 1) {
      this.database.exec(`
        BEGIN;
        ALTER TABLE conversations ADD COLUMN project_id TEXT;
        ALTER TABLE messages ADD COLUMN metadata TEXT;
        CREATE TABLE projects (
          id TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          instructions TEXT NOT NULL DEFAULT '',
          local_only INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, id)
        );
        CREATE TABLE attachments (
          id TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_id TEXT,
          conversation_id TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('image', 'pdf')),
          file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size INTEGER NOT NULL,
          storage_name TEXT NOT NULL,
          extracted_text TEXT NOT NULL DEFAULT '',
          page_count INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, id)
        );
        CREATE TABLE memories (
          id TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          scope TEXT NOT NULL CHECK (scope IN ('personal', 'project')),
          project_id TEXT,
          content TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, id)
        );
        CREATE TABLE knowledge_documents (
          id TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_id TEXT,
          attachment_id TEXT,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, id)
        );
        CREATE TABLE knowledge_chunks (
          id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          document_id TEXT NOT NULL,
          project_id TEXT,
          ordinal INTEGER NOT NULL,
          content TEXT NOT NULL,
          embedding TEXT,
          page INTEGER,
          PRIMARY KEY (user_id, id)
        );
        CREATE INDEX attachments_user_idx ON attachments(user_id, created_at DESC);
        CREATE INDEX memories_user_idx ON memories(user_id, scope, status);
        CREATE INDEX knowledge_chunks_doc_idx ON knowledge_chunks(user_id, document_id, ordinal);
        PRAGMA user_version = 2;
        COMMIT;
      `);
    }
    const afterProjects = this.database.prepare("PRAGMA user_version").get() as { user_version: number };
    if (afterProjects.user_version === 2) {
      this.database.exec(`
        BEGIN;
        ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE users ADD COLUMN reset_token_hash TEXT;
        ALTER TABLE users ADD COLUMN reset_expires INTEGER;
        PRAGMA user_version = 3;
        COMMIT;
      `);
    }
  }

  createUser(user: UserRecord, createdAt: number) {
    this.database.prepare(
      "INSERT INTO users (id, email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(user.id, user.email, user.passwordSalt, user.passwordHash, createdAt);
  }

  findUserByEmail(email: string): UserRecord | null {
    const row = this.database.prepare(
      "SELECT id, email, password_salt, password_hash FROM users WHERE email = ?",
    ).get(email) as UserRow | undefined;
    return row ? { id: row.id, email: row.email, passwordSalt: row.password_salt, passwordHash: row.password_hash } : null;
  }

  findUserById(id: string) {
    const row = this.database.prepare("SELECT id, email FROM users WHERE id = ?").get(id) as { id: string; email: string } | undefined;
    return row ?? null;
  }

  deleteUser(userId: string) {
    this.database.prepare("DELETE FROM users WHERE id = ?").run(userId);
  }

  listUserIds() {
    return (this.database.prepare("SELECT id FROM users").all() as Array<{ id: string }>).map((row) => row.id);
  }

  createSession(tokenHash: string, userId: string, expiresAt: number, createdAt: number) {
    this.database.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    ).run(tokenHash, userId, expiresAt, createdAt);
  }

  findSession(tokenHash: string, now: number) {
    const row = this.database.prepare(
      "SELECT users.id, users.email, sessions.expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?",
    ).get(tokenHash) as { id: string; email: string; expires_at: number } | undefined;
    if (!row) return null;
    if (row.expires_at <= now) {
      this.deleteSession(tokenHash);
      return null;
    }
    return { id: row.id, email: row.email, expiresAt: row.expires_at };
  }

  deleteSession(tokenHash: string) {
    this.database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  deleteUserSessions(userId: string) {
    this.database.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  createConversation(userId: string, conversationId: string, title: string, now: number, projectId: string | null = null) {
    this.database.prepare(
      "INSERT INTO conversations (id, user_id, title, created_at, updated_at, project_id) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(conversationId, userId, title, now, now, projectId);
  }

  renameConversation(userId: string, conversationId: string, title: string, now: number) {
    return this.database.prepare(
      "UPDATE conversations SET title = ?, updated_at = ? WHERE user_id = ? AND id = ?",
    ).run(title, now, userId, conversationId).changes > 0;
  }

  listConversations(userId: string, query = "", projectId?: string | null): ConversationRecord[] {
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
    const rows = this.database.prepare(`
      SELECT conversations.id, conversations.title, conversations.created_at, conversations.updated_at,
             conversations.project_id, COUNT(messages.id) AS message_count
      FROM conversations
      LEFT JOIN messages ON messages.user_id = conversations.user_id AND messages.conversation_id = conversations.id
      WHERE conversations.user_id = ?
        ${projectClause}
        ${searchClause}
      GROUP BY conversations.user_id, conversations.id
      ORDER BY conversations.updated_at DESC
      LIMIT 100
    `).all(...params) as ConversationRow[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
      projectId: row.project_id ?? null,
    }));
  }

  findConversation(userId: string, conversationId: string): ConversationRecord | null {
    const row = this.database.prepare(
      "SELECT id, title, created_at, updated_at, project_id FROM conversations WHERE user_id = ? AND id = ?",
    ).get(userId, conversationId) as ConversationRow | undefined;
    return row ? {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      projectId: row.project_id ?? null,
    } : null;
  }

  appendMessage(userId: string, conversationId: string, message: MessageRecord) {
    this.database.prepare(
      "INSERT INTO messages (id, user_id, conversation_id, role, content, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(message.id, userId, conversationId, message.role, message.content, message.createdAt, message.metadata ?? null);
    this.database.prepare(
      "UPDATE conversations SET updated_at = ? WHERE user_id = ? AND id = ?",
    ).run(message.createdAt, userId, conversationId);
  }

  listMessages(userId: string, conversationId: string): MessageRecord[] {
    const rows = this.database.prepare(
      "SELECT id, role, content, created_at, metadata FROM messages WHERE user_id = ? AND conversation_id = ? ORDER BY created_at, id",
    ).all(userId, conversationId) as MessageRow[];
    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      metadata: row.metadata,
    }));
  }

  deleteMessagesFrom(userId: string, conversationId: string, createdAt: number) {
    this.database.prepare(
      "DELETE FROM messages WHERE user_id = ? AND conversation_id = ? AND created_at >= ?",
    ).run(userId, conversationId, createdAt);
  }

  findMessage(userId: string, conversationId: string, messageId: string) {
    const row = this.database.prepare(
      "SELECT id, role, content, created_at, metadata FROM messages WHERE user_id = ? AND conversation_id = ? AND id = ?",
    ).get(userId, conversationId, messageId) as MessageRow | undefined;
    return row ? {
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      metadata: row.metadata,
    } : null;
  }

  deleteConversation(userId: string, conversationId: string) {
    return this.database.prepare("DELETE FROM conversations WHERE user_id = ? AND id = ?").run(userId, conversationId).changes > 0;
  }

  createProject(userId: string, project: ProjectRecord) {
    this.database.prepare(
      "INSERT INTO projects (id, user_id, name, instructions, local_only, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(project.id, userId, project.name, project.instructions, project.localOnly ? 1 : 0, project.createdAt, project.updatedAt);
  }

  listProjects(userId: string): ProjectRecord[] {
    const rows = this.database.prepare(
      "SELECT id, name, instructions, local_only, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC",
    ).all(userId) as Array<{ id: string; name: string; instructions: string; local_only: number; created_at: number; updated_at: number }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      instructions: row.instructions,
      localOnly: Boolean(row.local_only),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  findProject(userId: string, projectId: string): ProjectRecord | null {
    const row = this.database.prepare(
      "SELECT id, name, instructions, local_only, created_at, updated_at FROM projects WHERE user_id = ? AND id = ?",
    ).get(userId, projectId) as { id: string; name: string; instructions: string; local_only: number; created_at: number; updated_at: number } | undefined;
    return row ? {
      id: row.id,
      name: row.name,
      instructions: row.instructions,
      localOnly: Boolean(row.local_only),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } : null;
  }

  updateProject(userId: string, projectId: string, patch: { name?: string; instructions?: string; localOnly?: boolean }, now: number) {
    const current = this.findProject(userId, projectId);
    if (!current) return false;
    this.database.prepare(
      "UPDATE projects SET name = ?, instructions = ?, local_only = ?, updated_at = ? WHERE user_id = ? AND id = ?",
    ).run(patch.name ?? current.name, patch.instructions ?? current.instructions, (patch.localOnly ?? current.localOnly) ? 1 : 0, now, userId, projectId);
    return true;
  }

  deleteProject(userId: string, projectId: string) {
    this.database.prepare("UPDATE conversations SET project_id = NULL WHERE user_id = ? AND project_id = ?").run(userId, projectId);
    return this.database.prepare("DELETE FROM projects WHERE user_id = ? AND id = ?").run(userId, projectId).changes > 0;
  }

  createAttachment(record: AttachmentRecord) {
    this.database.prepare(`
      INSERT INTO attachments (id, user_id, project_id, conversation_id, kind, file_name, mime_type, size, storage_name, extracted_text, page_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.userId, record.projectId, record.conversationId, record.kind, record.fileName,
      record.mimeType, record.size, record.storageName, record.extractedText, record.pageCount, record.createdAt,
    );
  }

  findAttachment(userId: string, attachmentId: string): AttachmentRecord | null {
    const row = this.database.prepare("SELECT * FROM attachments WHERE user_id = ? AND id = ?").get(userId, attachmentId) as Record<string, unknown> | undefined;
    return row ? this.mapAttachment(row) : null;
  }

  listAttachments(userId: string, projectId?: string | null) {
    const rows = (projectId
      ? this.database.prepare("SELECT * FROM attachments WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC").all(userId, projectId)
      : this.database.prepare("SELECT * FROM attachments WHERE user_id = ? ORDER BY created_at DESC LIMIT 200").all(userId)
    ) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapAttachment(row));
  }

  deleteAttachment(userId: string, attachmentId: string) {
    const current = this.findAttachment(userId, attachmentId);
    if (!current) return null;
    this.database.prepare("DELETE FROM attachments WHERE user_id = ? AND id = ?").run(userId, attachmentId);
    return current;
  }

  createMemory(userId: string, memory: MemoryRecord) {
    this.database.prepare(
      "INSERT INTO memories (id, user_id, scope, project_id, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(memory.id, userId, memory.scope, memory.projectId, memory.content, memory.status, memory.createdAt, memory.updatedAt);
  }

  listMemories(userId: string, scope?: "personal" | "project", projectId?: string | null, status?: "pending" | "approved") {
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
    const rows = this.database.prepare(`
      SELECT id, scope, project_id, content, status, created_at, updated_at FROM memories
      WHERE ${clauses.join(" AND ")}
      ORDER BY updated_at DESC
    `).all(...params) as Array<{ id: string; scope: "personal" | "project"; project_id: string | null; content: string; status: "pending" | "approved"; created_at: number; updated_at: number }>;
    return rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      projectId: row.project_id,
      content: row.content,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  updateMemory(userId: string, memoryId: string, patch: { content?: string; status?: "pending" | "approved" }, now: number) {
    const row = this.database.prepare("SELECT content, status FROM memories WHERE user_id = ? AND id = ?").get(userId, memoryId) as { content: string; status: "pending" | "approved" } | undefined;
    if (!row) return false;
    this.database.prepare("UPDATE memories SET content = ?, status = ?, updated_at = ? WHERE user_id = ? AND id = ?")
      .run(patch.content ?? row.content, patch.status ?? row.status, now, userId, memoryId);
    return true;
  }

  deleteMemory(userId: string, memoryId: string) {
    return this.database.prepare("DELETE FROM memories WHERE user_id = ? AND id = ?").run(userId, memoryId).changes > 0;
  }

  createKnowledgeDocument(userId: string, document: KnowledgeDocumentRecord) {
    this.database.prepare(
      "INSERT INTO knowledge_documents (id, user_id, project_id, attachment_id, title, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(document.id, userId, document.projectId, document.attachmentId, document.title, document.createdAt);
  }

  createKnowledgeChunk(userId: string, chunk: KnowledgeChunkRecord) {
    this.database.prepare(
      "INSERT INTO knowledge_chunks (id, user_id, document_id, project_id, ordinal, content, embedding, page) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(chunk.id, userId, chunk.documentId, chunk.projectId, chunk.ordinal, chunk.content, chunk.embedding, chunk.page);
  }

  listKnowledgeChunks(userId: string, projectId: string | null) {
    const rows = this.database.prepare(
      "SELECT id, document_id, project_id, ordinal, content, embedding, page FROM knowledge_chunks WHERE user_id = ? AND ((? IS NULL AND project_id IS NULL) OR project_id = ?) ORDER BY ordinal",
    ).all(userId, projectId, projectId) as Array<{
      id: string; document_id: string; project_id: string | null; ordinal: number; content: string; embedding: string | null; page: number | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      projectId: row.project_id,
      ordinal: row.ordinal,
      content: row.content,
      embedding: row.embedding,
      page: row.page,
    }));
  }

  exportUser(userId: string) {
    return {
      user: this.findUserById(userId),
      conversations: this.listConversations(userId),
      projects: this.listProjects(userId),
      memories: this.listMemories(userId),
      attachments: this.listAttachments(userId).map((item) => ({ ...item, storageName: undefined })),
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

  close() {
    this.database.close();
  }
}
