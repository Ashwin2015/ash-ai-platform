import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { AuthService, type AuthenticatedUser } from "../security/auth.ts";
import { allowedBrowserOrigins, type PlatformConfig } from "../config.ts";
import { createFileStore } from "../storage/adapter.ts";
import { openDatabase } from "../storage/open-database.ts";
import { OllamaProvider } from "../providers/ollama.ts";
import { GeminiProvider } from "../providers/gemini.ts";
import { OpenAICompatibleProvider } from "../providers/openai-compatible.ts";
import { ProviderRegistry } from "../providers/registry.ts";
import { ChatRuntime } from "../runtime/chat-runtime.ts";
import { ChatService } from "../chat/chat-service.ts";
import { MemoryService } from "../memory/memory-service.ts";
import { KnowledgeService } from "../knowledge/knowledge-service.ts";
import { EmbeddingService } from "../embeddings/local.ts";
import { processUpload } from "../multimodal/documents.ts";
import { errorPayload, PlatformError, sanitizeLogError } from "../errors.ts";
import { parseMultipart, readRawBody } from "./multipart.ts";
import { appendCookies, authCookieHeaders, clearAuthCookieHeaders, csrfOk, newCsrfToken, sessionFromRequest } from "./cookies.ts";
import { tryServeChat } from "./static.ts";
import { searchWikipedia } from "../research/wikipedia.ts";

const JSON_LIMIT = 64 * 1024;
const AUTH_RATE_WINDOW_MS = 60_000;
const AUTH_RATE_LIMIT = 30;

type JsonObject = Record<string, unknown>;

class RequestRateLimiter {
  private readonly attempts = new Map<string, { startedAt: number; count: number }>();

  allow(key: string, now: number) {
    for (const [candidate, item] of this.attempts) {
      if (now - item.startedAt >= AUTH_RATE_WINDOW_MS) this.attempts.delete(candidate);
    }
    if (this.attempts.size > 1_000) {
      const oldest = this.attempts.keys().next().value as string | undefined;
      if (oldest) this.attempts.delete(oldest);
    }
    const item = this.attempts.get(key);
    if (!item || now - item.startedAt >= AUTH_RATE_WINDOW_MS) {
      this.attempts.set(key, { startedAt: now, count: 1 });
      return true;
    }
    item.count += 1;
    return item.count <= AUTH_RATE_LIMIT;
  }
}

function isLoopbackHostname(hostname: string) {
  return ["localhost", "127.0.0.1", "::1"].includes(hostname.replace(/^\[|\]$/g, "").toLowerCase());
}

function isSafeRequestHost(request: IncomingMessage, config: PlatformConfig) {
  const host = request.headers.host;
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (isLoopbackHostname(hostname)) return true;
    return allowedBrowserOrigins(config).some((origin) => hostname === new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isSafeOrigin(request: IncomingMessage, config: PlatformConfig) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    const host = request.headers.host;
    if (!host) return false;
    if (allowedBrowserOrigins(config).includes(origin.replace(/\/$/, ""))) return true;
    if (parsedOrigin.protocol !== "http:" || !isLoopbackHostname(parsedOrigin.hostname)) return false;
    const requestUrl = new URL(`http://${host}`);
    return parsedOrigin.host.toLowerCase() === requestUrl.host.toLowerCase();
  } catch {
    return false;
  }
}

function requestIsSecure(request: IncomingMessage, config: PlatformConfig) {
  return request.headers["x-forwarded-proto"] === "https" || Boolean(config.publicOrigin);
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > JSON_LIMIT) throw new PlatformError("invalid_request", "Request body is too large.", 413);
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Expected an object.");
    }
    return value as JsonObject;
  } catch {
    throw new PlatformError("invalid_request", "Request body must be a JSON object.", 400);
  }
}

function allowKeys(body: JsonObject, allowed: string[]) {
  const unexpected = Object.keys(body).find((key) => !allowed.includes(key));
  if (unexpected) {
    throw new PlatformError("invalid_request", `Unsupported request field: ${unexpected}.`, 400);
  }
}

