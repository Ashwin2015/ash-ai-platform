import assert from "node:assert/strict";
import test from "node:test";
import { PlatformError } from "../src/errors.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";
import { ChatRuntime } from "../src/runtime/chat-runtime.ts";

function model(providerId, id, opts = {}) {
  return {
    providerId,
    id,
    displayName: id,
    locality: opts.locality ?? "cloud",
    pricing: opts.pricing ?? "limited_free",
    capabilities: {
      textInput: true,
      textOutput: true,
      imageInput: false,
      pdfDirectInput: false,
      pdfTextPreprocessing: false,
      streaming: true,
      toolCalling: false,
    },
  };
}

function provider(id, models, stream) {
  return {
    id,
    displayName: id,
    listModels: async () => models,
    streamChat: (modelId, messages, signal, options) => stream(modelId, messages, signal, options),
  };
}

function runtimeFor(...providers) {
  const registry = new ProviderRegistry();
  for (const item of providers) registry.register(item);
  return new ChatRuntime(registry);
}

test("Groq HTTP 503 before stream falls back to Gemini", async () => {
  const groq = provider("groq", [model("groq", "llama", { pricing: "limited_free" })], async function* () {
    throw new PlatformError("provider_unavailable", "Groq returned HTTP 503.", 503);
  });
  let geminiCalled = 0;
  const gemini = provider("gemini", [model("gemini", "flash", { pricing: "limited_free" })], async function* () {
    geminiCalled += 1;
    yield "from gemini";
  });
  const result = await runtimeFor(groq, gemini).prepare("auto", "", "", [{ role: "user", content: "Hi" }]);
  assert.equal(result.model.providerId, "gemini");
  assert.deepEqual(await Array.fromAsync(result.stream), ["from gemini"]);
  assert.equal(geminiCalled, 1);
});

test("Groq 429 falls back to another eligible free provider", async () => {
  const groq = provider("groq", [model("groq", "llama")], async function* () {
    throw new PlatformError("rate_limited", "Groq rate limit or free-tier quota was reached.", 429);
  });
  let openrouterCalled = 0;
  const openrouter = provider("openrouter", [model("openrouter", "free-model", { pricing: "free" })], async function* () {
    openrouterCalled += 1;
    yield "openrouter ok";
  });
  const result = await runtimeFor(groq, openrouter).prepare("auto", "", "", [{ role: "user", content: "Hi" }]);
  assert.equal(result.model.providerId, "openrouter");
  assert.equal(openrouterCalled, 1);
});

test("network timeout on first provider falls back to the next", async () => {
  const first = provider("groq", [model("groq", "a")], async function* () {
    throw new PlatformError("provider_unavailable", "Groq is unavailable.", 503);
  });
  const second = provider("gemini", [model("gemini", "flash")], async function* () {
    yield "recovered";
  });
  const result = await runtimeFor(first, second).prepare("auto", "", "", [{ role: "user", content: "Hi" }]);
  assert.deepEqual(await Array.fromAsync(result.stream), ["recovered"]);
});

test("all providers unavailable returns a clear error", async () => {
  const groq = provider("groq", [model("groq", "llama")], async function* () {
    throw new PlatformError("provider_unavailable", "Groq returned HTTP 503.", 503);
  });
  const gemini = provider("gemini", [model("gemini", "flash")], async function* () {
    throw new PlatformError("rate_limited", "Gemini rate limit or free-tier quota was reached.", 429);
  });
  await assert.rejects(
    runtimeFor(groq, gemini).prepare("auto", "", "", [{ role: "user", content: "Hi" }]),
    (error) => error instanceof PlatformError &&
      /No eligible free model could complete this request/.test(error.message) &&
      /groq\/llama/.test(error.message) &&
      /gemini\/flash/.test(error.message) &&
      /Last error:/.test(error.message),
  );
});

test("no eligible free providers rejects paid models in AUTO", async () => {
  const paid = provider("cloud", [model("cloud", "pro", { pricing: "paid" })], async function* () { yield "paid"; });
  await assert.rejects(
    runtimeFor(paid).prepare("auto", "", "", [{ role: "user", content: "Hi" }]),
    (error) => error instanceof PlatformError && error.code === "model_unavailable",
  );
});

test("manual selection is preserved even when AUTO would choose another provider", async () => {
  const calls = [];
  const gemini = provider("gemini", [model("gemini", "flash")], async function* (id) {
    calls.push(id);
    yield "manual gemini";
  });
  const groq = provider("groq", [model("groq", "llama")], async function* () { yield "never"; });
  const result = await runtimeFor(gemini, groq).prepare("manual", "gemini", "flash", [{ role: "user", content: "Hi" }]);
  assert.equal(result.model.id, "flash");
  assert.deepEqual(await Array.fromAsync(result.stream), ["manual gemini"]);
  assert.deepEqual(calls, ["flash"]);
});

test("after first token streamed, no provider switching occurs", async () => {
  let fallback = 0;
  const groq = provider("groq", [model("groq", "llama")], async function* () {
    yield "partial";
    throw new PlatformError("provider_unavailable", "Stream disconnected.", 503);
  });
  const result = await runtimeFor(groq).prepare("auto", "", "", [{ role: "user", content: "Hi" }]);
  const iterator = result.stream[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), { value: "partial", done: false });
  await assert.rejects(iterator.next());
  assert.equal(fallback, 0);
});

test("LOCAL_ONLY does not call cloud providers", async () => {
  let cloud = 0;
  const ollama = provider("ollama", [model("ollama", "local", { locality: "local", pricing: "free" })], async function* () { yield "local"; });
  const groq = provider("groq", [model("groq", "llama")], async function* () { cloud += 1; yield "cloud"; });
  const result = await runtimeFor(ollama, groq).prepare("local_only", "", "", [{ role: "user", content: "Hi" }]);
  assert.equal(result.model.locality, "local");
  assert.equal(cloud, 0);
});

test("AUTO never selects paid-only models", async () => {
  const mixed = provider("cloud", [
    model("cloud", "paid", { pricing: "paid" }),
    model("cloud", "free", { pricing: "free" }),
  ], async function* (id) { yield id; });
  const result = await runtimeFor(mixed).prepare("auto", "", "", [{ role: "user", content: "Hi" }]);
  assert.equal(result.model.id, "free");
});

test("interleaves providers so a 503 on Groq can reach Gemini before a second Groq model", async () => {
  const calls = [];
  const groq = provider("groq", [
    model("groq", "deepseek-coder-a"),
    model("groq", "deepseek-coder-b"),
  ], async function* (id) {
    calls.push(`groq:${id}`);
    throw new PlatformError("provider_unavailable", "Groq returned HTTP 503.", 503);
  });
  const gemini = provider("gemini", [model("gemini", "flash")], async function* (id) {
    calls.push(`gemini:${id}`);
    yield "recovered";
  });
  const result = await runtimeFor(groq, gemini).prepare("auto", "", "", [{ role: "user", content: "write typescript code" }], undefined, { task: "coding" });
  assert.deepEqual(await Array.fromAsync(result.stream), ["recovered"]);
  assert.deepEqual(calls, ["groq:deepseek-coder-a", "gemini:flash"]);
});
