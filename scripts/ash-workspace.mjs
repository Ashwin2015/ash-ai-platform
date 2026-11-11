import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { copyStarter, coreSource, exportCore, readRegistry, verifyCore, workspacePaths, writeRegistry } from "./portable-core.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command, rootArg, ...rest] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function rootOrFail() {
  if (!rootArg) fail("Pass the workspace root as the first argument. This script does not move existing products.");
  return path.resolve(rootArg);
}

if (command === "init") {
  const root = rootOrFail();
  for (const folder of ["ASH-CORE", "PRODUCTS", "TEMPLATES", "BACKUPS"]) {
    mkdirSync(path.join(root, folder), { recursive: true });
  }
  if (!existsSync(workspacePaths(root).registry)) writeRegistry(root, { version: 1, projects: [] });
  const version = JSON.parse(readFileSync(path.join(coreSource(repoRoot), "package.json"), "utf8")).version;
  const release = path.join(root, "ASH-CORE", `ash-ai-core-${version}`);
  if (!existsSync(release)) exportCore(repoRoot, release);
  console.log(`Workspace ready at ${root}. Core ${version} is in ASH-CORE. No existing repository was moved.`);
} else if (command === "list") {
  const registry = readRegistry(rootOrFail());
  for (const project of registry.projects) {
    console.log(`${project.name}\t${project.path}\tport ${project.port}\tcore ${project.core || "unlinked"}`);
  }
  if (!registry.projects.length) console.log("No projects registered.");
} else if (command === "register") {
  const [name, projectPath, port] = rest;
  if (!name || !projectPath || !port) fail("Usage: ash-workspace.mjs register <workspace> <name> <project-path> <port>");
  const root = rootOrFail();
  const registry = readRegistry(root);
  if (registry.projects.some((item) => item.name === name)) fail("That project name is already registered.");
  registry.projects.push({ name, path: path.resolve(projectPath), port: Number(port), core: null });
  writeRegistry(root, registry);
  console.log(`Registered ${name}.`);
} else if (command === "new") {
  const [name, port] = rest;
  if (!name || !/^[a-z0-9-]+$/.test(name) || !port) fail("Usage: ash-workspace.mjs new <workspace> <lowercase-name> <port>");
  const root = rootOrFail();
  const destination = path.join(workspacePaths(root).products, name);
  copyStarter(repoRoot, destination);
  const registry = readRegistry(root);
  registry.projects.push({ name, path: destination, port: Number(port), core: null });
  writeRegistry(root, registry);
  console.log(`Created ${destination}`);
} else if (command === "link-core") {
  const [name] = rest;
  if (!name) fail("Usage: ash-workspace.mjs link-core <workspace> <name>");
  const root = rootOrFail();
  const registry = readRegistry(root);
  const project = registry.projects.find((item) => item.name === name);
  if (!project) fail("Project is not registered.");
  const vendor = path.join(project.path, "vendor", "ash-ai-core");
  if (existsSync(vendor)) rmSync(vendor, { recursive: true, force: true });
  mkdirSync(path.dirname(vendor), { recursive: true });
  exportCore(repoRoot, vendor);
  const verified = verifyCore(vendor);
  if (!verified.ok) fail("Linked core failed verification.");
  project.core = verified.version;
  writeRegistry(root, registry);
  console.log(`Linked @ash/ai-core ${verified.version} into ${vendor}`);
} else if (command === "backup") {
  const [name] = rest;
  if (!name) fail("Usage: ash-workspace.mjs backup <workspace> <name>");
  const root = rootOrFail();
  const project = readRegistry(root).projects.find((item) => item.name === name);
  if (!project) fail("Project is not registered.");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(workspacePaths(root).backups, `${name}-${stamp}`);
  cpSync(project.path, destination, {
    recursive: true,
    filter: (item) => {
      const relative = path.relative(project.path, item).replaceAll("\\", "/");
      if (!relative || relative === ".") return true;
      if (/(^|\/)(node_modules|\.git|\.data)(\/|$)/.test(relative)) return false;
      if (/(^|\/)\.env$/.test(relative) || /(^|\/)\.env\.local$/.test(relative) || /(^|\/)\.env\..+\.local$/.test(relative)) return false;
      return true;
    },
  });
  console.log(`Backup written to ${destination}. It has not been restore-tested.`);
} else if (command === "check") {
  const [name] = rest;
  const root = rootOrFail();
  const projects = name ? readRegistry(root).projects.filter((item) => item.name === name) : readRegistry(root).projects;
  if (!projects.length) fail("No matching project.");
  for (const project of projects) {
    const coreDir = path.join(project.path, "vendor", "ash-ai-core");
    const core = existsSync(coreDir) ? verifyCore(coreDir) : { ok: false, version: null };
    console.log(`${project.name}: path ${existsSync(project.path) ? "ok" : "missing"}, port ${project.port}, core ${core.ok ? core.version : "not linked"}`);
    if (!existsSync(project.path) || (existsSync(coreDir) && !core.ok)) process.exitCode = 1;
  }
} else {
  fail("Commands: init, list, register, new, link-core, check, backup");
}
