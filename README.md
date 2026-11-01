# ASH AI PLATFORM

Independent, local-first modular-monolith foundation for ASH Chat and future ASH applications.

## One-click start

Double-click `Start-ASH-AI.bat` or run the **Start ASH AI** VS Code task from this folder.

That starts ASH AI on `http://127.0.0.1:3035` (API and chat in one process). Close the startup window to stop it. The old chat-only port 3036 is optional (`npm.cmd run dev:chat`).

## Technology

- Node.js 24.13+ with native TypeScript stripping
- SQLite (`node:sqlite`) for users, sessions, conversations, projects, memories, attachments, and knowledge chunks
- Local Ollama plus optional Gemini, Groq, and OpenRouter adapters
- `pdfjs-dist` and `tesseract.js` for PDF text and OCR

## Configure

Copy `.env.example` to `.env.local` (the start script can do this). Set `ASH_PLATFORM_INVITE_CODE` (private tester access) and keep `ASH_PLATFORM_BOOTSTRAP_KEY`. Optional free-tier cloud keys:

```
GEMINI_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
```

Do not copy keys from other products automatically. Keys stay server-side. The API binds to loopback only.

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:3035`. One process is enough.

## Routing

Default mode is **AUTO — FREE FIRST**. It discovers eligible free/limited-free models, prefers local Ollama, scores by task (chat, coding, reasoning, vision, documents), and may fall back only before the first response token. Paid and unknown-price models are never selected automatically.

Other modes: `LOCAL ONLY`, `FREE CLOUD`, and manual model selection.

## ASH Chat

Registration/login, persistent conversations, search, rename, delete, streaming, stop, regenerate, edit/resend, markdown, copy, attachments (JPEG/PNG/WebP/PDF), projects, personal/project memory, dark/light theme, and a PWA manifest.

## Tests

```powershell
npm.cmd test
npm.cmd run test:live
npm.cmd run check
```

Mock tests are labelled. `test:live` requires a local Ollama model.

## LAN phone testing

Keep the API on loopback. After creating a private PFX for this PC's Wi-Fi IP:

```powershell
$env:ASH_AI_TLS_HOST = "192.168.x.x"
$env:ASH_AI_TLS_PFX = "$env:USERPROFILE\ash-ai-phone-certs\ash-ai-phone.pfx"
npm.cmd run lan-https
```

This is not mobile-data access and must not be port-forwarded.

See [architecture](./docs/architecture.md).
