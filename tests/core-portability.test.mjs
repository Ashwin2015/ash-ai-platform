import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { exportCore, verifyCore } from "../scripts/portable-core.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("exported ASH AI Core is clean, versioned, and usable from a copy", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ash-core-"));
  try {
    const copied = exportCore(repo, path.join(root, "ash-ai-core"));
    const verified = verifyCore(copied);
    assert.equal(verified.ok, true);
    assert.equal(verified.version, "1.0.0");
    const core = await import(pathToFileURL(path.join(copied, "src", "index.ts")).href);
    assert.equal(core.ASH_AI_CORE_VERSION, "1.0.0");
    assert.ok(core.extractCalculations("3 × 4").some((item) => item.result === 12));
    const manifest = readFileSync(path.join(copied, "package.json"), "utf8");
    assert.doesNotMatch(manifest, /GEMINI_API_KEY=\S{8,}/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace scripts create an independent starter and pin a core copy", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ash-workspace-"));
  try {
    run(["scripts/ash-workspace.mjs", "init", root]);
    run(["scripts/ash-workspace.mjs", "new", root, "sample-product", "3041"]);
    run(["scripts/ash-workspace.mjs", "link-core", root, "sample-product"]);
    run(["scripts/ash-workspace.mjs", "check", root, "sample-product"]);
    const product = path.join(root, "PRODUCTS", "sample-product");
    writeFileSync(path.join(product, ".env.local"), "GEMINI_API_KEY=not-a-real-key\n");
    run(["scripts/ash-workspace.mjs", "backup", root, "sample-product"]);
    const backupDir = path.join(root, "BACKUPS");
    const { readdirSync, existsSync } = await import("node:fs");
    const backup = readdirSync(backupDir)[0];
    assert.equal(existsSync(path.join(backupDir, backup, ".env.local")), false);
    const linked = await import(pathToFileURL(path.join(product, "vendor", "ash-ai-core", "src", "index.ts")).href);
    assert.equal(linked.ASH_AI_CORE_VERSION, "1.0.0");
    const release = path.join(root, "ASH-CORE", "ash-ai-core-1.0.0", "package.json");
    assert.equal(existsSync(release), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
