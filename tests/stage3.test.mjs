import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPlatformServer } from "../src/http/server.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

async function jsonRequest(baseUrl, route, { token, ...options } = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const data = await response.json();
  return { response, data };
}

test("projects, memory, search, rename, and account isolation [mock providers]", async (t) => {
  const tempRoot = mkdtempSync(path.join(projectRoot, ".test-tmp-"));
  const ollamaServer = createServer(async (request, response) => {
    if (request.url === "/api/tags") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ models: [{ name: "test-text:latest" }] }));
      return;
    }
    if (request.url === "/api/show") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ capabilities: ["completion"] }));
      return;
    }
    if (request.url === "/api/chat") {
      response.writeHead(200, { "Content-Type": "application/x-ndjson" });
      response.write(`${JSON.stringify({ message: { content: "ok" } })}\n`);
      response.end(`${JSON.stringify({ done: true })}\n`);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const ollamaUrl = await listen(ollamaServer);
  const app = createPlatformServer({
    rootDirectory: tempRoot,
    host: "127.0.0.1",
    port: 0,
    databasePath: path.join(tempRoot, "platform.sqlite"),
    filesDirectory: path.join(tempRoot, "files"),
    bootstrapKey: "stage3-bootstrap-key-please",
    sessionTtlSeconds: 3_600,
    ollamaBaseUrl: ollamaUrl,
  });
  const apiUrl = await listen(app.server);
  t.after(async () => {
    await close(app.server);
    await Promise.resolve(app.database.close());
    await close(ollamaServer);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const first = await jsonRequest(apiUrl, "/api/v1/auth/register", {
    method: "POST",
    body: { email: "one@example.test", password: "correct-horse-battery" },
  });
  const second = await jsonRequest(apiUrl, "/api/v1/auth/register", {
    method: "POST",
    body: { email: "two@example.test", password: "another-strong-password" },
  });
  const token = first.data.accessToken;
  const other = second.data.accessToken;

  const project = await jsonRequest(apiUrl, "/api/v1/projects", {
    method: "POST",
    token,
    body: { name: "Thesis", instructions: "Keep citations.", localOnly: true },
  });
  assert.equal(project.response.status, 201);
  const otherProject = await jsonRequest(apiUrl, `/api/v1/projects/${project.data.project.id}`, { token: other });
  assert.equal(otherProject.response.status, 404);

  const conversation = await jsonRequest(apiUrl, "/api/v1/chat/conversations", {
    method: "POST",
    token,
    body: { title: "Citation notes", projectId: project.data.project.id },
  });
  assert.equal(conversation.response.status, 201);

  const renamed = await jsonRequest(apiUrl, `/api/v1/chat/conversations/${conversation.data.conversation.id}`, {
    method: "PATCH",
    token,
    body: { title: "Updated notes" },
  });
  assert.equal(renamed.response.status, 200);

  const stream = await fetch(`${apiUrl}/api/v1/chat/conversations/${conversation.data.conversation.id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: "Remember that the thesis uses APA citations.", mode: "local_only" }),
  });
  assert.equal(stream.status, 200);
  const streamed = await stream.text();
  assert.match(streamed, /event: done/);

  const search = await jsonRequest(apiUrl, "/api/v1/chat/conversations?q=APA", { token });
  assert.equal(search.data.conversations[0].title, "Updated notes");

  const memory = await jsonRequest(apiUrl, "/api/v1/memories", {
    method: "POST",
    token,
    body: { scope: "project", projectId: project.data.project.id, content: "Use APA citations.", status: "approved" },
  });
  assert.equal(memory.response.status, 201);
  const stolen = await jsonRequest(apiUrl, `/api/v1/memories/${memory.data.memory.id}`, { method: "DELETE", token: other });
  assert.equal(stolen.response.status, 404);

  const exported = await jsonRequest(apiUrl, "/api/v1/account/export", { token });
  assert.equal(exported.response.status, 200);
  assert.equal(exported.data.export.projects[0].name, "Thesis");
});
