import assert from "node:assert/strict";
import test from "node:test";
import { PlatformError } from "../src/errors.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";
import { ChatRuntime } from "../src/runtime/chat-runtime.ts";

function model(providerId, id, { locality = "cloud", pricing = "free", text = true } = {}) {
  return {
    providerId,
    id,
    displayName: id,
    locality,
    pricing,
    capabilities: {
      textInput: text,
      textOutput: text,
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
    streamChat: (modelId, messages, signal) => stream(modelId, messages, signal),
  };
}

function runtimeFor(...providers) {
  const registry = new ProviderRegistry();
  for (const item of providers) registry.register(item);
  return new ChatRuntime(registry);
}

test("AUTO prefers local free chat models and excludes paid or unknown-price models", async () => {
  const selected = model("ollama", "local-free", { locality: "local" });
  const local = provider("ollama", [selected], async function* () { yield "local"; });
  const cloudModels = [
    model("cloud", "limited-free", { pricing: "limited_free" }),
    model("cloud", "paid", { pricing: "paid" }),
    model("cloud", "unknown", { pricing: "unknown" }),
  ];
  const cloud = provider("cloud", cloudModels, async function* () { yield "cloud"; });
  const runtime = runtimeFor(cloud, local);

  const result = await runtime.prepare("auto", "", "", [{ role: "user", content: "Hi" }]);
  assert.equal(result.model.id, "local-free");
  assert.deepEqual(await Array.fromAsync(result.stream), ["local"]);
});

test("AUTO falls back to another eligible model only before emitting a response", async () => {
  let localCalls = 0;
  let cloudCalls = 0;
  const localModel = model("ollama", "local", { locality: "local" });
  const cloudModel = model("cloud", "free");
  const local = provider("ollama", [localModel], async function* () {
    localCalls += 1;
    throw new Error("local model unavailable");
  });
  const cloud = provider("cloud", [cloudModel], async function* () {
    cloudCalls += 1;
    yield "fallback response";
  });
  const runtime = runtimeFor(local, cloud);

  const result = await runtime.prepare("auto", "", "", [{ role: "user", content: "Hi" }]);
  assert.equal(result.model.providerId, "cloud");
  assert.deepEqual(await Array.fromAsync(result.stream), ["fallback response"]);
  assert.equal(cloudCalls, 1);
  const next = await runtime.prepare("auto", "", "", [{ role: "user", content: "Again" }]);
  assert.equal(next.model.providerId, "cloud");
  assert.equal(localCalls, 1);
});

test("AUTO does not fall back after response text has started", async () => {
  let fallbackCalls = 0;
  const localModel = model("ollama", "local", { locality: "local" });
  const cloudModel = model("cloud", "free");
  const local = provider("ollama", [localModel], async function* () {
    yield "first token";
    throw new Error("stream disconnected");
  });
  const cloud = provider("cloud", [cloudModel], async function* () {
    fallbackCalls += 1;
    yield "must not be duplicated";
  });
  const runtime = runtimeFor(local, cloud);

  const result = await runtime.prepare("auto", "", "", [{ role: "user", content: "Hi" }]);
  const iterator = result.stream[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), { value: "first token", done: false });
  await assert.rejects(iterator.next(), /stream disconnected/);
  assert.equal(fallbackCalls, 0);
});

test("LOCAL ONLY never selects a cloud model and FREE CLOUD never selects a local model", async () => {
  const localModel = model("ollama", "local", { locality: "local" });
  const cloudModel = model("cloud", "free");
  const local = provider("ollama", [localModel], async function* () { yield "local"; });
  const cloud = provider("cloud", [cloudModel], async function* () { yield "cloud"; });
  const runtime = runtimeFor(local, cloud);

  const localResult = await runtime.prepare("local_only", "", "", [{ role: "user", content: "Hi" }]);
  assert.equal(localResult.model.locality, "local");
  const cloudResult = await runtime.prepare("free_cloud", "", "", [{ role: "user", content: "Hi" }]);
  assert.equal(cloudResult.model.locality, "cloud");

  const localRuntime = runtimeFor(local);
  await assert.rejects(
    localRuntime.prepare("free_cloud", "", "", [{ role: "user", content: "Hi" }]),
    (error) => error instanceof PlatformError && /No verified free cloud/.test(error.message),
  );
});

test("AUTO ignores empty leading stream chunks and still uses the model", async () => {
  const cloudModel = model("cloud", "free");
  const cloud = provider("cloud", [cloudModel], async function* () {
    yield "";
    yield "hello";
  });
  const runtime = runtimeFor(cloud);
  const result = await runtime.prepare("auto", "", "", [{ role: "user", content: "Hi" }]);
  assert.equal(result.model.id, "free");
  assert.deepEqual(await Array.fromAsync(result.stream), ["hello"]);
});

test("AUTO tries at most two models per provider", async () => {
  const calls = [];
  const models = [
    model("gemini", "flash-a", { pricing: "limited_free" }),
    model("gemini", "flash-b", { pricing: "limited_free" }),
    model("gemini", "flash-c", { pricing: "limited_free" }),
    model("groq", "llama", { pricing: "limited_free" }),
  ];
  const gemini = provider("gemini", models.filter((item) => item.providerId === "gemini"), async function* (id) {
    calls.push(id);
    throw new Error(`gemini ${id} failed`);
  });
  const groq = provider("groq", models.filter((item) => item.providerId === "groq"), async function* (id) {
    calls.push(id);
    yield "from groq";
  });
  const runtime = runtimeFor(gemini, groq);
  const result = await runtime.prepare("auto", "", "", [{ role: "user", content: "Hi" }]);
  assert.equal(result.model.id, "llama");
  assert.deepEqual(calls, ["flash-a", "flash-b", "llama"]);
});

test("AUTO refuses paid-only models", async () => {
  const paid = model("cloud", "paid", { pricing: "paid" });
  const runtime = runtimeFor(provider("cloud", [paid], async function* () { yield "paid"; }));
  await assert.rejects(
    runtime.prepare("auto", "", "", [{ role: "user", content: "Hi" }]),
    (error) => error instanceof PlatformError && error.code === "model_unavailable",
  );
});
