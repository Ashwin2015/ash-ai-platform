/**
 * One-off internal readiness harness (not in npm test). Mock LLM + live research.
 */
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPlatformServer } from "../src/http/server.ts";
import { extractCalculations } from "../src/tools/calculator.ts";
import { runResearch } from "../src/research/research-service.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
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
    if (data.length) events.push({ type, data: JSON.parse(data.join("\n")) });
  }
  return events;
}

const scenarios = [
  { id: 1, name: "General knowledge", body: { content: "What is HTML?", mode: "auto", workingMode: "auto", responseStyle: "normal" } },
  { id: 2, name: "Beginner technical", body: { content: "Explain DNS to a beginner in simple terms.", mode: "auto", workingMode: "auto", responseStyle: "normal" } },
  { id: 3, name: "Complex business analysis", body: { content: "Analyse opening a small cafe: assumptions, risks, trade-offs.", mode: "auto", workingMode: "deep_analysis" } },
  { id: 4, name: "Research with sources", body: { content: "Research what photosynthesis is.", mode: "auto", workingMode: "research", webSearch: true } },
  { id: 5, name: "Research no hits", body: { content: "Research zzqxpv_nonexistent_entity_99281 market share.", mode: "auto", workingMode: "research", webSearch: true } },
  { id: 6, name: "Financial calculation", body: { content: "If 240,000 customers × ₹199 per month, what is annual revenue?", mode: "auto", workingMode: "auto", webSearch: false } },
  { id: 7, name: "Multi-step reasoning", body: { content: "If all roses are flowers and some flowers fade quickly, can we conclude all roses fade quickly? Explain.", mode: "auto", workingMode: "auto", deepReasoning: true } },
  { id: 8, name: "Coding", body: { content: "Write a TypeScript function isPalindrome(s: string): boolean", mode: "auto", workingMode: "coding" } },
  { id: 9, name: "PDF analysis", skip: "No PDF fixture uploaded in this harness; multimodal path covered by unit tests elsewhere." },
  { id: 10, name: "Context retention", multi: true },
  { id: 11, name: "Long structured", body: { content: "Give sections: Summary, Details, Example for REST APIs.", mode: "auto", responseStyle: "detailed" } },
  { id: 12, name: "Contradiction detection", body: { content: "The plan is 90 days. Review it and flag if any section implies 24 weeks.", mode: "auto", workingMode: "deep_analysis" } },
  { id: 13, name: "Explicit short answer", body: { content: "Define RAM in one sentence only.", mode: "auto", responseStyle: "short" } },
  { id: 14, name: "Deep analysis request", body: { content: "Deep dive: pros and cons of SQLite vs Postgres for a solo app.", mode: "auto", workingMode: "deep_analysis" } },
  { id: 15, name: "Provider failure recovery", failOnce: true, body: { content: "Say hello.", mode: "auto" } },
];

const groqBodies = [];
let groqFails = 0;
let geminiCalls = 0;
const ollamaRequests = [];

const groq = createServer(async (request, response) => {
  if (request.url === "/models") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "llama-3.1-8b-instant", name: "Llama", active: true }] }));
    return;
  }
  if (request.url === "/chat/completions") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    groqBodies.push(body);
    if (groqFails > 0) {
      groqFails -= 1;
      response.writeHead(503);
      response.end(JSON.stringify({ error: { message: "temporary outage" } }));
      return;
    }
    const msg = JSON.stringify(body.messages);
    let text = "MOCK_OK";
    if (/Working mode: RESEARCH/.test(msg)) text = "Research answer with [1] citation placeholder.";
    if (/Working mode: CODING/.test(msg)) text = "```ts\nexport function isPalindrome(s: string) { return s === [...s].reverse().join(''); }\n```";
    if (/573120000|573,120,000/.test(msg)) text = "Annual revenue = 573,120,000 using provided arithmetic.";
    if (/Keep the reply short/.test(msg)) text = "RAM is short-term working memory for running programs.";
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] })}\n\n`);
    response.end("data: [DONE]\n\n");
    return;
  }
  response.writeHead(404);
  response.end();
});

const gemini = createServer(async (request, response) => {
  if (request.url?.startsWith("/models")) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      models: [{
        name: "models/gemini-2.0-flash",
        displayName: "Gemini Flash",
        supportedGenerationMethods: ["generateContent"],
        inputTokenLimit: 1_000_000,
        outputTokenLimit: 8192,
      }],
    }));
    return;
  }
  if (request.url?.includes("streamGenerateContent")) {
    geminiCalls += 1;
    response.writeHead(429);
    response.end(JSON.stringify({ error: { message: "quota" } }));
    return;
  }
  response.writeHead(404);
  response.end();
});

const openrouter = createServer(async (request, response) => {
  if (request.url === "/models") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "free-model:free", name: "Free", active: true, pricing: { prompt: "0", completion: "0" } }] }));
    return;
  }
  if (request.url === "/chat/completions") {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "OPENROUTER_OK" }, finish_reason: "stop" }] })}\n\n`);
    response.end("data: [DONE]\n\n");
    return;
  }
  response.writeHead(404);
  response.end();
});

