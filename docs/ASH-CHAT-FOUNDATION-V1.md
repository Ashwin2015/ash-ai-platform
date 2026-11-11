# ASH Chat foundation

Status: **not frozen.** Controlled team preview is possible for invited accounts. Foundation v1 is not complete until a physical Android pass and a restore drill are recorded.

## What the application is

One Node 24 process serves the API and the PWA. Local data is SQLite. Hosted data is Postgres plus private Supabase storage. The browser is `apps/ash-chat`.

## Feature matrix

| Feature | State |
|---|---|
| Accounts, sessions, invite-gated registration | Working. Login does not ask for the invite code. |
| Chat, history, projects, approved memory | Working and covered by tests. |
| Free-first routing and fallback | Working in automated tests. Paid models are not auto-selected. |
| Research | Wikipedia and instant answers only. |
| Calculator | Deterministic, injected before the model. |
| PDF, OCR, images | Code and upload tests exist. No live vision or scanned-PDF pass was run for this milestone. |
| Voice | Input uses the browser's online recognizer. Speak uses `speechSynthesis` when the browser has it. Neither works offline. |
| PWA shell | Cached static files only. Private API data is not cached. |
| Team workspaces | Not implemented. |
| Android device pass | Not done. |
| Hosted restore drill | Not done. |

## Tests

`npm test` includes the application suite, core portability, the 20-prompt orchestration benchmark, and the starter. The benchmark does not call a live model. `npm run test:live` is separate and is the only live-model check.

## Known limits

Context is the last 30 messages, with older turns clipped. There is no conversation summariser. The model does not call tools itself. Chat is limited to 40 posts per user per minute in each process. That counter resets on restart.
