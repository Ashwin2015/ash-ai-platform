import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPlatformServer } from "../src/http/server.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const png = readFileSync(path.join(projectRoot, "apps", "ash-chat", "icon-192.png"));

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
  const data = await response.json().catch(() => null);
  return { response, data };
}

test("uploads stay with the owner and a failed reply can be retried without a duplicate user message", async (t) => {
  const previousOcr = process.env.ASH_PLATFORM_OCR;
  process.env.ASH_PLATFORM_OCR = "0";
  const tempRoot = mkdtempSync(path.join(projectRoot, ".test-tmp-"));
  let chatCalls = 0;
  const ollama = createServer(async (request, response) => {
    if (request.url === "/api/tags") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ models: [{ name: "test-text:latest" }] }));
      return;
    }
    if (request.url === "/api/show") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ capabilities: ["completion", "vision"] }));
      return;
    }
    if (request.url === "/api/chat") {
      chatCalls += 1;
      if (chatCalls === 1) {
        response.writeHead(500, { "Content-Type": "text/plain" });
        response.end("unavailable");
        return;
      }
      response.writeHead(200, { "Content-Type": "application/x-ndjson" });
      response.write(`${JSON.stringify({ message: { content: "seen" } })}\n`);
      response.end(`${JSON.stringify({ done: true })}\n`);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const ollamaUrl = await listen(ollama);
  const app = createPlatformServer({
    rootDirectory: tempRoot,
    host: "127.0.0.1",
    port: 0,
    databasePath: path.join(tempRoot, "platform.sqlite"),
    filesDirectory: path.join(tempRoot, "files"),
    bootstrapKey: "",
    sessionTtlSeconds: 3_600,
    ollamaBaseUrl: ollamaUrl,
  });
  const apiUrl = await listen(app.server);
  t.after(async () => {
    if (previousOcr === undefined) delete process.env.ASH_PLATFORM_OCR;
    else process.env.ASH_PLATFORM_OCR = previousOcr;
    await close(app.server);
    await Promise.resolve(app.database.close());
    await close(ollama);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const owner = await jsonRequest(apiUrl, "/api/v1/auth/register", {
    method: "POST",
    body: { email: "owner-upload@example.test", password: "owner-password-12" },
  });
  const other = await jsonRequest(apiUrl, "/api/v1/auth/register", {
    method: "POST",
    body: { email: "other-upload@example.test", password: "other-password-12" },
  });
  const ownerToken = owner.data.accessToken || owner.data.token;
  const otherToken = other.data.accessToken || other.data.token;
  const created = await jsonRequest(apiUrl, "/api/v1/chat/conversations", {
    method: "POST",
    token: ownerToken,
    body: { title: "Upload" },
  });
  const conversationId = created.data.conversation.id;
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "note.png");
  form.append("conversationId", conversationId);
  const uploaded = await fetch(`${apiUrl}/api/v1/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: form,
  });
  const uploadBody = await uploaded.json();
  assert.equal(uploaded.status, 201);
  assert.equal(uploadBody.attachment.fileName, "note.png");
  assert.equal(uploadBody.attachment.kind, "image");
  const attachmentId = uploadBody.attachment.id;

  const stolen = await fetch(`${apiUrl}/api/v1/attachments/${attachmentId}/file`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  assert.equal(stolen.status, 404);
  const ownFile = await fetch(`${apiUrl}/api/v1/attachments/${attachmentId}/file`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(ownFile.status, 200);
  assert.equal(ownFile.headers.get("content-type"), "image/png");

  const otherConversation = await jsonRequest(apiUrl, `/api/v1/chat/conversations/${conversationId}/messages`, {
    token: otherToken,
  });
  assert.equal(otherConversation.response.status, 404);

  const rejected = new FormData();
  rejected.append("file", new Blob(["hello"], { type: "text/plain" }), "notes.txt");
  const badUpload = await fetch(`${apiUrl}/api/v1/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: rejected,
  });
  assert.equal(badUpload.status, 400);

  const models = await jsonRequest(apiUrl, "/api/v1/models", { token: ownerToken });
  const model = models.data.models.find((item) => item.providerId === "ollama");
  assert.ok(model);
  const send = (content) => fetch(`${apiUrl}/api/v1/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      content,
      mode: "manual",
      providerId: model.providerId,
      modelId: model.id,
      attachmentIds: [attachmentId],
    }),
  });
  const first = await send("Please look at the attached note.");
  assert.equal(first.status, 200);
  await first.text();
  const second = await send("Please look at the attached note.");
  assert.equal(second.status, 200);
  await second.text();
  const messages = await jsonRequest(apiUrl, `/api/v1/chat/conversations/${conversationId}/messages`, { token: ownerToken });
  const users = messages.data.messages.filter((item) => item.role === "user");
  assert.equal(users.length, 1);
  assert.equal(users[0].content, "Please look at the attached note.");
  assert.equal(messages.data.messages.some((item) => item.role === "assistant"), true);
});
