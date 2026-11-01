-- ASH AI Production (Supabase Postgres). Additive and idempotent.
-- Equivalent to local SQLite schema version 3, plus composite ownership foreign keys.
-- Do not copy the SQLite file into Postgres.
-- Projects are created before conversations so (user_id, project_id) FKs can be declared.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_salt BYTEA NOT NULL,
  password_hash BYTEA NOT NULL,
  created_at BIGINT NOT NULL,
  -- Invite-gated private test: no verification email is sent. This flag is not an SMTP proof.
  email_verified INTEGER NOT NULL DEFAULT 1,
  reset_token_hash TEXT,
  reset_expires BIGINT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  local_only INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  project_id TEXT,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, project_id)
    REFERENCES projects(user_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS conversations_updated_idx ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  metadata TEXT,
  PRIMARY KEY (user_id, conversation_id, id),
  FOREIGN KEY (user_id, conversation_id)
    REFERENCES conversations(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(user_id, conversation_id, created_at);

CREATE TABLE IF NOT EXISTS attachments (
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
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, project_id)
    REFERENCES projects(user_id, id) ON DELETE SET NULL,
  FOREIGN KEY (user_id, conversation_id)
    REFERENCES conversations(user_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS attachments_user_idx ON attachments(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('personal', 'project')),
  project_id TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, id),
  CHECK (
    (scope = 'personal' AND project_id IS NULL) OR
    (scope = 'project' AND project_id IS NOT NULL)
  ),
  FOREIGN KEY (user_id, project_id)
    REFERENCES projects(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS memories_user_idx ON memories(user_id, scope, status);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  attachment_id TEXT,
  title TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, project_id)
    REFERENCES projects(user_id, id) ON DELETE SET NULL,
  FOREIGN KEY (user_id, attachment_id)
    REFERENCES attachments(user_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  project_id TEXT,
  ordinal INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT,
  page INTEGER,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, document_id)
    REFERENCES knowledge_documents(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, project_id)
    REFERENCES projects(user_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_doc_idx ON knowledge_chunks(user_id, document_id, ordinal);

INSERT INTO schema_migrations (version)
VALUES ('20261101_001_init')
ON CONFLICT (version) DO NOTHING;
