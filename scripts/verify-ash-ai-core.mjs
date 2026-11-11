import path from "node:path";
import { verifyCore } from "./portable-core.mjs";

const directory = process.argv[2];
if (!directory) {
  console.error("Usage: node scripts/verify-ash-ai-core.mjs <core-folder>");
  process.exit(1);
}
const result = verifyCore(path.resolve(directory));
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
