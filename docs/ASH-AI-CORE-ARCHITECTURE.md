# ASH AI Core architecture

Version 1.0.0. Canonical source: `packages/ash-ai-core`.

ASH Chat keeps its HTTP server, accounts, SQLite, Postgres, Supabase, and PWA. Those stay in `src/` and `apps/ash-chat`. The old `src/` import paths re-export the core so existing tests did not have to change their paths.

## Inside the core

| Module | Responsibility |
|---|---|
| `providers/` | Ollama, Gemini, Groq, and OpenRouter adapters. Catalogue and capability fields. |
| `runtime/chat-runtime.ts` | AUTO free-first, local, free-cloud, and manual selection. Fallback before the first token. |
| `chat/` | System prompt, context clipping, working modes. |
| `research/` | Wikipedia and DuckDuckGo instant answers. |
| `tools/` | Calculator and a small builtin tool list. No shell. |
| `memory/` | Memory rules plus a `MemoryStore` interface. No database driver. |
| `embeddings/local.ts` | Lexical vectors and optional Ollama embeddings. |
| `multimodal/documents.ts` | PDF text, OCR, and image checks. Loaded only from `src/files.ts`. |
| `reliability/rate-limit.ts` | Process-local limiter and a usage-sink interface. |

## Left in the application

Authentication, invite codes, sessions, projects, conversation storage, file bytes, and the chat UI. Knowledge retrieval stays in the app because it reads the application database. It uses core chunking and embeddings.

## What another product turns on

A product imports `@ash/ai-core` and constructs only the providers it needs. Crop diagnosis can use documents and vision routing without chat history. An IDE can use coding-task scoring without research. Nothing in the core imports `apps/ash-chat`.
