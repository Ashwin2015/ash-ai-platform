import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPlatformServer } from "../src/http/server.ts";
import { assistantSystemPrompt, generationLimits, normalizeResponseStyle } from "../src/chat/assistant-prompt.ts";
import { inferTaskFromText, scoreModelForTask } from "../src/providers/free-catalog.ts";
import { renderMarkdown } from "../apps/ash-chat/src/markdown.js";

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

async function readSse(response) {
  const text = await response.text();
  const events = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    let type = "message";
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) continue;
    events.push({ type, data: JSON.parse(data.join("\n")) });
  }
  return events;
}

test("response styles, reasoning prompt, and task scoring [unit]", () => {
  assert.equal(normalizeResponseStyle("detailed"), "detailed");
  assert.equal(normalizeResponseStyle("nope"), "balanced");
  assert.equal(generationLimits("concise").maxOutputTokens, 700);
  assert.equal(generationLimits("detailed").maxOutputTokens, 8192);
  const detailed = assistantSystemPrompt({ style: "detailed", deepReasoning: false });
  assert.match(detailed, /thorough/i);
  assert.match(detailed, /Markdown/);
  const reasoning = assistantSystemPrompt({ style: "balanced", deepReasoning: true });
  assert.match(reasoning, /Reasoning summary/);
  assert.doesNotMatch(reasoning, /hidden scratchpad is available/i);
  assert.equal(inferTaskFromText("Write a typescript function"), "coding");
  const reasoner = { id: "deepseek-r1", locality: "cloud", pricing: "limited_free", capabilities: { imageInput: false } };
  const chatty = { id: "llama-chat", locality: "cloud", pricing: "limited_free", capabilities: { imageInput: false } };
  assert.ok(scoreModelForTask(reasoner, "reasoning") > scoreModelForTask(chatty, "reasoning"));
});

test("markdown renderer supports tables and keeps HTML escaped", () => {
  const html = renderMarkdown([
    "| Col A | Col B |",
    "| --- | --- |",
    "| **one** | `two` |",
    "",
    "<img src=x>",
  ].join("\n"));
  assert.match(html, /<table><tbody><tr><th>Col A<\/th><th>Col B<\/th><\/tr>/);
  assert.match(html, /<td><strong>one<\/strong><\/td><td><code>two<\/code><\/td>/);
  assert.match(html, /&lt;img src=x&gt;/);
});

