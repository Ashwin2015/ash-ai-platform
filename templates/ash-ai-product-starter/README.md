# ASH AI product starter

A minimal Node 24 program that loads ASH AI Core. It does not choose a frontend, a database, or a web framework.

## Run inside ASH-AI-PLATFORM

```powershell
node src/example.mjs
node --test test/starter.test.mjs
```

The loader uses `vendor/ash-ai-core` when this folder has been linked, and otherwise the canonical package in this repository.

## Use in another product

1. Create a workspace and a project with `scripts/ash-workspace.mjs`.
2. `link-core` copies one version into `vendor/ash-ai-core`.
3. Later edits to the canonical core do not change this copy.
4. Copy `.env.example` to `.env.local` and fill only the providers this product needs.

File extraction is a separate entry, `@ash/ai-core/files`, and needs `pdfjs-dist` and `tesseract.js` in the product that uses it. Chat routing does not.

See `SECURITY.md`.
