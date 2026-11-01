import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.ts";

const config = loadConfig();
if (!existsSync(config.databasePath)) {
  console.error("No database file exists yet.");
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = path.join(config.rootDirectory, ".data", "backups");
mkdirSync(directory, { recursive: true });
const target = path.join(directory, `ash-platform-${stamp}.sqlite`);
copyFileSync(config.databasePath, target);
console.log(`Backup written to ${target}`);