test("conversation context, regenerate, styles, fallback, and isolation [mock providers]", async (t) => {
  const tempRoot = mkdtempSync(path.join(projectRoot, ".test-tmp-"));
  const groqBodies = [];
  const geminiBodies = [];
  let geminiFails = true;

  const groq = createServer(async (request, response) => {
    if (request.url === "/models") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        data: [{ id: "llama-3.1-8b-instant", name: "Llama", active: true }],
      }));
      return;
    }
    if (request.url === "/chat/completions") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      groqBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "GROQ_OK" } }] })}\n\n`);
      response.end("data: [DONE]\n\n");
      return;
    }
    response.writeHead(404);
    response.end();
  });

  const gemini = createServer(async (request, response) => {
    if (request.url?.includes("streamGenerateContent")) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      geminiBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (geminiFails) {
        response.writeHead(429, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "quota" } }));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "GEMINI_OK" }] } }] })}\n\n`);
      response.end();
      return;
    }
    if (request.url?.startsWith("/models")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        models: [{
          name: "models/gemini-2.0-flash",
          displayName: "Gemini Flash",
          supportedGenerationMethods: ["generateContent"],
          inputTokenLimit: 1_000_000,
        }],
      }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  const groqUrl = await listen(groq);
  const geminiUrl = await listen(gemini);
  const app = createPlatformServer({
    rootDirectory: tempRoot,
    host: "127.0.0.1",
    port: 0,
    databasePath: path.join(tempRoot, "platform.sqlite"),
    filesDirectory: path.join(tempRoot, "files"),
    bootstrapKey: "",
    sessionTtlSeconds: 3_600,
    ollamaBaseUrl: "",
    geminiApiKey: "test-gemini",
    geminiBaseUrl: geminiUrl,
    groqApiKey: "test-groq",
    groqBaseUrl: groqUrl,
  });
  const apiUrl = await listen(app.server);
  t.after(async () => {
    await close(app.server);
    await Promise.resolve(app.database.close());
    await close(groq);
    await close(gemini);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const owner = await jsonRequest(apiUrl, "/api/v1/auth/register", {
    method: "POST",
    body: { email: "owner-intel@example.test", password: "owner-password-12" },
  });
  const other = await jsonRequest(apiUrl, "/api/v1/auth/register", {
    method: "POST",
    body: { email: "other-intel@example.test", password: "other-password-12" },
  });
  const ownerToken = owner.data.accessToken || owner.data.token;
  const otherToken = other.data.accessToken || other.data.token;

  const created = await jsonRequest(apiUrl, "/api/v1/chat/conversations", {
    method: "POST",
    token: ownerToken,
    body: { title: "Intel" },
  });
  const conversationId = created.data.conversation.id;

  const first = await fetch(`${apiUrl}/api/v1/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      content: "Remember the project name ASH-CHAT-CONTEXT.",
      mode: "auto",
      responseStyle: "detailed",
      deepReasoning: true,
    }),
  });
  assert.equal(first.status, 200);
  const firstEvents = await readSse(first);
  const modelEvent = firstEvents.find((event) => event.type === "model");
  assert.equal(modelEvent.data.providerId, "groq");
  assert.equal(modelEvent.data.modelId, "llama-3.1-8b-instant");
  assert.ok(firstEvents.some((event) => event.type === "token" && event.data.text === "GROQ_OK"));
  assert.ok(geminiBodies.length >= 1);
  assert.match(JSON.stringify(groqBodies[0].messages), /ASH Chat/);
  assert.match(JSON.stringify(groqBodies[0].messages), /thorough|Reasoning summary/);
  assert.equal(groqBodies[0].max_tokens, 8192);

  geminiFails = false;
  const follow = await fetch(`${apiUrl}/api/v1/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ content: "What project name should you remember?", mode: "auto", responseStyle: "concise" }),
  });
  assert.equal(follow.status, 200);
  await readSse(follow);
  const followBody = groqBodies.at(-1) || geminiBodies.at(-1);
  assert.match(JSON.stringify(followBody), /ASH-CHAT-CONTEXT/);
  assert.match(JSON.stringify(followBody), /Keep the reply short/);

  const listed = await jsonRequest(apiUrl, `/api/v1/chat/conversations/${conversationId}/messages`, { token: ownerToken });
  const assistant = [...listed.data.messages].reverse().find((message) => message.role === "assistant");
  assert.ok(assistant);
  const meta = JSON.parse(assistant.metadata);
  assert.equal(meta.providerId, "groq");
  assert.equal(meta.modelId, "llama-3.1-8b-instant");
  const userCountBefore = listed.data.messages.filter((message) => message.role === "user").length;

  const regen = await fetch(`${apiUrl}/api/v1/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      content: "",
      mode: "auto",
      regenerateFromMessageId: assistant.id,
    }),
  });
  assert.equal(regen.status, 200);
  await readSse(regen);
  const afterRegen = await jsonRequest(apiUrl, `/api/v1/chat/conversations/${conversationId}/messages`, { token: ownerToken });
  const userCountAfter = afterRegen.data.messages.filter((message) => message.role === "user").length;
  assert.equal(userCountAfter, userCountBefore);

  const isolated = await jsonRequest(apiUrl, `/api/v1/chat/conversations/${conversationId}/messages`, { token: otherToken });
  assert.equal(isolated.response.status, 404);

  const manual = await fetch(`${apiUrl}/api/v1/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      content: "Use the selected Gemini model.",
      mode: "manual",
      providerId: "gemini",
      modelId: "gemini-2.0-flash",
      responseStyle: "balanced",
    }),
  });
  assert.equal(manual.status, 200);
  const manualEvents = await readSse(manual);
  const manualModel = manualEvents.find((event) => event.type === "model");
  assert.equal(manualModel.data.providerId, "gemini");
  assert.equal(manualModel.data.modelId, "gemini-2.0-flash");
  assert.ok(manualEvents.some((event) => event.data?.text === "GEMINI_OK"));
});
