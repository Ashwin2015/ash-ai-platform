import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportCore } from "./portable-core.mjs";

const destination = process.argv[2];
if (!destination) {
  console.error("Usage: node scripts/export-ash-ai-core.mjs <destination-folder>");
  process.exit(1);
}
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const written = exportCore(repoRoot, path.resolve(destination));
console.log(`ASH AI Core exported to ${written}`);
