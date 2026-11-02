import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPlatformServer } from "../src/http/server.ts";
import { assistantSystemPrompt, capGeneration, classifyFinish, CONTINUE_INSTRUCTION, generationLimits, looksTruncated, normalizeResponseStyle } from "../src/chat/assistant-prompt.ts";
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
  assert.equal(normalizeResponseStyle("nope"), "normal");
  assert.equal(generationLimits("concise").maxOutputTokens, 700);
  assert.equal(generationLimits("detailed").maxOutputTokens, 4096);
  assert.equal(generationLimits("deep_analysis").maxOutputTokens, 8192);
  assert.equal(capGeneration(8192, { maxOutputTokens: 512, contextWindow: 2048 }, 20), 512);
  assert.equal(looksTruncated("complete sentence.", "stop"), false);
  assert.equal(looksTruncated("| Competitor | Acme", "length"), true);
  assert.deepEqual(classifyFinish("blocked fragment", "content_filter"), { filtered: true, truncated: false, complete: false });
  assert.deepEqual(classifyFinish("| Competitor | Acme", "length"), { filtered: false, truncated: true, complete: false });
  assert.deepEqual(classifyFinish("finished.", "stop"), { filtered: false, truncated: false, complete: true });
  const detailed = assistantSystemPrompt({ style: "detailed", deepReasoning: false });
  assert.match(detailed, /thorough/i);
  assert.match(detailed, /Markdown/);
  const reasoning = assistantSystemPrompt({ style: "normal", deepReasoning: true });
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
  const escaped = renderMarkdown("Heading\n\\---\nA \\<br> break\n\n> quoted");
  assert.match(escaped, /<hr>/);
  assert.doesNotMatch(escaped, /\\---|\\&lt;br&gt;|\\<br>/);
  assert.match(escaped, /<blockquote>/);
  const streamingTable = renderMarkdown("| Competitor | Strengths");
  assert.match(streamingTable, /<table>/);
  const math = renderMarkdown("Keep \\[x^2\\] and \\(y\\) intact.");
  assert.match(math, /\\\[x\^2\\\]/);
  assert.match(math, /\\\(y\\\)/);
  assert.match(renderMarkdown("Intro\n\\---\nOutro"), /<hr>/);
});

test("conversation context, regenerate, styles, fallback, and isolation [mock providers]", async (t) => {
  const tempRoot = mkdtempSync(path.join(projectRoot, ".test-tmp-"));
  const groqBodies = [];
  const geminiBodies = [];
  let geminiFails = true;
  let groqMode = "ok";

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
      const text = groqMode === "truncate" ? "| Competitor | Acme" : groqMode === "error" ? "PARTIAL" : groqMode === "filter" ? "blocked fragment" : "GROQ_OK";
      const finish = groqMode === "truncate" ? "length" : groqMode === "filter" ? "content_filter" : "stop";
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: groqMode === "error" ? null : finish }] })}\n\n`);
      if (groqMode === "error") {
        response.write(`data: ${JSON.stringify({ error: { message: "provider stream failed" } })}\n\n`);
      }
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
  assert.equal(groqBodies[0].max_tokens, 4096);

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
  const firstDone = firstEvents.find((event) => event.type === "done");
  assert.equal(firstDone.data.complete, true);

  groqMode = "truncate";
  const longChat = await jsonRequest(apiUrl, "/api/v1/chat/conversations", {
    method: "POST",
    token: ownerToken,
    body: { title: "Truncation" },
  });
  const longId = longChat.data.conversation.id;
  const truncated = await fetch(`${apiUrl}/api/v1/chat/conversations/${longId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ content: "Write a long competitor table.", mode: "auto", responseStyle: "detailed" }),
  });
  assert.equal(truncated.status, 200);
  const truncatedEvents = await readSse(truncated);
  const truncatedDone = truncatedEvents.find((event) => event.type === "done");
  assert.equal(truncatedDone.data.complete, false);
  assert.equal(truncatedDone.data.truncated, true);
  assert.equal(truncatedDone.data.finishReason, "length");
  const truncatedMessages = await jsonRequest(apiUrl, `/api/v1/chat/conversations/${longId}/messages`, { token: ownerToken });
  const truncatedAssistant = truncatedMessages.data.messages.find((message) => message.role === "assistant");
  assert.match(truncatedAssistant.content, /Competitor/);
  assert.equal(JSON.parse(truncatedAssistant.metadata).complete, false);
  const usersBeforeContinue = truncatedMessages.data.messages.filter((message) => message.role === "user").length;

  groqMode = "ok";
  const continued = await fetch(`${apiUrl}/api/v1/chat/conversations/${longId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ content: "Continue.", mode: "auto", continueFromMessageId: truncatedAssistant.id }),
  });
  assert.equal(continued.status, 200);
  await readSse(continued);
  const continueBody = groqBodies.at(-1);
  assert.match(JSON.stringify(continueBody.messages), /Competitor/);
  assert.match(JSON.stringify(continueBody.messages), new RegExp(CONTINUE_INSTRUCTION.slice(0, 40)));
  const afterContinue = await jsonRequest(apiUrl, `/api/v1/chat/conversations/${longId}/messages`, { token: ownerToken });
  assert.equal(afterContinue.data.messages.filter((message) => message.role === "user").length, usersBeforeContinue);
  assert.equal(afterContinue.data.messages.filter((message) => message.role === "assistant").length, 2);

  groqMode = "error";
  const failChat = await jsonRequest(apiUrl, "/api/v1/chat/conversations", {
    method: "POST",
    token: ownerToken,
    body: { title: "Partial error" },
  });
  const failId = failChat.data.conversation.id;
  const failed = await fetch(`${apiUrl}/api/v1/chat/conversations/${failId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ content: "Say something then fail.", mode: "auto" }),
  });
  const failedEvents = await readSse(failed);
  assert.ok(failedEvents.some((event) => event.type === "done" && event.data.complete === false));
  assert.ok(failedEvents.some((event) => event.type === "error"));
  const failedMessages = await jsonRequest(apiUrl, `/api/v1/chat/conversations/${failId}/messages`, { token: ownerToken });
  assert.match(failedMessages.data.messages.find((message) => message.role === "assistant").content, /PARTIAL/);

  groqMode = "filter";
  const filterChat = await jsonRequest(apiUrl, "/api/v1/chat/conversations", {
    method: "POST",
    token: ownerToken,
    body: { title: "Filtered" },
  });
  const filterId = filterChat.data.conversation.id;
  const filtered = await fetch(`${apiUrl}/api/v1/chat/conversations/${filterId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ content: "Ask something blocked.", mode: "auto" }),
  });
  const filteredEvents = await readSse(filtered);
  const filteredDone = filteredEvents.find((event) => event.type === "done");
  assert.equal(filteredDone.data.complete, false);
  assert.equal(filteredDone.data.truncated, false);
  assert.equal(filteredDone.data.filtered, true);
  assert.equal(filteredDone.data.finishReason, "content_filter");
  const filteredMessages = await jsonRequest(apiUrl, `/api/v1/chat/conversations/${filterId}/messages`, { token: ownerToken });
  const filteredMeta = JSON.parse(filteredMessages.data.messages.find((message) => message.role === "assistant").metadata);
  assert.equal(filteredMeta.filtered, true);
  assert.equal(filteredMeta.truncated, false);
  assert.equal(filteredMeta.complete, false);
});