function applyCors(request: IncomingMessage, response: ServerResponse, config: PlatformConfig) {
  const origin = request.headers.origin;
  if (!origin) return;
  const normalized = origin.replace(/\/$/, "");
  if (!allowedBrowserOrigins(config).includes(normalized)) return;
  response.setHeader("Access-Control-Allow-Origin", normalized);
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-CSRF-Token");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, HEAD, OPTIONS");
  response.setHeader("Access-Control-Max-Age", "600");
  response.setHeader("Vary", "Origin");
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
}

function setHeaders(response: ServerResponse) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "microphone=(self), camera=(self), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  setHeaders(response);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function getUser(auth: AuthService, request: IncomingMessage): Promise<AuthenticatedUser> {
  const session = sessionFromRequest(request);
  if (!csrfOk(request, session.via)) {
    throw new PlatformError("forbidden", "The request failed a CSRF check.", 403);
  }
  return auth.authenticate(request.headers.authorization, session.via === "cookie" ? session.token : "");
}

function publicConversation(conversation: {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
  projectId?: string | null;
}) {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    projectId: conversation.projectId ?? null,
    ...(conversation.messageCount === undefined ? {} : { messageCount: conversation.messageCount }),
  };
}

export function createPlatformServer(config: PlatformConfig) {
  const database = openDatabase(config);
  const files = createFileStore(config, config.filesDirectory || path.join(path.dirname(config.databasePath), "files"));
  const auth = new AuthService(database, config.bootstrapKey, config.sessionTtlSeconds, Date.now, config.inviteCode || "");
  const chatRoot = path.join(config.rootDirectory || path.dirname(config.databasePath), "apps", "ash-chat");
  const sessionSeconds = config.sessionTtlSeconds;
  const providers = new ProviderRegistry();
  const ollama = config.ollamaBaseUrl ? new OllamaProvider(config.ollamaBaseUrl) : null;
  if (ollama) providers.register(ollama);
  if (config.geminiApiKey) providers.register(new GeminiProvider(config.geminiApiKey, config.geminiBaseUrl));
  if (config.groqApiKey) providers.register(new OpenAICompatibleProvider("groq", "Groq", config.groqApiKey, config.groqBaseUrl || "https://api.groq.com/openai/v1"));
  if (config.openrouterApiKey) {
    providers.register(new OpenAICompatibleProvider(
      "openrouter",
      "OpenRouter",
      config.openrouterApiKey,
      config.openrouterBaseUrl || "https://openrouter.ai/api/v1",
    ));
  }
  const runtime = new ChatRuntime(providers);
  const embeddings = new EmbeddingService(ollama ?? undefined);
  const memories = new MemoryService(database);
  const knowledge = new KnowledgeService(database, embeddings);
  const chat = new ChatService(database, runtime, Date.now, { files, memories, knowledge });
  const rateLimiter = new RequestRateLimiter();
  const geminiStatus = new GeminiProvider(config.geminiApiKey || "", config.geminiBaseUrl);
  const groqStatus = new OpenAICompatibleProvider("groq", "Groq", config.groqApiKey || "", config.groqBaseUrl || "https://api.groq.com/openai/v1");
  const openrouterStatus = new OpenAICompatibleProvider("openrouter", "OpenRouter", config.openrouterApiKey || "", config.openrouterBaseUrl || "https://openrouter.ai/api/v1");

  const server: Server = createServer((request, response) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const parsedUrl = new URL(request.url || "/", "http://localhost");
    const pathname = parsedUrl.pathname;
    setHeaders(response);
    applyCors(request, response, config);
    response.on("finish", () => {
      console.info(JSON.stringify({
        level: "info",
        requestId,
        method: request.method,
        path: pathname,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
      }));
    });

    void (async () => {
      if (!isSafeRequestHost(request, config) || !isSafeOrigin(request, config)) {
        throw new PlatformError("forbidden", "Requests must use this local platform origin.", 403);
      }

      const method = request.method || "GET";
      if (method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (method === "GET" && pathname === "/healthz") {
        sendJson(response, 200, { status: "ok", app: "ash-ai-platform" });
        return;
      }
      if ((method === "GET" || method === "HEAD") && !pathname.startsWith("/api/") && config.serveChat) {
        if (tryServeChat(chatRoot, request, response, pathname)) return;
      }
      if (method === "GET" && pathname === "/") {
        sendJson(response, 200, {
          name: "ASH AI PLATFORM",
          apiVersion: "v1",
          health: "/api/v1/health",
        });
        return;
      }

      if (method === "GET" && pathname === "/api/v1/health") {
        const [ollamaHealth, geminiHealth, groqHealth, openrouterHealth] = await Promise.all([
          ollama
            ? ollama.health(AbortSignal.timeout(2_500))
            : Promise.resolve({ available: false, configured: false, modelCount: 0, message: "Ollama is local-only and is disabled in hosted mode." }),
          geminiStatus.health(AbortSignal.timeout(2_500)),
          groqStatus.health(AbortSignal.timeout(2_500)),
          openrouterStatus.health(AbortSignal.timeout(2_500)),
        ]);
        sendJson(response, 200, {
          status: "ok",
          apiVersion: "v1",
          providers: {
            ollama: ollamaHealth,
            gemini: geminiHealth,
            groq: groqHealth,
            openrouter: openrouterHealth,
          },
        });
        return;
      }

      if (pathname.startsWith("/api/v1/auth/")) {
        const client = request.socket.remoteAddress || "unknown";
        if (!rateLimiter.allow(client, Date.now())) {
          throw new PlatformError("rate_limited", "Too many authentication attempts. Try again shortly.", 429);
        }
      }

      if (method === "POST" && pathname === "/api/v1/auth/register") {
        const body = await readJson(request);
        allowKeys(body, ["email", "password"]);
        if (typeof body.email !== "string" || typeof body.password !== "string") {
          throw new PlatformError("invalid_request", "email and password are required.", 400);
        }
        const user = await auth.register(body.email, body.password);
        const login = await auth.login(body.email, body.password);
        const csrf = newCsrfToken();
        appendCookies(response, authCookieHeaders(login.token, csrf, requestIsSecure(request, config), sessionSeconds));
        sendJson(response, 201, { user, accessToken: login.token, expiresAt: login.expiresAt, csrfToken: csrf });
        return;
      }

      if (method === "POST" && pathname === "/api/v1/auth/login") {
        const body = await readJson(request);
        allowKeys(body, ["email", "password"]);
        if (typeof body.email !== "string" || typeof body.password !== "string") {
          throw new PlatformError("invalid_request", "email and password are required.", 400);
        }
        const login = await auth.login(body.email, body.password);
        const csrf = newCsrfToken();
        appendCookies(response, authCookieHeaders(login.token, csrf, requestIsSecure(request, config), sessionSeconds));
        sendJson(response, 200, { ...login, accessToken: login.token, csrfToken: csrf });
        return;
      }

      if (method === "POST" && pathname === "/api/v1/auth/logout") {
        const session = sessionFromRequest(request);
        await getUser(auth, request);
        await auth.revoke(request.headers.authorization, session.via === "cookie" ? session.token : "");
        appendCookies(response, clearAuthCookieHeaders(requestIsSecure(request, config)));
        sendJson(response, 200, { signedOut: true });
        return;
      }

      if (method === "POST" && pathname === "/api/v1/auth/forgot-password") {
        const body = await readJson(request);
        allowKeys(body, ["email"]);
        sendJson(response, 200, {
          accepted: true,
          message: "If that account exists, the owner can reset access from the private server. Email delivery is not configured in this private test.",
        });
        return;
      }

      if (method === "GET" && pathname === "/api/v1/auth/me") {
        const user = await getUser(auth, request);
        sendJson(response, 200, { user });
        return;
      }

      const user = await getUser(auth, request);

      if (method === "GET" && pathname === "/api/v1/account/export") {
        sendJson(response, 200, { export: await auth.exportAccount(user.id), exportedAt: Date.now() });
        return;
      }
      if (method === "DELETE" && pathname === "/api/v1/account") {
        await auth.deleteAccount(user.id);
        await files.removeUser(user.id);
        sendJson(response, 200, { deleted: true });
        return;
      }

      if (method === "GET" && pathname === "/api/v1/models") {
        sendJson(response, 200, { models: await providers.listModels() });
        return;
      }

      if (method === "GET" && pathname === "/api/v1/tools") {
        sendJson(response, 200, {
          tools: [
            { id: "search_knowledge", name: "Search project knowledge", execution: "server-side retrieval", approval: "not required" },
            { id: "search_memory", name: "Search approved memory", execution: "server-side retrieval", approval: "not required" },
            { id: "search_wikipedia", name: "Wikipedia reference lookup", execution: "server-side retrieval", approval: "not required" },
          ],
        });
        return;
      }

      if (method === "GET" && pathname === "/api/v1/research") {
        const query = parsedUrl.searchParams.get("q") || "";
        sendJson(response, 200, await searchWikipedia(query));
        return;
      }

      if (pathname === "/api/v1/projects" && method === "GET") {
        sendJson(response, 200, { projects: await database.listProjects(user.id) });
        return;
      }
      if (pathname === "/api/v1/projects" && method === "POST") {
        const body = await readJson(request);
        allowKeys(body, ["name", "instructions", "localOnly"]);
        if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 80) {
          throw new PlatformError("invalid_request", "Project name must be 1–80 characters.", 400);
        }
        const now = Date.now();
        const project = {
          id: randomUUID(),
          name: body.name.trim(),
          instructions: typeof body.instructions === "string" ? body.instructions.slice(0, 4_000) : "",
          localOnly: body.localOnly === true,
          createdAt: now,
          updatedAt: now,
        };
        await database.createProject(user.id, project);
        sendJson(response, 201, { project });
        return;
      }
      const projectMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);
      if (projectMatch) {
        const projectId = decodeURIComponent(projectMatch[1]);
        if (method === "GET") {
          const project = await database.findProject(user.id, projectId);
          if (!project) throw new PlatformError("not_found", "Project not found.", 404);
          sendJson(response, 200, { project, files: await database.listAttachments(user.id, projectId) });
          return;
        }
        if (method === "PATCH") {
          const body = await readJson(request);
          allowKeys(body, ["name", "instructions", "localOnly"]);
          if (!await database.updateProject(user.id, projectId, {
            name: typeof body.name === "string" ? body.name.trim() : undefined,
            instructions: typeof body.instructions === "string" ? body.instructions : undefined,
            localOnly: typeof body.localOnly === "boolean" ? body.localOnly : undefined,
          }, Date.now())) {
            throw new PlatformError("not_found", "Project not found.", 404);
          }
          sendJson(response, 200, { project: await database.findProject(user.id, projectId) });
          return;
        }
        if (method === "DELETE") {
          if (!await database.deleteProject(user.id, projectId)) throw new PlatformError("not_found", "Project not found.", 404);
          sendJson(response, 200, { deleted: true });
          return;
        }
      }

      if (pathname === "/api/v1/memories" && method === "GET") {
        const scope = parsedUrl.searchParams.get("scope") as "personal" | "project" | null;
        const status = parsedUrl.searchParams.get("status") as "pending" | "approved" | null;
        const projectId = parsedUrl.searchParams.get("projectId");
        sendJson(response, 200, {
          memories: await memories.list(user.id, scope || undefined, projectId === "" ? null : projectId || undefined, status || undefined),
        });
        return;
      }
      if (pathname === "/api/v1/memories" && method === "POST") {
        const body = await readJson(request);
        allowKeys(body, ["scope", "projectId", "content", "status"]);
        if (body.scope !== "personal" && body.scope !== "project") {
          throw new PlatformError("invalid_request", "Memory scope must be personal or project.", 400);
        }
        const record = await memories.create(user.id, {
          scope: body.scope,
          projectId: typeof body.projectId === "string" ? body.projectId : null,
          content: typeof body.content === "string" ? body.content : "",
          status: body.status === "approved" ? "approved" : "pending",
        });
        sendJson(response, 201, { memory: record });
        return;
      }
      const memoryMatch = pathname.match(/^\/api\/v1\/memories\/([^/]+)$/);
      if (memoryMatch) {
        const memoryId = decodeURIComponent(memoryMatch[1]);
        if (method === "PATCH") {
          const body = await readJson(request);
          allowKeys(body, ["content", "status"]);
          await memories.update(user.id, memoryId, {
            content: typeof body.content === "string" ? body.content : undefined,
            status: body.status === "approved" || body.status === "pending" ? body.status : undefined,
          });
          sendJson(response, 200, { updated: true });
          return;
        }
        if (method === "DELETE") {
          await memories.delete(user.id, memoryId);
          sendJson(response, 200, { deleted: true });
          return;
        }
      }

      if (pathname === "/api/v1/knowledge/search" && method === "POST") {
        const body = await readJson(request);
        allowKeys(body, ["query", "projectId"]);
        if (typeof body.query !== "string" || !body.query.trim()) {
          throw new PlatformError("invalid_request", "A search query is required.", 400);
        }
        const results = await knowledge.retrieve(
          user.id,
          typeof body.projectId === "string" ? body.projectId : null,
          body.query.trim(),
        );
        sendJson(response, 200, { results });
        return;
      }

      if (pathname === "/api/v1/uploads" && method === "POST") {
        const contentType = request.headers["content-type"] || "";
        if (!contentType.includes("multipart/form-data")) {
          throw new PlatformError("invalid_request", "Uploads must use multipart/form-data.", 400);
        }
        const parsed = parseMultipart(contentType, await readRawBody(request));
        const file = parsed.files[0];
        if (!file) throw new PlatformError("invalid_request", "Choose an image or PDF to upload.", 400);
        const processed = await processUpload(file.fileName, file.mimeType, file.bytes);
        const attachmentId = randomUUID();
        const storageName = `${attachmentId}${path.extname(file.fileName) || (processed.kind === "pdf" ? ".pdf" : ".img")}`;
        const projectId = parsed.fields.projectId || null;
        const conversationId = parsed.fields.conversationId || null;
        if (projectId && !await database.findProject(user.id, projectId)) {
          throw new PlatformError("not_found", "Project not found.", 404);
        }
        if (conversationId && !await database.findConversation(user.id, conversationId)) {
          throw new PlatformError("not_found", "Conversation not found.", 404);
        }
        await files.write(user.id, storageName, file.bytes);
        await database.createAttachment({
          id: attachmentId,
          userId: user.id,
          projectId,
          conversationId,
          kind: processed.kind,
          fileName: file.fileName,
          mimeType: processed.mimeType,
          size: file.bytes.length,
          storageName,
          extractedText: processed.extractedText,
          pageCount: processed.pageCount,
          createdAt: Date.now(),
        });
        if (processed.extractedText) {
          await knowledge.ingest(user.id, projectId, file.fileName, processed.extractedText, attachmentId);
        }
        sendJson(response, 201, {
          attachment: {
            id: attachmentId,
            fileName: file.fileName,
            kind: processed.kind,
            mimeType: processed.mimeType,
            pageCount: processed.pageCount,
            scanned: processed.scanned,
            extractedChars: processed.extractedText.length,
          },
        });
        return;
      }

      const attachmentFile = pathname.match(/^\/api\/v1\/attachments\/([^/]+)\/file$/);
      if (attachmentFile && method === "GET") {
        const attachment = await database.findAttachment(user.id, decodeURIComponent(attachmentFile[1]));
        if (!attachment) throw new PlatformError("not_found", "Attachment not found.", 404);
        const bytes = await files.read(user.id, attachment.storageName);
        if (!bytes) throw new PlatformError("not_found", "Attachment file is missing.", 404);
        setHeaders(response);
        response.writeHead(200, { "Content-Type": attachment.mimeType, "Content-Length": bytes.length });
        response.end(bytes);
        return;
      }

      if (pathname === "/api/v1/chat/conversations" && method === "GET") {
        const query = parsedUrl.searchParams.get("q") || "";
        const projectIdParam = parsedUrl.searchParams.get("projectId");
        const projectId = projectIdParam === null ? undefined : projectIdParam || null;
        sendJson(response, 200, { conversations: (await chat.listConversations(user.id, query, projectId)).map(publicConversation) });
        return;
      }

      if (pathname === "/api/v1/chat/conversations" && method === "POST") {
        const body = await readJson(request);
        allowKeys(body, ["title", "projectId"]);
        const title = typeof body.title === "string" ? body.title.trim() : "New conversation";
        if (!title || title.length > 120) throw new PlatformError("invalid_request", "Conversation title must be 1–120 characters.", 400);
        const conversation = await chat.createConversation(user.id, title, typeof body.projectId === "string" ? body.projectId : null);
        sendJson(response, 201, { conversation });
        return;
      }

      const conversationMatch = pathname.match(/^\/api\/v1\/chat\/conversations\/([^/]+)(?:\/(messages))?$/);
      if (conversationMatch) {
        const conversationId = decodeURIComponent(conversationMatch[1]);
        const hasMessagesSuffix = Boolean(conversationMatch[2]);

        if (method === "PATCH" && !hasMessagesSuffix) {
          const body = await readJson(request);
          allowKeys(body, ["title"]);
          if (typeof body.title !== "string") throw new PlatformError("invalid_request", "Conversation title is required.", 400);
          await chat.renameConversation(user.id, conversationId, body.title);
          sendJson(response, 200, { updated: true });
          return;
        }
        if (method === "GET") {
          const result = await chat.getMessages(user.id, conversationId);
          sendJson(response, 200, { conversation: publicConversation(result.conversation), messages: result.messages });
          return;
        }
        if (method === "DELETE" && !hasMessagesSuffix) {
          await chat.deleteConversation(user.id, conversationId);
          sendJson(response, 200, { deleted: true });
          return;
        }
        if (method === "POST" && hasMessagesSuffix) {
          const body = await readJson(request);
          allowKeys(body, ["content", "mode", "providerId", "modelId", "attachmentIds", "regenerateFromMessageId", "editMessageId", "webSearch"]);
          if (typeof body.content !== "string") {
            throw new PlatformError("invalid_request", "Message content is required.", 400);
          }
          const mode = body.mode === undefined ? "auto" : body.mode;
          if (mode !== "auto" && mode !== "free_cloud" && mode !== "local_only" && mode !== "manual") {
            throw new PlatformError("invalid_request", "Choose a supported routing mode.", 400);
          }
          const providerId = typeof body.providerId === "string" ? body.providerId : "";
          const modelId = typeof body.modelId === "string" ? body.modelId : "";
          if (mode === "manual" && (!providerId || !modelId.trim())) {
            throw new PlatformError("invalid_request", "Choose an available provider and model.", 400);
          }

          const abortController = new AbortController();
          request.on("aborted", () => abortController.abort());
          response.on("close", () => {
            if (!response.writableEnded) abortController.abort();
          });
          const attachmentIds = Array.isArray(body.attachmentIds)
            ? body.attachmentIds.filter((value): value is string => typeof value === "string")
            : [];
          const { userMessage, model, stream: assistantStream, suggestedMemories } = await chat.prepareReply(
            user.id,
            conversationId,
            body.content,
            providerId,
            modelId,
            abortController.signal,
            mode,
            {
              attachmentIds,
              regenerateFromMessageId: typeof body.regenerateFromMessageId === "string" ? body.regenerateFromMessageId : undefined,
              editMessageId: typeof body.editMessageId === "string" ? body.editMessageId : undefined,
              webSearch: body.webSearch === true,
            },
          );
          setHeaders(response);
          response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-store, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          });
          response.flushHeaders();
          const sendEvent = (event: string, data: unknown) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          sendEvent("message", { type: "user", id: userMessage.id });
          sendEvent("model", { providerId: model.providerId, modelId: model.id, displayName: model.displayName, locality: model.locality, pricing: model.pricing });
          if (suggestedMemories.length) sendEvent("memory_suggestions", { suggestions: suggestedMemories });
          let assistantText = "";
          try {
            for await (const text of assistantStream) {
              if (abortController.signal.aborted) break;
              assistantText += text;
              sendEvent("token", { text });
            }
            if (assistantText && !abortController.signal.aborted) {
              const assistantMessage = await chat.saveAssistantReply(user.id, conversationId, assistantText, { providerId: model.providerId, id: model.id });
              sendEvent("done", { messageId: assistantMessage.id });
            } else if (!abortController.signal.aborted) {
              sendEvent("error", { code: "provider_unavailable", message: "The model returned an empty response." });
            }
          } catch (error) {
            const payload = errorPayload(error).body.error;
            sendEvent("error", payload);
          } finally {
            response.end();
          }
          return;
        }
      }

      throw new PlatformError("not_found", "API route not found.", 404);
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      const payload = errorPayload(error);
      sendJson(response, payload.status, payload.body);
      if (!(error instanceof PlatformError)) {
        console.error(JSON.stringify({
          level: "error",
          requestId,
          code: "internal_error",
          ...sanitizeLogError(error),
        }));
      }
    });
  });

  server.requestTimeout = 180_000;
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  return { server, database, files };
}
