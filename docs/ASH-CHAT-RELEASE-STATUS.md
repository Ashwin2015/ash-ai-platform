# ASH Chat release status

Date: 2026-11-10. Decision: **not a foundation freeze.** No tag. No deploy. A signed APK exists locally and is not published.

## Already in the repository

ASH Chat web app, PWA, invite registration, projects, memory, uploads, research, calculator, and ASH AI Core 1.0.0 with the export, starter, and workspace scripts. `npm test` last passed 49/49 on this tree before this note. Those tests do not prove a phone install or a hosted download.

## Android

A signed release APK was built locally: `android/app/build/outputs/apk/release/app-release.apk`, 406,351 bytes, SHA-256 `E979E296C1CCD03053D271FC817177C089333119BA30C783168994B5E076432B`, package `com.ashai.chat` 1.0.0. No device was attached, so it has not been installed. There is no download URL.

`/download.html` states that and does not link to a file. It is in the local app only until a deploy is approved. The keystore stays outside Git. A published file should be a GitHub Release asset, not a Git commit and not a Vercel bundle.

## Live model

Local cloud keys are empty. Ollama was running. The only chat model was `qwen2.5-coder:1.5b` (`free`, `local`). Twenty short prompts were sent through the core provider with the ASH system prompt. Full text is in `.data/live-benchmark.json`.

| Result | Evidence |
|---|---|
| 19 replies, 1 failure | The first call failed in 45s while the model was not ready. Later calls returned text. |
| Follow-up arithmetic | 20 × 5 was answered as 100, then half as 50. |
| Instructions | The three-part budget answer was not three numbered lines. The table repeated the system prompt. |
| Memory | The model replied "noted" to 42, then did not recall 42. |
| Research | Asked to refuse an unsourced claim, it still named a president and a date that was not supplied. With empty research notes it correctly said research was unavailable. |
| Speed | After warmup, most replies were about 1–7 seconds. This is one small local model, not a comparison with any commercial assistant. |

Free-first routing and fallback remain covered by the automated tests. This live run used one local model, so it did not exercise a cloud quota failure.

## Still required before freeze

1. Owner approval to publish the existing signed APK and to deploy `/.well-known/assetlinks.json`.
2. A real download URL after that publish.
3. One physical install. Until asset links are deployed, the wrapper shows the Chrome address bar.
4. A hosted database backup that has been restored somewhere other than production.
5. An approved deploy if `/download.html` should appear on the live site.
