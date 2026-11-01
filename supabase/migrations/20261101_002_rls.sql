-- Row Level Security: deny PostgREST anon/authenticated access.
-- Render uses DATABASE_URL as a privileged Postgres role that bypasses RLS.
-- Do not put the Supabase anon key in the browser or in ASH Chat.

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ash_schema_migrations_deny ON schema_migrations;
CREATE POLICY ash_schema_migrations_deny ON schema_migrations FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS ash_users_deny ON users;
CREATE POLICY ash_users_deny ON users FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS ash_sessions_deny ON sessions;
CREATE POLICY ash_sessions_deny ON sessions FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS ash_conversations_deny ON conversations;
CREATE POLICY ash_conversations_deny ON conversations FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS ash_messages_deny ON messages;
CREATE POLICY ash_messages_deny ON messages FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS ash_projects_deny ON projects;
CREATE POLICY ash_projects_deny ON projects FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS ash_attachments_deny ON attachments;
CREATE POLICY ash_attachments_deny ON attachments FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS ash_memories_deny ON memories;
CREATE POLICY ash_memories_deny ON memories FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS ash_knowledge_documents_deny ON knowledge_documents;
CREATE POLICY ash_knowledge_documents_deny ON knowledge_documents FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS ash_knowledge_chunks_deny ON knowledge_chunks;
CREATE POLICY ash_knowledge_chunks_deny ON knowledge_chunks FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE schema_migrations, users, sessions, conversations, messages, projects, attachments, memories, knowledge_documents, knowledge_chunks FROM anon, authenticated;

INSERT INTO schema_migrations (version)
VALUES ('20261101_002_rls')
ON CONFLICT (version) DO NOTHING;
