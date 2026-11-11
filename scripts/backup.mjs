import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.ts";

const config = loadConfig();
if (config.databaseUrl) {
  console.error("This script copies the local SQLite file only. It does not back up hosted Postgres.");
  process.exit(1);
}
if (!existsSync(config.databasePath)) {
  console.error("No database file exists yet.");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = path.join(config.rootDirectory, ".data", "backups", `ash-platform-${stamp}`);
mkdirSync(directory, { recursive: true });

const companions = [config.databasePath, `${config.databasePath}-wal`, `${config.databasePath}-shm`];
const copied = [];
for (const source of companions) {
  if (!existsSync(source)) continue;
  const target = path.join(directory, path.basename(source));
  copyFileSync(source, target);
  copied.push(target);
}

console.log("Local SQLite snapshot written. This has not been restore-tested and is not a hosted backup.");
for (const file of copied) console.log(file);
