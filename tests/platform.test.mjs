import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { createPlatformServer } from "../src/http/server.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
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
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, data };
}

test("configuration refuses network binding and non-loopback Ollama URLs", () => {
  const names = [
    "ASH_PLATFORM_HOST",
    "ASH_PLATFORM_PORT",
    "ASH_PLATFORM_DATABASE",
    "ASH_PLATFORM_BOOTSTRAP_KEY",
    "ASH_PLATFORM_SESSION_HOURS",
    "ASH_PLATFORM_OLLAMA_URL",
    "ASH_PLATFORM_PUBLIC_ORIGIN",
    "ASH_CHAT_PUBLIC_ORIGIN",
    "DATABASE_URL",
    "ASH_PLATFORM_DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "PORT",
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    const config = loadConfig(projectRoot);
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.port, 3035);
    assert.ok(config.databasePath.startsWith(projectRoot));

    process.env.ASH_PLATFORM_HOST = "0.0.0.0";
    assert.throws(() => loadConfig(projectRoot), /https:\/\/ URL|loopback/);
    process.env.ASH_PLATFORM_PUBLIC_ORIGIN = "https://example.onrender.com";
    assert.throws(() => loadConfig(projectRoot), /DATABASE_URL/);
    process.env.DATABASE_URL = "postgresql://user:unused@127.0.0.1:5432/postgres";
    assert.throws(() => loadConfig(projectRoot), /SUPABASE_URL/);
    process.env.ASH_PLATFORM_HOST = "127.0.0.1";
    delete process.env.ASH_PLATFORM_PUBLIC_ORIGIN;
    delete process.env.DATABASE_URL;
    process.env.ASH_PLATFORM_OLLAMA_URL = "http://192.168.1.10:11434";
    assert.throws(() => loadConfig(projectRoot), /Ollama must use an HTTP loopback URL/);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("versioned API authenticates users, streams Ollama chat, and isolates conversation data", async (t) => {
  const tempRoot = mkdtempSync(path.join(projectRoot, ".test-tmp-"));
  const ollamaRequests = [];
  const ollamaServer = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/api/tags") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        models: [
          { name: "test-text:latest" },
          { name: "test-vision:latest" },
          { name: "remote:cloud", remote_host: "https://example.invalid" },
        ],
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/show") {
      const body = await readRequestJson(request);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        capabilities: body.name.startsWith("test-vision") ? ["completion", "vision"] : ["completion"],
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/chat") {
      const body = await readRequestJson(request);
      ollamaRequests.push(body);
      response.writeHead(200, { "Content-Type": "application/x-ndjson" });
      response.write(`${JSON.stringify({ message: { content: "Hello" } })}\n`);
      response.write(`${JSON.stringify({ message: { content: " from local Ollama." } })}\n`);
      response.end(`${JSON.stringify({ message: { content: "" }, done: true })}\n`);
      return;
    }
    response.writeHead(404);
    response.end();
  });

  const ollamaUrl = await listen(ollamaServer);
  const config = {
    rootDirectory: tempRoot,
    host: "127.0.0.1",
    port: 0,
    databasePath: path.join(tempRoot, "platform.sqlite"),
    bootstrapKey: "test-bootstrap-key-keep-private",
    inviteCode: "private-invite-code-xyz",
    sessionTtlSeconds: 3_600,
    ollamaBaseUrl: ollamaUrl,
  };
  const app = createPlatformServer(config);
  const apiUrl = await listen(app.server);

  t.after(async () => {
    await close(app.server);
    await Promise.resolve(app.database.close());
    await close(ollamaServer);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const health = await jsonRequest(apiUrl, "/api/v1/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.data.providers.ollama.available, true);
  assert.equal(health.data.providers.ollama.modelCount, 2);

  const unauthenticated = await jsonRequest(apiUrl, "/api/v1/models");
  assert.equal(unauthenticated.response.status, 401);

  const hostileOrigin = await jsonRequest(apiUrl, "/api/v1/auth/login", {
    method: "POST",
    headers: { Origin: "http://attacker.example" },
    body: { email: "nobody@example.test", password: "not-a-real-password" },
  });
  assert.equal(hostileOrigin.response.status, 403);

  const extraFieldRejected = await jsonRequest(apiUrl, "/api/v1/auth/register", {
    method: "POST",
    body: { inviteCode: "ignored", email: "one@example.test", password: "correct-horse-battery" },
  });
  assert.equal(extraFieldRejected.response.status, 400);

  const first = await jsonRequest(apiUrl, "/api/v1/auth/register", {
    method: "POST",
    body: {
      email: "One@Example.test",
      password: "correct-horse-battery",
    },
  });
  assert.equal(first.response.status, 201);
  assert.equal(first.data.user.email, "one@example.test");
  assert.equal(first.data.user.isOwner, true);
  assert.equal(typeof first.data.accessToken, "string");

  const second = await jsonRequest(apiUrl, "/api/v1/auth/register", {
    method: "POST",
    body: {
      email: "two@example.test",
      password: "another-strong-password",
    },
  });
  assert.equal(second.response.status, 201);
  assert.equal(second.data.user.isOwner, false);

  const third = await jsonRequest(apiUrl, "/api/v1/auth/register", {
    method: "POST",
    body: {
      email: "three@example.test",
      password: "invite-access-password",
    },
  });
  assert.equal(third.response.status, 201);
  assert.equal(third.data.user.isOwner, false);
  const me = await jsonRequest(apiUrl, "/api/v1/auth/me", { token: third.data.accessToken });
  assert.equal(me.response.status, 200);
  assert.equal(me.data.user.email, "three@example.test");
  assert.equal(me.data.user.isOwner, false);

  const duplicate = await jsonRequest(apiUrl, "/api/v1/auth/register", {
    method: "POST",
    body: { email: "one@example.test", password: "correct-horse-battery" },
  });
  assert.equal(duplicate.response.status, 409);

  const invalidLogin = await jsonRequest(apiUrl, "/api/v1/auth/login", {
    method: "POST",
    body: { email: "one@example.test", password: "wrong-password-here" },
  });
  assert.equal(invalidLogin.response.status, 401);

  const cookieParts = (first.response.headers.getSetCookie?.() || []).map((item) => item.split(";")[0]);
  const cookieHeader = cookieParts.join("; ");
  assert.match(cookieHeader, /ash_session=/);
  const cookieMe = await fetch(`${apiUrl}/api/v1/auth/me`, { headers: { Cookie: cookieHeader } });
  assert.equal(cookieMe.status, 200);
  assert.equal((await cookieMe.json()).user.email, "one@example.test");

  const modelList = await jsonRequest(apiUrl, "/api/v1/models", { token: first.data.accessToken });
  assert.equal(modelList.response.status, 200);
  assert.deepEqual(modelList.data.models.map((model) => model.id), ["test-text:latest", "test-vision:latest"]);
  assert.equal(modelList.data.models[0].pricing, "free");
  const visionModel = modelList.data.models.find((model) => model.id === "test-vision:latest");
  assert.equal(visionModel.capabilities.imageInput, true);
  assert.equal(visionModel.nativeCapabilities.imageInput, true);

  const create = await jsonRequest(apiUrl, "/api/v1/chat/conversations", {
    method: "POST",
    token: first.data.accessToken,
    body: { title: "Local test chat" },
  });
  assert.equal(create.response.status, 201);
  const conversationId = create.data.conversation.id;

  const rejectedAttachment = await jsonRequest(apiUrl, `/api/v1/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    token: first.data.accessToken,
    body: { content: "Hi", providerId: "ollama", modelId: "test-text:latest", images: [] },
  });
  assert.equal(rejectedAttachment.response.status, 400);
  assert.match(rejectedAttachment.data.error.message, /Unsupported request field: images/);

  const streamResponse = await fetch(`${apiUrl}/api/v1/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${first.data.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: "Hi" }),
  });
  assert.equal(streamResponse.status, 200);
  const eventStream = await streamResponse.text();
  assert.match(eventStream, /event: model\ndata: \{"providerId":"ollama","modelId":"test-text:latest"/);
  assert.match(eventStream, /event: token\ndata: \{"text":"Hello"\}/);
  assert.match(eventStream, /event: done/);
  assert.equal(ollamaRequests.length, 1);
  assert.equal(ollamaRequests[0].messages.at(-1).content, "Hi");

  const ownMessages = await jsonRequest(apiUrl, `/api/v1/chat/conversations/${conversationId}/messages`, {
    token: first.data.accessToken,
  });
  assert.equal(ownMessages.response.status, 200);
  assert.deepEqual(ownMessages.data.messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(ownMessages.data.messages[1].content, "Hello from local Ollama.");

  const otherUsersMessages = await jsonRequest(apiUrl, `/api/v1/chat/conversations/${conversationId}/messages`, {
    token: second.data.accessToken,
  });
  assert.equal(otherUsersMessages.response.status, 404);
  const otherUsersList = await jsonRequest(apiUrl, "/api/v1/chat/conversations", {
    token: second.data.accessToken,
  });
  assert.deepEqual(otherUsersList.data.conversations, []);

  const logout = await jsonRequest(apiUrl, "/api/v1/auth/logout", {
    method: "POST",
    token: first.data.accessToken,
    body: {},
  });
  assert.equal(logout.response.status, 200);
  const revokedToken = await jsonRequest(apiUrl, "/api/v1/models", { token: first.data.accessToken });
  assert.equal(revokedToken.response.status, 401);

  const loginAgain = await jsonRequest(apiUrl, "/api/v1/auth/login", {
    method: "POST",
    body: { email: "one@example.test", password: "correct-horse-battery" },
  });
  assert.equal(loginAgain.response.status, 200);
  assert.equal(loginAgain.data.user.isOwner, true);
  const afterLogin = await jsonRequest(apiUrl, "/api/v1/auth/me", { token: loginAgain.data.accessToken });
  assert.equal(afterLogin.response.status, 200);
  assert.equal(afterLogin.data.user.email, "one@example.test");
});

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
