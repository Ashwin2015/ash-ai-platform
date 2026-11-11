# ASH foundation final verification

Date: 2026-11-10. Repository: `ASH-AI-PLATFORM`, branch `main`.

Decision: **B. Ready for controlled team preview, but not a full foundation freeze.**

No Git tag was created. Nothing was deployed. Production data was not opened or restored.

## 1. What was verified

The uncommitted foundation on top of commit `1d6ee68` (`fix: harden Android chat and invite-only registration`, 2026-11-08). `main` matches the cached `origin/main`. The core, starter, workspace scripts, and documentation are local changes, not a release tag.

A source snapshot was taken before this verification pass:

`.data/source-backups/pre-final-verification-20261110` — 150 files, ASH AI Core present, `.env.local` absent.

Older snapshots still present: `pre-foundation-docs-20261108` and `pre-core-extract-20261108` (102 files each).

## 2. Tests executed

| Run | Result |
|---|---|
| `npm test` | 49 passed, 0 failed, about 24 seconds |
| `node --experimental-strip-types --test tests/core-portability.test.mjs` after the backup-filter fix | 2 passed, 0 failed |
| Disposable app under `.data/verify-disposable` importing only the exported core | 6 of 7 checks passed. The failed check was a bad expectation, explained below |
| Ollama `http://127.0.0.1:11434` health from that app | Unavailable after 3.2 seconds. No live completion |
| SQLite snapshot opened in an isolated copy | `PRAGMA integrity_check` = `ok` |
| Workspace `init`, two `new` projects, two `link-core`, two `git init` | All exit 0 |
| Workspace backup after the filter fix | `.env.local` absent, `.env.example` and pinned core present |

Cloud keys in local config are empty. Gemini, Groq, and OpenRouter were not called. No live answer text was produced.

## 3. Actual results

### Core, independent of ASH Chat

Export of `@ash/ai-core` 1.0.0 passed `verify-ash-ai-core`: required files present, no env file, no database file, no connection string.

A separate app imported `vendor/ash-ai-core/src/index.ts` and `vendor/ash-ai-core/src/files.ts`. It did not import `src/http`, `apps/ash-chat`, or the re-export stubs.

| Check | Result |
|---|---|
| Free-first selection | Selected `local-free`. The paid provider was not used. |
| Manual selection | Selected `local-free-m`. |
| Fallback | First free provider threw before any text. Second free provider returned `ok-second`. |
| Memory | User A and user B each saw only their own memory row. |
| Documents | `processUpload` and `chunkText` loaded from the files entry. A fake PNG was rejected with `invalid_request`. |
| Context clip | The probe sent only two turns. `compactHistory` keeps the latest eight turns up to 6,000 characters, so a 4,000-character recent turn stayed intact. Older turns clip to 1,200 characters. That is the implemented rule, not a broken clip. |

### AI behaviour

No configured cloud provider was available. Ollama was configured as loopback and did not answer. There is no measured response time, model id, or answer quality for a real question in this pass.

Automated coverage that does exist uses mocks: routing, paid-model exclusion, fallback before the first token, research with no invented URL, calculator, and the 20-prompt orchestration benchmark. Those do not show that a live model followed the prompt.

This pass does not compare ASH Chat with any commercial assistant.

### Workspace

Disposable root `.data/verify-disposable/workspace`:

- `product-a` port 3041, core `1.0.0`, its own `git init`
- `product-b` port 3042, core `1.0.0`, its own `git init`
- Env files differed. Neither project was an existing ASH product. Nothing was moved.

The first backup attempt copied nothing. The filter treated the absolute path as the project path, and this disposable root sits inside `.data`, so every file was skipped. The filter now uses the path relative to the project. A second backup then contained the starter and `vendor/ash-ai-core` and did not contain `.env.local`.

The two projects were not started as servers. Port separation is recorded in `registry.json` only.

## 4. AI response quality

Not scored. Local Gemini, Groq, and OpenRouter keys are empty. Ollama did not respond. No provider name, model id, or answer can be reported for a live question.

## 5. Security findings

