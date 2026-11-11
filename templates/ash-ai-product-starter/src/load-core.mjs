import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function coreEntry(from = import.meta.url) {
  const here = path.dirname(fileURLToPath(from));
  const candidates = [
    path.resolve(here, "../vendor/ash-ai-core/src/index.ts"),
    path.resolve(here, "../../../packages/ash-ai-core/src/index.ts"),
  ];
  const found = candidates.find((item) => existsSync(item));
  if (!found) {
    throw new Error("ASH AI Core was not found. Link a pinned copy with scripts/ash-workspace.mjs link-core, or keep this starter inside ASH-AI-PLATFORM.");
  }
  return found;
}

export async function loadCore(from = import.meta.url) {
  return import(pathToFileURL(coreEntry(from)).href);
}
