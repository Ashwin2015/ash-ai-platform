import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { createPlatformServer } from "../src/http/server.ts";
import { LIVE_QUALITY_PROMPTS } from "./live-quality-prompts.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function redactConfig(config) {
  return {
    gemini: config.geminiApiKey ? "set" : "empty",
    groq: config.groqApiKey ? "set" : "empty",
    openrouter: config.openrouterApiKey ? "set" : "empty",
    ollama: config.ollamaBaseUrl || "(default)",
  };
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

test("live quality evaluation against configured providers [real inference]", async (t) => {
  const config = loadConfig(projectRoot);
  const credentials = redactConfig(config);
  const ollamaReachable = await fetch(`${config.ollamaBaseUrl || "http://127.0.0.1:11434"}/api/tags`, {
    signal: AbortSignal.timeout(2_000),
  }).then((response) => response.ok).catch(() => false);
  const hasCloud = Boolean(config.geminiApiKey || config.groqApiKey || config.openrouterApiKey);
  if (!hasCloud && !ollamaReachable) {
    t.skip(`No live inference path: credentials=${JSON.stringify(credentials)}, ollama=${ollamaReachable}`);
    return;
  }

  const tempRoot = mkdtempSync(path.join(projectRoot, ".live-quality-"));
  const app = createPlatformServer({
    rootDirectory: tempRoot,
    host: "127.0.0.1",
    port: 0,
    databasePath: path.join(tempRoot, "platform.sqlite"),
    filesDirectory: path.join(tempRoot, "files"),
    bootstrapKey: "",
    sessionTtlSeconds: 3_600,
    ollamaBaseUrl: config.ollamaBaseUrl,
    geminiApiKey: config.geminiApiKey,
    geminiBaseUrl: config.geminiBaseUrl,
    groqApiKey: config.groqApiKey,
    groqBaseUrl: config.groqBaseUrl,
    openrouterApiKey: config.openrouterApiKey,
    openrouterBaseUrl: config.openrouterBaseUrl,
    publicOrigin: config.publicOrigin,
    inviteCode: config.inviteCode,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const apiUrl = `http://127.0.0.1:${app.server.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    await Promise.resolve(app.database.close());
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const register = await fetch(`${apiUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `live-quality-${Date.now()}@example.test`,
      password: "live-quality-pass12",
      ...(config.inviteCode ? { inviteCode: config.inviteCode } : {}),
    }),
  });
  assert.equal(register.ok, true);
  const { accessToken } = await register.json();
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  const created = await fetch(`${apiUrl}/api/v1/chat/conversations`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Live quality" }),
  });
  const conversationId = (await created.json()).conversation.id;

  const summary = [];
  for (const scenario of LIVE_QUALITY_PROMPTS) {
    if (scenario.skip || !scenario.prompt) {
      summary.push({ id: scenario.id, name: scenario.name, status: "skipped", reason: scenario.skip || scenario.note || "No prompt" });
      continue;
    }
    const started = Date.now();
    const send = async (content, extra = {}) => {
      const response = await fetch(`${apiUrl}/api/v1/chat/conversations/${conversationId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          content,
          mode: "auto",
          workingMode: scenario.workingMode || "auto",
          responseStyle: scenario.responseStyle || "normal",
          deepReasoning: scenario.deepReasoning === true,
          webSearch: scenario.webSearch === true,
          ...extra,
        }),
        signal: AbortSignal.timeout(300_000),
      });
      assert.equal(response.ok, true, `Scenario ${scenario.id} HTTP ${response.status}`);
      return readSse(response);
    };
    const first = await send(scenario.prompt);
  if (scenario.followUp) await send(scenario.followUp);
    const latencyMs = Date.now() - started;
    const model = first.find((event) => event.type === "model")?.data;
    const done = first.find((event) => event.type === "done")?.data;
    const research = first.find((event) => event.type === "research")?.data?.sources || [];
    const text = first.filter((event) => event.type === "token").map((event) => event.data.text).join("");
    summary.push({
      id: scenario.id,
      name: scenario.name,
      status: "passed",
      latencyMs,
      providerId: model?.providerId,
      modelId: model?.modelId,
      pricing: model?.pricing,
      complete: done?.complete,
      truncated: done?.truncated,
      finishReason: done?.finishReason,
      researchSourceCount: research.length,
      preview: text.slice(0, 220),
      humanReview: "Review accuracy, citations, instruction following and usefulness manually.",
    });
  }
  console.log(JSON.stringify({ credentials, summary }, null, 2));
});
