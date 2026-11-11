# Architecture and stage boundaries

## Current modular monolith

One Node.js process owns the loopback HTTP API, Ollama adapter, runtime routing, account/session checks, and SQLite database. Modules are separated by responsibility; no service-to-service network calls or external runtime dependencies are introduced.

```text
src/
  config.ts                 # private environment loading and local-only validation
  http/server.ts            # versioned API, request validation, streaming, request logs
  security/auth.ts          # email/password registration, scrypt, bearer and cookie sessions
  storage/database.ts       # SQLite schema and migration version
  providers/
    provider.ts             # provider and model contracts
    registry.ts             # explicit server-side provider registration
    ollama.ts               # local Ollama catalogue, health, streaming transport
  runtime/chat-runtime.ts   # capability validation and provider selection
  chat/chat-service.ts      # user-scoped conversation and message operations
  agents/                   # reserved; no agent execution
  tools/calculator.ts       # deterministic arithmetic injected before the model
  memory/                   # personal and project memories; only approved text is sent to the model
  knowledge/                # chunking and retrieval for extracted upload text
  multimodal/documents.ts   # JPEG, PNG, WebP, and PDF extraction
  research/                 # Wikipedia and DuckDuckGo instant answers
  training/                 # reserved; no data collection or training
```

The future application boundary is the versioned API. Future TypeScript SDKs should depend on public API contracts, not server internals or another application's source tree. ASH IDE and the old ASH AI mobile prototype are not runtime dependencies of this project.

`apps/ash-chat/` is a static, dependency-free browser client. The platform process serves it when `ASH_PLATFORM_SERVE_CHAT` is on. An optional `dev:chat` server can still proxy `/api/v1`. The browser keeps the bearer token and CSRF token in `localStorage`. Cookie requests are checked for CSRF. No third-party font or script is loaded. The service worker caches the app shell only. It does not cache `/api/` responses, tokens, or conversations.

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
- Account registration is email and password. When `ASH_PLATFORM_INVITE_CODE` is non-empty, registration rejects a missing or wrong code before creating a user. Login does not ask for the code. The first insert atomically becomes owner via a unique partial index. Owner is not an admin role and cannot read another account.
- Authentication attempts are rate-limited in memory, per process and peer address. Chat requests are not rate-limited.
- Passwords use scrypt. Access tokens are random and stored as SHA-256 hashes. User-scoped queries include `user_id`.
- JSON request bodies are size bounded. Request logs record method, path, status, and duration. They do not record bodies or tokens.

These controls are a starting point only. There is no MFA, no team workspace, no shared project role, no abuse monitoring, no key-rotation UI, and no external security review. Account export and deletion exist. Hosted mode is one Node process on Render with Postgres and private Supabase storage. It is suitable for a small invited preview, not for a public multi-tenant launch.

## Current modules

1. **Provider runtime:** Ollama, Gemini, Groq, and OpenRouter behind a shared contract. Cloud adapters register only when a platform `.env.local` key is present. AUTO never selects paid models.
2. **ASH Chat:** versioned API client with streaming, regenerate/edit, attachments, projects, memory, export, and deletion.
3. **Memory:** pending/approved personal and project memories; conversation history is separate.
4. **Knowledge/RAG:** upload ingestion, chunking, local embeddings or lexical fallback, project-scoped retrieval with page references.
5. **Multimodal:** JPEG/PNG/WebP and PDF uploads, PDF text extraction, optional OCR.
6. **Tools:** knowledge retrieval, approved memory, calculator, and the research lookup run on the server before the model answers. The model is not given a tool-calling loop, shell, or browser.
7. **Training:** still disabled.
8. **Other clients:** not integrated. Android access is the installable PWA, not an APK.

Each stage should add migration and cross-user isolation tests before expanding the security claims.