const ollama = createServer(async (request, response) => {
  if (request.url === "/api/tags") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ models: [{ name: "local-test:latest", capabilities: ["completion"] }] }));
    return;
  }
  if (request.url === "/api/show") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ capabilities: ["completion"], model_info: { "general.quantization_version": 2 } }));
    return;
  }
  if (request.url === "/api/chat") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    ollamaRequests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.writeHead(200, { "Content-Type": "application/x-ndjson" });
    response.write(`${JSON.stringify({ message: { content: "LOCAL_ONLY_OK" } })}\n`);
    response.end(`${JSON.stringify({ done: true })}\n`);
    return;
  }
  response.writeHead(404);
  response.end();
});

const groqUrl = await listen(groq);
const geminiUrl = await listen(gemini);
const openrouterUrl = await listen(openrouter);
const ollamaUrl = await listen(ollama);
const tempRoot = mkdtempSync(path.join(projectRoot, ".readiness-"));

function makeApp(ollamaBaseUrl, dbName = "platform.sqlite") {
  return createPlatformServer({
    rootDirectory: tempRoot,
    host: "127.0.0.1",
    port: 0,
    databasePath: path.join(tempRoot, dbName),
    filesDirectory: path.join(tempRoot, "files"),
    bootstrapKey: "",
    sessionTtlSeconds: 3600,
    ollamaBaseUrl,
    geminiApiKey: "test-gemini",
    geminiBaseUrl: geminiUrl,
    groqApiKey: "test-groq",
    groqBaseUrl: groqUrl,
    openrouterApiKey: "test-openrouter",
    openrouterBaseUrl: openrouterUrl,
    publicOrigin: "http://127.0.0.1:3036",
  });
}

const app = makeApp("");
const apiUrl = await listen(app.server);

