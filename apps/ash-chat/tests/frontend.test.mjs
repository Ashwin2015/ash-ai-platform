import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { api } from "../src/api-client.js";
import { renderMarkdown } from "../src/markdown.js";

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const devServerPath = path.join(platformRoot, "apps", "ash-chat", "scripts", "dev-server.mjs");

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function getFreePort() {
  const server = createServer();
  const origin = await listen(server);
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return Number(new URL(origin).port);
}

async function waitForFrontend(origin, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (child.exitCode !== null) throw new Error("ASH Chat frontend server exited before starting.");
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("ASH Chat frontend server did not start in time.");
}

test("markdown renderer supports common syntax while escaping untrusted HTML", () => {
  const html = renderMarkdown([
    "# A safe title",
    "",
    "Text with **bold**, *italic*, `code`, and [a link](https://example.test/path).",
    "",
    "- first",
    "- second",
    "",
    "```js",
    "console.log('<script>alert(1)</script>')",
    "```",
    "",
    "<img src=x onerror=alert(1)>",
    "",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
  ].join("\n"));
  assert.match(html, /<h1>A safe title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /<ul><li>first<\/li><li>second<\/li><\/ul>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x|<script>alert/);
  assert.match(html, /<table><tbody><tr><th>A<\/th><th>B<\/th><\/tr><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/);
  const escaped = renderMarkdown("Title\n\\---\nHello \\<br> there");
  assert.match(escaped, /<hr>/);
  assert.doesNotMatch(escaped, /\\---|\\<br>/);
  const math = renderMarkdown("Display \\[E = mc^2\\] and inline \\(a + b\\).");
  assert.match(math, /\\\[E = mc\^2\\\]/);
  assert.match(math, /\\\(a \+ b\\\)/);
});

test("login normalizes the Stage 1 session token response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/v1/auth/login");
    assert.equal(JSON.parse(options.body).email, "local@example.test");
    return new Response(JSON.stringify({
      token: "stage1-session-token",
      expiresAt: 123,
      user: { id: "local-user", email: "local@example.test" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await api.login("local@example.test", "test-password");
    assert.equal(result.accessToken, "stage1-session-token");
    assert.equal(result.user.email, "local@example.test");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ASH Chat serves a private responsive frontend and proxies the existing API same-origin", async (t) => {
  let observedOrigin = "";
  const mockBackend = createServer(async (request, response) => {
    observedOrigin = request.headers.origin || "";
    if (request.url === "/api/v1/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok", apiVersion: "v1", providers: { ollama: { available: true } } }));
      return;
    }
    if (request.url === "/api/v1/auth/login") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      assert.equal(JSON.parse(Buffer.concat(chunks).toString()).password, "do-not-log-this");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ accessToken: "mock-session-token", user: { id: "local-user", email: "local@example.test" } }));
      return;
    }
    if (request.url === "/api/v1/models" && request.headers.authorization === "Bearer mock-session-token") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        models: [{
          providerId: "ollama",
          id: "model:latest",
          displayName: "Local model",
          locality: "local",
          capabilities: { textInput: true, textOutput: true, streaming: true, imageInput: false, pdfDirectInput: false, pdfTextPreprocessing: false, toolCalling: false },
        }],
      }));
      return;
    }
    if (request.url === "/api/v1/chat/conversations" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ conversations: [] }));
      return;
    }
    if (request.url?.startsWith("/api/v1/chat/conversations/") && request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(body.content, "Hello local model");
      assert.equal(body.providerId, "ollama");
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("event: token\ndata: {\"text\":\"Hello\"}\n\n");
      response.write("event: token\ndata: {\"text\":\" back\"}\n\n");
      response.end("event: done\ndata: {\"messageId\":\"assistant-1\"}\n\n");
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
  });
  const backendOrigin = await listen(mockBackend);
  const port = await getFreePort();
  const frontendOrigin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [devServerPath], {
    cwd: platformRoot,
    env: {
      ...process.env,
      ASH_CHAT_HOST: "127.0.0.1",
      ASH_CHAT_PORT: String(port),
      ASH_CHAT_API_ORIGIN: backendOrigin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childOutput = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { childOutput += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { childOutput += chunk; });

  t.after(async () => {
    child.kill();
    if (child.exitCode === null) await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
    await new Promise((resolve, reject) => mockBackend.close((error) => error ? reject(error) : resolve()));
  });

  try {
    await waitForFrontend(frontendOrigin, child);
  } catch (error) {
    throw new Error(`${error.message}\n${childOutput}`);
  }

  const page = await fetch(frontendOrigin);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
  assert.match(page.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.doesNotMatch(page.headers.get("content-security-policy"), /fonts\.googleapis\.com/);
  assert.match(await page.text(), /ASH Chat/);

  const stylesheet = await fetch(`${frontendOrigin}/styles.css`);
  assert.equal(stylesheet.status, 200);
  assert.match(await stylesheet.text(), /@media \(max-width: 760px\)/);

  const health = await fetch(`${frontendOrigin}/api/v1/health`);
  assert.equal(health.status, 200);
  assert.equal(observedOrigin, backendOrigin);

  const login = await fetch(`${frontendOrigin}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      Origin: frontendOrigin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: "local@example.test", password: "do-not-log-this" }),
  });
  assert.equal(login.status, 200);
  assert.equal(observedOrigin, backendOrigin);

  const modelList = await fetch(`${frontendOrigin}/api/v1/models`, {
    headers: { Origin: frontendOrigin, Authorization: "Bearer mock-session-token" },
  });
  assert.equal(modelList.status, 200);
  assert.equal((await modelList.json()).models[0].locality, "local");

  const wrongOrigin = await fetch(`${frontendOrigin}/api/v1/auth/login`, {
    method: "POST",
    headers: { Origin: "http://attacker.example", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "attacker@example.test", password: "no" }),
  });
  assert.equal(wrongOrigin.status, 403);

  const stream = await fetch(`${frontendOrigin}/api/v1/chat/conversations/conversation-1/messages`, {
    method: "POST",
    headers: {
      Origin: frontendOrigin,
      Authorization: "Bearer mock-session-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: "Hello local model", providerId: "ollama", modelId: "model:latest" }),
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type"), /text\/event-stream/);
  const streamed = await stream.text();
  assert.match(streamed, /event: token\ndata: \{"text":"Hello"\}/);
  assert.match(streamed, /event: done/);
});
