# Architecture and stage boundaries

## Current modular monolith

One Node.js process owns the loopback HTTP API, Ollama adapter, runtime routing, account/session checks, and SQLite database. Modules are separated by responsibility; no service-to-service network calls or external runtime dependencies are introduced.

```text
src/
  config.ts                 # private environment loading and local-only validation
  http/server.ts            # versioned API, request validation, streaming, request logs
  security/auth.ts          # bootstrap registration, password verification, bearer sessions
  storage/database.ts       # SQLite schema and migration version
  providers/
    provider.ts             # provider and model contracts
    registry.ts             # explicit server-side provider registration
    ollama.ts               # local Ollama catalogue, health, streaming transport
  runtime/chat-runtime.ts   # capability validation and provider selection
  chat/chat-service.ts      # user-scoped conversation and message operations
  agents/                   # reserved; no agent execution
  tools/                    # reserved; no tool execution
  memory/                   # reserved; no separate memory feature
  knowledge/                # reserved; no indexing or RAG
  multimodal/               # reserved; text chat only
  training/                 # reserved; no data collection or training
```

The future application boundary is the versioned API. Future TypeScript SDKs should depend on public API contracts, not server internals or another application's source tree. ASH IDE and the existing ASH AI mobile prototype are deliberately not runtime dependencies of this project.

`apps/ash-chat/` is a static, dependency-free browser client. A local-only Node development server serves its files and proxies `/api/v1` to the existing platform backend; it validates the browser origin and forwards only the authenticated API request. This keeps the browser same-origin with the API without adding CORS or changing the backend contract. The client stores only the short-lived bearer token in tab-scoped session storage; the bootstrap key is not persisted. No third-party font or script is loaded.

## Data model

SQLite schema version 1 includes:

- `users`: normalized unique email and salted scrypt password hash.
- `sessions`: SHA-256 hashes of bearer tokens, associated with a user and expiry.
- `conversations`: owner ID, title, and timestamps.
- `messages`: owner ID, conversation ID, role, content, and timestamp, with a composite foreign key to the owned conversation.

Foreign keys cascade on user/conversation deletion. Database files and WAL files stay under ignored `.data/` by default. A future release needs explicit encrypted-backup, export, retention, deletion, and migration policy.

## Security foundations and gaps

- Listener and configured Ollama target are restricted to loopback.
- Browser `Origin` and request `Host` are checked; no CORS headers are enabled.
- Account registration requires a server-side bootstrap key; authentication attempts are rate-limited per local peer address.
- Passwords use scrypt, access tokens are random and stored hashed, and authorization is checked before user-scoped database operations.
- JSON request bodies are size bounded; API paths and request bodies are not logged.

These controls are a starting point only. In-memory rate limiting is process-local; there is no MFA, CSRF/token lifecycle interface, abuse monitoring, key rotation UI, encryption at rest, or external security review. Account export and deletion exist. A loopback service is intended for its local user, not as a multi-tenant deployment. Do not expose it to other devices or the internet.

## Current modules

1. **Provider runtime:** Ollama, Gemini, Groq, and OpenRouter behind a shared contract. Cloud adapters register only when a platform `.env.local` key is present. AUTO never selects paid models.
2. **ASH Chat:** versioned API client with streaming, regenerate/edit, attachments, projects, memory, export, and deletion.
3. **Memory:** pending/approved personal and project memories; conversation history is separate.
4. **Knowledge/RAG:** upload ingestion, chunking, local embeddings or lexical fallback, project-scoped retrieval with page references.
5. **Multimodal:** JPEG/PNG/WebP and PDF uploads, PDF text extraction, optional OCR.
6. **Tools:** read-only knowledge and memory retrieval during chat. No shell or browser tools.
7. **Training:** still disabled.
8. **Other clients:** not integrated in this iteration.

Each stage should add migration and cross-user isolation tests before expanding the security claims.