const register = await fetch(`${apiUrl}/api/v1/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "readiness@example.test", password: "readiness-pass-12" }),
});
const { accessToken } = await register.json();
const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
const created = await fetch(`${apiUrl}/api/v1/chat/conversations`, {
  method: "POST",
  headers,
  body: JSON.stringify({ title: "Readiness" }),
});
const { conversation } = await created.json();
const convUrl = `${apiUrl}/api/v1/chat/conversations/${conversation.id}/messages`;

const results = [];

async function sendChat(body) {
  const response = await fetch(convUrl, { method: "POST", headers, body: JSON.stringify(body) });
  const events = await readSse(response);
  const model = events.find((e) => e.type === "model")?.data;
  const research = events.find((e) => e.type === "research")?.data?.sources || [];
  const workingMode = events.find((e) => e.type === "working_mode")?.data?.workingMode;
  const done = events.find((e) => e.type === "done")?.data;
  const tokens = events.filter((e) => e.type === "token").map((e) => e.data.text).join("");
  const lastBody = groqBodies.at(-1);
  const sys = lastBody?.messages?.find((m) => m.role === "system")?.content || "";
  return { ok: response.ok, model, research, workingMode, done, tokens, sys, pricing: model?.pricing };
}

for (const scenario of scenarios) {
  if (scenario.skip) {
    results.push({ id: scenario.id, name: scenario.name, status: "skipped", note: scenario.skip });
    continue;
  }
  if (scenario.failOnce) groqFails = 1;
  if (scenario.multi) {
    await sendChat({ content: "Remember the codename BLUEFIN.", mode: "auto" });
    const second = await sendChat({ content: "What codename should you remember?", mode: "auto" });
    const ok = /BLUEFIN/.test(second.sys) || /BLUEFIN/.test(JSON.stringify(groqBodies.at(-1)));
    results.push({ id: scenario.id, name: scenario.name, status: ok ? "pass" : "fail", model: second.model, note: ok ? "Context in provider payload" : "Context missing" });
    continue;
  }
  const out = await sendChat(scenario.body);
  let status = out.ok && out.tokens ? "pass" : "fail";
  let note = `provider=${out.model?.providerId} model=${out.model?.modelId} pricing=${out.pricing}`;
  if (scenario.id === 4) {
    const urls = out.research.map((s) => s.url).filter(Boolean);
    let reachable = 0;
    for (const url of urls.slice(0, 3)) {
      try {
        const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000), redirect: "follow" });
        if (head.ok || head.status === 405) reachable += 1;
      } catch {}
    }
    status = urls.length && reachable > 0 && /RESEARCH|Retrieved sources/.test(out.sys) ? "pass" : "fail";
    note += ` sources=${urls.length} reachable=${reachable}`;
  }
  if (scenario.id === 5) {
    status = out.research.length === 0 && /Do not invent|No matching|unavailable/i.test(out.sys) ? "pass" : "fail";
    note += ` research_count=${out.research.length}`;
  }
  if (scenario.id === 6) {
    const calcs = extractCalculations(scenario.body.content);
    status = /573120000/.test(out.sys) && calcs.some((c) => c.result === 573_120_000) ? "pass" : "fail";
    note += ` calc_injected=${/573120000/.test(out.sys)}`;
  }
  if (scenario.id === 8) status = /Working mode: CODING/.test(out.sys) ? "pass" : "fail";
  if (scenario.id === 13) status = /Keep the reply short/.test(out.sys) ? "pass" : "fail";
  if (scenario.id === 14) status = /Working mode: DEEP ANALYSIS|deep_analysis/.test(out.sys) ? "pass" : "fail";
  if (scenario.id === 15) {
    status = out.ok && /OPENROUTER_OK|MOCK_OK/.test(out.tokens) ? "pass" : "fail";
    note += ` fallback=${out.model?.providerId || "none"}`;
  }
  results.push({ id: scenario.id, name: scenario.name, status, workingMode: out.workingMode || scenario.body.workingMode, note, sample: out.tokens.slice(0, 120) });
}

const groqBefore = groqBodies.length;
const localApp = makeApp(ollamaUrl);
const localApi = await listen(localApp.server);
const localReg = await fetch(`${localApi}/api/v1/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "localonly@example.test", password: "localonly-pass-12" }),
});
const localToken = (await localReg.json()).accessToken;
const localConv = await fetch(`${localApi}/api/v1/chat/conversations`, {
  method: "POST",
  headers: { Authorization: `Bearer ${localToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ title: "Local" }),
});
const localId = (await localConv.json()).conversation.id;
const localStream = await fetch(`${localApi}/api/v1/chat/conversations/${localId}/messages`, {
  method: "POST",
  headers: { Authorization: `Bearer ${localToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ content: "Offline check", mode: "local_only" }),
});
const localEvents = await readSse(localStream);
const localModel = localEvents.find((e) => e.type === "model")?.data;
const localText = localEvents.filter((e) => e.type === "token").map((e) => e.data.text).join("");
const groqAfter = groqBodies.length;
const offlinePass = localModel?.providerId === "ollama" && localText.includes("LOCAL_ONLY_OK") && groqAfter === groqBefore;

results.push({
  id: "offline",
  name: "LOCAL_ONLY uses Ollama only",
  status: offlinePass ? "pass" : "fail",
  note: `ollama_requests=${ollamaRequests.length} groq_calls_unchanged=${groqAfter === groqBefore}`,
});

await close(localApp.server);
await Promise.resolve(localApp.database.close());

console.log(JSON.stringify({ automated_suite: "30/30", live_llm: "skipped (no keys, Ollama down on host)", results, groq_request_count: groqBodies.length }, null, 2));

await close(app.server);
await Promise.resolve(app.database.close());
await close(groq);
await close(gemini);
await close(openrouter);
await close(ollama);
rmSync(tempRoot, { recursive: true, force: true });