| Severity | Finding |
|---|---|
| Critical | None observed in this pass. |
| High | Hosted Postgres and Supabase files were not backed up or restored here. The local SQLite snapshot is not a copy of production. |
| Medium | Workspace backup previously skipped every file when the project path contained `.data`. Fixed in `scripts/ash-workspace.mjs` and rechecked. |
| Low | Auth and chat limits are in memory and reset on process restart. Chat is 40 posts per user per minute. Auth is 30 attempts per client address per minute. |
| Low | The browser keeps the session token in `localStorage`. Cookie mutations require a matching CSRF header. Bearer requests are not CSRF-checked. |
| Low | There is no MFA, no team role, and no email password reset. The forgot-password route does not change a password. |

Invite enforcement, scrypt passwords, hashed session tokens, user-scoped queries, and user-scoped file paths are unchanged. `npm test` again showed a second user receiving 404 for another user's conversation, project, memory, and attachment. Request logs in that run recorded method, path, status, and duration only.

The owner flag still does not grant access to another account. Team workspaces are not implemented.

## 6. Backup and restoration

| Backup | Isolated check | Result |
|---|---|---|
| `pre-final-verification-20261110` | Manifest read from the snapshot | Core 1.0.0 present. `.env.local` absent. Working tree was not overwritten. |
| `pre-core-extract-20261108` | `src/errors.ts` read from the snapshot | Full source module (`export type PlatformErrorCode`), not a re-export stub. |
| `ash-platform-2026-11-08T19-43-33-942Z` | Copied to a temp folder and opened | `integrity_check` ok. Tables include users, sessions, conversations, messages, projects, attachments, memories. Counts are 0. This snapshot does not restore accounts or chats. |
| Workspace `product-a` backup | File listing | Secret file excluded. Starter and pinned core included. The backup was not booted. |
| Hosted Supabase | Not performed | No production restore. |

`npm run backup` still copies only the local SQLite family. It refuses to run when `DATABASE_URL` is set, so it cannot be mistaken for a hosted backup.

## 7. Workspace portability

Export, verify, new product, link, and version pin work. Two disposable projects kept separate ports, env files, Git repositories, and core copies at 1.0.0. Editing the canonical core would not change those copies until `link-core` is run again.

`git init` was used only inside the disposable products.

## 8. Android limitations

No physical device was used. Do not mark any phone check as passed.

Use this list on one Android phone against the hosted HTTPS site, with an invited account:

1. Install from Chrome: Add to Home screen. Confirm the name ASH Chat and that the icon opens standalone.
2. Register only with the invite code. Confirm a wrong code is rejected. Sign in an existing account without the code.
3. Send a chat. Rotate the phone and open the keyboard. Confirm the composer stays visible.
4. Attach a camera photo, a gallery image, and a PDF. Confirm the send stays blocked until upload finishes.
5. Use voice input. Confirm denial, silence, and a successful transcript are different messages. Edit the text before send.
6. Use Speak on an assistant reply if the button is shown. Confirm it is device speech, not an offline model.
7. Turn on airplane mode. Confirm the offline page does not pretend the model answered. Restore the network and send the saved draft once.
8. Sign in as a second invited account. Confirm the first account's chats, projects, and files are absent.

## 9. Team preview readiness

Suitable for a few invited accounts on the existing hosted service, with these limits stated to them:

- Separate accounts. No shared workspace.
- New registration needs the invite code already configured on the host. The code was not printed in this verification.
- Cloud answers depend on the host's provider quotas. This PC had no local cloud keys, and local Ollama was down.
- Research is Wikipedia and instant answers.
- The phone install is a PWA, not an APK, and it has not been device-tested.
- Sessions last about 12 hours. There is no password email.

Isolation between accounts is covered by the automated API tests, not by a new production account created in this pass.

## 10. Remaining blockers for a freeze

1. Live model quality is unscored.
2. The local database snapshot restores as an empty schema.
3. Hosted backup and restore have not been done.
4. Android has not been tested on a device.
5. The foundation commit is not created and not tagged. That waits for approval.

These are release gates, not a reason to keep adding features.

## Files touched in this verification

- `scripts/ash-workspace.mjs` — backup filter uses the project-relative path and skips secret env files.
- `docs/ASH-WORKSPACE-GUIDE.md` — backup exclusion noted.
- `docs/ASH-FOUNDATION-FINAL-VERIFICATION.md` — this report.

No authentication code, database schema, credential, or deployment was changed.
