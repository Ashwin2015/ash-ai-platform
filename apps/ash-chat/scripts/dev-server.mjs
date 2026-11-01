import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.ASH_CHAT_HOST || "127.0.0.1";
const port = positiveInteger(process.env.ASH_CHAT_PORT, 3036, "ASH_CHAT_PORT");
const backendValue = process.env.ASH_CHAT_API_ORIGIN || "http://127.0.0.1:3035";
const backend = parseLocalBackend(backendValue);
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
]);
const requestOrigin = `http://${host}:${port}`;
const JSON_LIMIT = 64 * 1024;

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be a valid TCP port.`);
  }
  return parsed;
}

function isLoopback(hostname) {
  return ["127.0.0.1", "localhost", "::1"].includes(hostname.replace(/^\[|\]$/g, "").toLowerCase());
}

function isPrivateIPv4(hostname) {
  const parts = hostname.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
}

function isTrustedLanOrigin(request, origin) {
  if (request.headers["x-forwarded-proto"] !== "https") return false;
  const remote = request.socket.remoteAddress || "";
  if (!["127.0.0.1", "::1", ":ffff:127.0.0.1"].includes(remote)) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && isPrivateIPv4(parsed.hostname);
  } catch {
    return false;
  }
}

function parseLocalBackend(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ASH_CHAT_API_ORIGIN must be a valid local HTTP URL.");
  }
  if (url.protocol !== "http:" || !isLoopback(url.hostname) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("ASH_CHAT_API_ORIGIN must be a loopback HTTP origin without credentials or a path.");
  }
  return url;
}

function safeHost(request) {
  const header = request.headers.host;
  if (!header) return false;
  try {
    const url = new URL(`http://${header}`);
    return isLoopback(url.hostname) && url.host.toLowerCase() === `${host}:${port}`.toLowerCase();
  } catch {
    return false;
  }
}

function setBaseHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
}

function sendJson(response, status, body) {
  setBaseHeaders(response);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > JSON_LIMIT) return null;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function proxyApi(request, response, pathname) {
  if (!safeHost(request)) {
    sendJson(response, 403, { error: { code: "forbidden", message: "ASH Chat is local-only." } });
    return;
  }
  const origin = request.headers.origin;
  if (origin && origin !== requestOrigin && !isTrustedLanOrigin(request, origin)) {
    sendJson(response, 403, { error: { code: "forbidden", message: "Cross-origin requests are not allowed." } });
    return;
  }
  if (!["GET", "POST", "DELETE", "PATCH", "HEAD"].includes(request.method || "")) {
    sendJson(response, 405, { error: { code: "invalid_request", message: "Method not allowed." } });
    return;
  }

  const contentType = String(request.headers["content-type"] || "");
  const isUpload = contentType.includes("multipart/form-data");
  const limit = isUpload ? 21 * 1024 * 1024 : JSON_LIMIT;
  let body;
  if (request.method === "POST" || request.method === "PATCH") {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += value.length;
      if (size > limit) {
        sendJson(response, 413, { error: { code: "invalid_request", message: "Request body is too large." } });
        return;
      }
      chunks.push(value);
    }
    body = Buffer.concat(chunks);
  }

  const controller = new AbortController();
  request.on("aborted", () => controller.abort());
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
  });

  const headers = new Headers();
  for (const name of ["authorization", "content-type", "accept"]) {
    const value = request.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  headers.set("origin", backend.origin);

  try {
    const upstream = await fetch(new URL(pathname, backend), {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
      ...(body === undefined ? {} : { duplex: "half" }),
      signal: controller.signal,
      redirect: "error",
    });
    setBaseHeaders(response);
    response.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      ...(upstream.headers.get("x-accel-buffering") ? { "X-Accel-Buffering": upstream.headers.get("x-accel-buffering") } : {}),
    });
    if (!upstream.body) {
      response.end();
      return;
    }
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!response.write(value)) {
          await new Promise((resolve) => response.once("drain", resolve));
        }
      }
    } finally {
      reader.releaseLock();
      response.end();
    }
  } catch {
    if (response.destroyed) return;
    if (!response.headersSent) {
      sendJson(response, 503, { error: { code: "provider_unavailable", message: "ASH AI PLATFORM is not reachable. Start the backend and try again." } });
    } else {
      response.end();
    }
  }
}

function serveStatic(request, response, pathname) {
  if (!safeHost(request)) {
    sendJson(response, 403, { error: "ASH Chat is local-only." });
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(appRoot, `.${decodeURIComponent(requestPath)}`);
  if (!filePath.startsWith(`${appRoot}${path.sep}`)) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }
  let info;
  try {
    info = statSync(filePath);
  } catch {
    sendJson(response, 404, { error: "Not found." });
    return;
  }
  if (!info.isFile()) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }
  setBaseHeaders(response);
  response.setHeader("Content-Type", mimeTypes.get(path.extname(filePath)) || "application/octet-stream");
  if (request.method === "HEAD") {
    response.writeHead(200, { "Content-Length": info.size });
    response.end();
    return;
  }
  response.writeHead(200);
  createReadStream(filePath).pipe(response);
}

const server = createServer((request, response) => {
  let pathname;
  try {
    pathname = new URL(request.url || "/", requestOrigin).pathname;
  } catch {
    sendJson(response, 400, { error: "Invalid request URL." });
    return;
  }
  if (pathname === "/healthz") {
    sendJson(response, 200, { status: "ok", app: "ash-chat" });
    return;
  }
  if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
    void proxyApi(request, response, `${pathname}${new URL(request.url || "/", requestOrigin).search}`).catch(() => {
      if (!response.headersSent) sendJson(response, 503, { error: "ASH AI PLATFORM is unavailable." });
      else response.end();
    });
    return;
  }
  if (pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "API route not found." });
    return;
  }
  serveStatic(request, response, pathname);
});

server.listen(port, host, () => {
  console.info(`ASH Chat preview: http://${host}:${port}`);
  console.info(`Platform API proxy: ${backend.origin} (same-origin browser requests)`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
