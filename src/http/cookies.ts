import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";

export function parseCookies(request: IncomingMessage) {
  const header = request.headers.cookie;
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function sessionFromRequest(request: IncomingMessage) {
  const bearer = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
  if (bearer) return { token: bearer[1], via: "bearer" as const };
  const cookies = parseCookies(request);
  if (cookies.ash_session && /^[A-Za-z0-9_-]{40,}$/.test(cookies.ash_session)) {
    return { token: cookies.ash_session, via: "cookie" as const };
  }
  return { token: "", via: "none" as const };
}

export function csrfOk(request: IncomingMessage, via: "bearer" | "cookie" | "none") {
  if (via !== "cookie") return true;
  const method = request.method || "GET";
  if (method === "GET" || method === "HEAD") return true;
  const cookies = parseCookies(request);
  const header = String(request.headers["x-csrf-token"] || "");
  return Boolean(cookies.ash_csrf && header && cookies.ash_csrf === header);
}

export function authCookieHeaders(token: string, csrf: string, secure: boolean, maxAgeSeconds: number) {
  const base = `Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  const secureFlag = secure ? "; Secure" : "";
  return [
    `ash_session=${token}; HttpOnly${secureFlag}; ${base}`,
    `ash_csrf=${csrf}; ${base}`,
  ];
}

export function clearAuthCookieHeaders(secure: boolean) {
  const secureFlag = secure ? "; Secure" : "";
  return [
    `ash_session=; HttpOnly${secureFlag}; Path=/; SameSite=Lax; Max-Age=0`,
    `ash_csrf=; Path=/; SameSite=Lax; Max-Age=0`,
  ];
}

export function newCsrfToken() {
  return randomBytes(24).toString("base64url");
}

export function appendCookies(response: ServerResponse, cookies: string[]) {
  const current = response.getHeader("Set-Cookie");
  const list = Array.isArray(current) ? current.map(String) : current ? [String(current)] : [];
  response.setHeader("Set-Cookie", [...list, ...cookies]);
}

export function signingSecret(seed: string) {
  return createHash("sha256").update(`ash-sign:${seed || "local-dev"}`).digest("hex");
}
