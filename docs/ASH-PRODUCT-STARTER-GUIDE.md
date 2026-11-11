# Product starter

Path: `templates/ash-ai-product-starter`.

It is a Node 24 module with an example, one test, an env template, and a security checklist. It has no React, SQLite, or HTTP server.

`src/load-core.mjs` loads `vendor/ash-ai-core` if present, otherwise the canonical package while the starter still sits in this repository.

```powershell
node templates/ash-ai-product-starter/src/example.mjs
node --test templates/ash-ai-product-starter/test/starter.test.mjs
```

Add a UI or database in the product, not in the core. Use `MemoryStore` if the product needs memory. Use `src/files.ts` only when PDF or OCR is required, and install `pdfjs-dist` and `tesseract.js` in that product.
