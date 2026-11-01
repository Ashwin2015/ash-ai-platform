import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
]);

export function tryServeChat(appRoot: string, request: IncomingMessage, response: ServerResponse, pathname: string) {
  const method = request.method || "GET";
  if (method !== "GET" && method !== "HEAD") return false;
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  if (requestPath.startsWith("/api/")) return false;
  const filePath = path.resolve(appRoot, `.${decodeURIComponent(requestPath)}`);
  if (!filePath.startsWith(`${appRoot}${path.sep}`)) return false;
  let info;
  try {
    info = statSync(filePath);
  } catch {
    if (pathname === "/" || !path.extname(pathname)) {
      return tryServeChat(appRoot, request, response, "/index.html");
    }
    return false;
  }
  if (!info.isFile()) return false;
  response.setHeader("Content-Type", MIME.get(path.extname(filePath)) || "application/octet-stream");
  response.setHeader("Cache-Control", path.extname(filePath) === ".html" ? "no-store" : "public, max-age=300");
  if (method === "HEAD") {
    response.writeHead(200, { "Content-Length": info.size });
    response.end();
    return true;
  }
  response.writeHead(200);
  createReadStream(filePath).pipe(response);
  return true;
}
