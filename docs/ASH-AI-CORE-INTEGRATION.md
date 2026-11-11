# ASH AI Core integration

Node 24 with type stripping. No build step.

## Option A — pinned folder inside the product

```powershell
node scripts/export-ash-ai-core.mjs D:\products\my-app\vendor\ash-ai-core
node scripts/verify-ash-ai-core.mjs D:\products\my-app\vendor\ash-ai-core
```

Import `vendor/ash-ai-core/src/index.ts`. This copy does not change when the canonical core changes.

Advantages: the product repository contains the exact source it runs. Limitations: you update by copying a new version on purpose. `pdfjs-dist` and `tesseract.js` are optional and needed only for `src/files.ts`.

## Option B — workspace link

```powershell
node scripts/ash-workspace.mjs init D:\ASH-WORKSPACE
node scripts/ash-workspace.mjs new D:\ASH-WORKSPACE my-product 3041
node scripts/ash-workspace.mjs link-core D:\ASH-WORKSPACE my-product
```

`link-core` copies the same snapshot into `PRODUCTS/my-product/vendor/ash-ai-core`. The starter's `src/load-core.mjs` loads that folder.

Advantages: one command pins the version and the starter already loads it. Limitations: this is still a copy, not a live link. Do not point two products at one shared `node_modules` or one production database.

## What is not copied

`.env`, `.env.local`, databases, uploads, `node_modules`, and `.git`. `config.example.env` has names only.

## Minimal use

```javascript
import { ChatRuntime, ProviderRegistry, OllamaProvider } from "./vendor/ash-ai-core/src/index.ts";

const providers = new ProviderRegistry();
providers.register(new OllamaProvider("http://127.0.0.1:11434"));
const runtime = new ChatRuntime(providers);
```

Pass cloud keys into `GeminiProvider` or `OpenAICompatibleProvider` only when the product has them. Do not hardcode one provider as the permanent default. AUTO refuses paid models.
