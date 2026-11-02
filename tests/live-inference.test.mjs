import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { GeminiProvider } from "../src/providers/gemini.ts";
import { OpenAICompatibleProvider } from "../src/providers/openai-compatible.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OLLAMA = process.env.ASH_PLATFORM_OLLAMA_URL || "http://127.0.0.1:11434";

async function collect(stream) {
  let text = "";
  for await (const chunk of stream) text += chunk;
  return text;
}

test("live local Ollama text inference [real inference]", async (t) => {
  let tags;
  try {
    const response = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3_000) });
    tags = await response.json();
  } catch {
    t.skip("Ollama is not running on this PC.");
    return;
  }
  const model = (tags.models ?? []).find((item) =>
    item.name && !item.remote_host && (item.capabilities || []).includes("completion"),
  ) || (tags.models ?? []).find((item) => item.name && !item.remote_host && !String(item.name).includes("embed"));
  if (!model) {
    t.skip("No local Ollama chat model is installed.");
    return;
  }
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.name,
      stream: false,
      options: { num_predict: 16, temperature: 0 },
      messages: [{ role: "user", content: "Reply with the single word PONG." }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  assert.equal(response.ok, true);
  const data = await response.json();
  assert.match(String(data.message?.content || ""), /pong/i);
});

test("live Gemini catalog and streaming [real inference]", async (t) => {
  const config = loadConfig(projectRoot);
  if (!config.geminiApiKey) {
    t.skip("GEMINI_API_KEY is not configured.");
    return;
  }
  const provider = new GeminiProvider(config.geminiApiKey, config.geminiBaseUrl);
  const models = await provider.listModels();
  assert.ok(models.every((model) => model.pricing === "limited_free" || model.pricing === "free"));
  const model = models[0];
  if (!model) {
    t.skip("Gemini listed no eligible free-tier chat models.");
    return;
  }
  const text = await collect(provider.streamChat(model.id, [
    { role: "user", content: "Reply with the single word PONG." },
  ], AbortSignal.timeout(60_000), { maxOutputTokens: 16, temperature: 0 }));
  assert.match(text, /pong/i);
});

test("live Groq catalog and streaming [real inference]", async (t) => {
  const config = loadConfig(projectRoot);
  if (!config.groqApiKey) {
    t.skip("GROQ_API_KEY is not configured.");
    return;
  }
  const provider = new OpenAICompatibleProvider("groq", "Groq", config.groqApiKey, config.groqBaseUrl || "https://api.groq.com/openai/v1");
  const models = await provider.listModels();
  const model = models[0];
  if (!model) {
    t.skip("Groq listed no eligible free chat models.");
    return;
  }
  const text = await collect(provider.streamChat(model.id, [
    { role: "user", content: "Reply with the single word PONG." },
  ], AbortSignal.timeout(60_000), { maxOutputTokens: 16, temperature: 0 }));
  assert.match(text, /pong/i);
});

test("live OpenRouter catalog and streaming [real inference]", async (t) => {
  const config = loadConfig(projectRoot);
  if (!config.openrouterApiKey) {
    t.skip("OPENROUTER_API_KEY is not configured.");
    return;
  }
  const provider = new OpenAICompatibleProvider(
    "openrouter",
    "OpenRouter",
    config.openrouterApiKey,
    config.openrouterBaseUrl || "https://openrouter.ai/api/v1",
    config.publicOrigin || "http://127.0.0.1:3036",
  );
  const models = await provider.listModels();
  assert.ok(models.every((model) => model.pricing === "free" || model.pricing === "limited_free"));
  const model = models[0];
  if (!model) {
    t.skip("OpenRouter listed no verified zero-price models.");
    return;
  }
  const text = await collect(provider.streamChat(model.id, [
    { role: "user", content: "Reply with the single word PONG." },
  ], AbortSignal.timeout(60_000), { maxOutputTokens: 16, temperature: 0 }));
  assert.match(text, /pong/i);
});
