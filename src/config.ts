import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type PlatformConfig = {
  rootDirectory: string;
  host: string;
  port: number;
  databasePath: string;
  databaseUrl?: string;
  applyMigrations?: boolean;
  migrationsDirectory?: string;
  bootstrapKey: string;
  inviteCode?: string;
  sessionTtlSeconds: number;
  ollamaBaseUrl: string;
  filesDirectory?: string;
  geminiApiKey?: string;
  groqApiKey?: string;
  openrouterApiKey?: string;
  geminiBaseUrl?: string;
  groqBaseUrl?: string;
  openrouterBaseUrl?: string;
  autoInstallLocalModels?: boolean;
  publicOrigin?: string;
  chatPublicOrigin?: string;
  serveChat?: boolean;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  supabaseStorageBucket?: string;
};

function readEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

function positiveInteger(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function localOllamaUrl(value: string | undefined) {
  let url: URL;
  try {
    url = new URL(value || "http://127.0.0.1:11434");
  } catch {
    throw new Error("ASH_PLATFORM_OLLAMA_URL must be a valid local HTTP URL.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(hostname) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("Ollama must use an HTTP loopback URL without credentials, query, or fragment.");
  }
  return url.toString().replace(/\/$/, "");
}

function httpsOrigin(value: string, name: string) {
  const trimmed = value.replace(/\/$/, "");
  let origin: URL;
  try { origin = new URL(trimmed); } catch {
    throw new Error(`${name} must be an https:// URL.`);
  }
  if (origin.protocol !== "https:") throw new Error(`${name} must be https.`);
  if (origin.username || origin.password || origin.search || origin.hash) {
    throw new Error(`${name} must not include credentials, query, or fragment.`);
  }
  return origin.origin;
}

export function allowedBrowserOrigins(config: PlatformConfig) {
  return [config.publicOrigin, config.chatPublicOrigin].filter((value): value is string => Boolean(value));
}

export function loadConfig(rootDirectory = process.cwd()): PlatformConfig {
  const root = path.resolve(rootDirectory);
  readEnvFile(path.join(root, ".env"));
  readEnvFile(path.join(root, ".env.local"));

  const hostValue = process.env.ASH_PLATFORM_HOST || "127.0.0.1";
  const publicOriginValue = (process.env.ASH_PLATFORM_PUBLIC_ORIGIN || "").replace(/\/$/, "");
  const chatPublicOriginValue = (process.env.ASH_CHAT_PUBLIC_ORIGIN || "").replace(/\/$/, "");
  const loopbackHost = hostValue === "127.0.0.1" || hostValue === "::1" || hostValue === "localhost";
  if (!loopbackHost) {
    if (hostValue !== "0.0.0.0") throw new Error("ASH_PLATFORM_HOST must be loopback or 0.0.0.0 for hosted mode.");
    if (!publicOriginValue) throw new Error("Hosted mode requires ASH_PLATFORM_PUBLIC_ORIGIN as an https:// URL.");
  }

  const publicOrigin = publicOriginValue ? httpsOrigin(publicOriginValue, "ASH_PLATFORM_PUBLIC_ORIGIN") : "";
  const chatPublicOrigin = chatPublicOriginValue ? httpsOrigin(chatPublicOriginValue, "ASH_CHAT_PUBLIC_ORIGIN") : "";
  const hosted = !loopbackHost;
  const databaseUrl = process.env.DATABASE_URL || process.env.ASH_PLATFORM_DATABASE_URL || "";
  if (hosted) {
    if (!databaseUrl) {
      throw new Error("Hosted mode requires DATABASE_URL for Supabase PostgreSQL. SQLite is local-only.");
    }
    if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
      throw new Error("DATABASE_URL must be a postgres:// or postgresql:// connection string.");
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Hosted mode requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for private file storage.");
    }
  }
  if (databaseUrl && !/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    throw new Error("DATABASE_URL must be a postgres:// or postgresql:// connection string.");
  }

  const configuredDatabase = process.env.ASH_PLATFORM_DATABASE || ".data/ash-platform.sqlite";
  const databasePath = path.resolve(root, configuredDatabase);
  const relativeDatabase = path.relative(root, databasePath);
  if (!databaseUrl && (relativeDatabase === ".." || relativeDatabase.startsWith(`..${path.sep}`) || path.isAbsolute(relativeDatabase))) {
    throw new Error("ASH_PLATFORM_DATABASE must stay inside the platform project directory.");
  }

  const filesDirectory = path.resolve(root, process.env.ASH_PLATFORM_FILES || ".data/files");
  const relativeFiles = path.relative(root, filesDirectory);
  if (!hosted && (relativeFiles === ".." || relativeFiles.startsWith(`..${path.sep}`) || path.isAbsolute(relativeFiles))) {
    throw new Error("ASH_PLATFORM_FILES must stay inside the platform project directory.");
  }

  const sessionHours = positiveInteger(process.env.ASH_PLATFORM_SESSION_HOURS, 12, "ASH_PLATFORM_SESSION_HOURS");
  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  if (supabaseUrl) httpsOrigin(supabaseUrl, "SUPABASE_URL");

  return {
    rootDirectory: root,
    host: hostValue,
    port: positiveInteger(process.env.PORT || process.env.ASH_PLATFORM_PORT, 3035, "ASH_PLATFORM_PORT"),
    databasePath,
    databaseUrl: databaseUrl || undefined,
    applyMigrations: process.env.ASH_PLATFORM_APPLY_MIGRATIONS === "1",
    migrationsDirectory: path.join(root, "supabase", "migrations"),
    filesDirectory,
    bootstrapKey: process.env.ASH_PLATFORM_BOOTSTRAP_KEY || "",
    inviteCode: process.env.ASH_PLATFORM_INVITE_CODE || "",
    publicOrigin,
    chatPublicOrigin,
    serveChat: process.env.ASH_PLATFORM_SERVE_CHAT !== "0",
    sessionTtlSeconds: sessionHours * 60 * 60,
    ollamaBaseUrl: hosted ? "" : localOllamaUrl(process.env.ASH_PLATFORM_OLLAMA_URL),
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    groqApiKey: process.env.GROQ_API_KEY || "",
    openrouterApiKey: process.env.OPENROUTER_API_KEY || "",
    geminiBaseUrl: process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
    groqBaseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
    openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    autoInstallLocalModels: hosted ? false : process.env.ASH_PLATFORM_AUTO_INSTALL_MODELS !== "0",
    supabaseUrl: supabaseUrl || undefined,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || "ash-private-files",
  };
}
