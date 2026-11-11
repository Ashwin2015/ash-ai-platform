import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const FORBIDDEN = /(^|\/)\.env($|\.)|(^|\/)[^/]+\.sqlite($|-wal|-shm)?$|credentials\.json$|(^|\/)node_modules(\/|$)|(^|\/)\.git(\/|$)/i;

export function coreSource(repoRoot) {
  return path.join(repoRoot, "packages", "ash-ai-core");
}

function relative(root, file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function walk(directory, visit) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (entry.isFile()) visit(full);
  }
}

export function forbiddenFiles(root) {
  const bad = [];
  if (!existsSync(root)) return ["missing"];
  walk(root, (file) => {
    const rel = relative(root, file);
    if (FORBIDDEN.test(rel)) bad.push(rel);
    if (statSync(file).size > 200_000) return;
    if (!/\.(md|json|txt|env|ts|mjs|js|example)$/i.test(file) && !file.endsWith(".env")) return;
    const text = readFileSync(file, "utf8");
    if (/postgres(?:ql)?:\/\/[^/\s:]+:[^/\s@]+@/i.test(text) || /sk-[A-Za-z0-9]{16,}/.test(text)) {
      bad.push(`${rel} (secret-like text)`);
    }
  });
  return bad;
}

export function exportCore(repoRoot, destination) {
  const source = coreSource(repoRoot);
  if (!existsSync(path.join(source, "package.json"))) throw new Error("Canonical ASH AI Core package was not found.");
  if (existsSync(destination)) throw new Error("Refusing to overwrite an existing destination.");
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    filter: (item) => {
      const rel = relative(source, item);
      return !rel || !FORBIDDEN.test(rel);
    },
  });
  const bad = forbiddenFiles(destination);
  if (bad.length) throw new Error(`Portable copy is not clean: ${bad.join(", ")}`);
  return destination;
}

export function verifyCore(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
  const required = ["src/index.ts", "src/files.ts", "CHANGELOG.md", "config.example.env"];
  const missing = required.filter((item) => !existsSync(path.join(directory, item)));
  const bad = forbiddenFiles(directory);
  return {
    ok: manifest.name === "@ash/ai-core" && Boolean(manifest.version) && missing.length === 0 && bad.length === 0,
    name: manifest.name,
    version: manifest.version,
    missing,
    forbidden: bad,
  };
}

export function workspacePaths(root) {
  return {
    root,
    registry: path.join(root, "registry.json"),
    products: path.join(root, "PRODUCTS"),
    backups: path.join(root, "BACKUPS"),
    templates: path.join(root, "TEMPLATES"),
  };
}

export function readRegistry(root) {
  const file = workspacePaths(root).registry;
  if (!existsSync(file)) return { version: 1, projects: [] };
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeRegistry(root, registry) {
  mkdirSync(root, { recursive: true });
  writeFileSync(workspacePaths(root).registry, `${JSON.stringify(registry, null, 2)}\n`);
}

export function copyStarter(repoRoot, destination) {
  const source = path.join(repoRoot, "templates", "ash-ai-product-starter");
  if (existsSync(destination)) throw new Error("Project folder already exists.");
  cpSync(source, destination, { recursive: true });
}
