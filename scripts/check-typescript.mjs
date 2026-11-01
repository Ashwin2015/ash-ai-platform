import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

for (const file of sourceFiles(path.resolve("src"))) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--check", file], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.info("TypeScript source syntax is valid. Native type stripping does not type-check.");
