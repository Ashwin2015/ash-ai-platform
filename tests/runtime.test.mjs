import assert from "node:assert/strict";
import test from "node:test";
import { PlatformError } from "../src/errors.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";
import { ChatRuntime } from "../src/runtime/chat-runtime.ts";

function model(providerId, id, { locality = "cloud", pricing = "free", text = true, maxOutputTokens, contextWindow } = {}) {
  return {
    providerId,
    id,
    displayName: id,
    locality,
    pricing,
    maxOutputTokens,
    contextWindow,
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
    streamChat: (modelId, messages, signal, options) => stream(modelId, messages, signal, options),
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
  assert.deepEqual(calls, ["flash-a", "llama"]);
});

test("manual selection is not overridden by AUTO scoring", async () => {
  const preferred = model("cloud", "llama");
  const other = model("cloud", "qwen-coder");
  const calls = [];
  const cloud = provider("cloud", [preferred, other], async function* (id) {
    calls.push(id);
    yield "manual";
  });
  const runtime = runtimeFor(cloud);
  const result = await runtime.prepare("manual", "cloud", "llama", [{ role: "user", content: "write a typescript function" }], undefined, { task: "coding" });
  assert.equal(result.model.id, "llama");
  assert.deepEqual(await Array.fromAsync(result.stream), ["manual"]);
  assert.deepEqual(calls, ["llama"]);
});

test("AUTO prefers reasoning-capable models for reasoning tasks", async () => {
  const chatty = model("cloud", "llama-chat");
  const reasoner = model("cloud", "deepseek-r1");
  const cloud = provider("cloud", [chatty, reasoner], async function* (id) { yield id; });
  const runtime = runtimeFor(cloud);
  const result = await runtime.prepare("auto", "", "", [{ role: "user", content: "why" }], undefined, { task: "reasoning" });
  assert.equal(result.model.id, "deepseek-r1");
});

test("AUTO never selects paid models even when they score higher for the task", async () => {
  const paidReasoner = model("cloud", "pro-reason", { pricing: "paid" });
  const freeChat = model("cloud", "llama-chat", { pricing: "limited_free" });
  const cloud = provider("cloud", [paidReasoner, freeChat], async function* (id) { yield id; });
  const runtime = runtimeFor(cloud);
  const result = await runtime.prepare("auto", "", "", [{ role: "user", content: "prove this" }], undefined, { task: "reasoning" });
  assert.equal(result.model.id, "llama-chat");
});

test("generation limits are passed through to the selected provider", async () => {
  let received;
  const cloud = provider("cloud", [model("cloud", "free")], async function* (_id, _messages, _signal, options) {
    received = options;
    yield "ok";
  });
  const runtime = runtimeFor(cloud);
  const result = await runtime.prepare("manual", "cloud", "free", [{ role: "user", content: "Hi" }], undefined, { maxOutputTokens: 8192, temperature: 0.55 });
  assert.deepEqual(await Array.fromAsync(result.stream), ["ok"]);
  assert.equal(received.maxOutputTokens, 8192);
  assert.equal(received.temperature, 0.55);
});

test("AUTO prefers models with enough output capacity for long answers", async () => {
  const tiny = model("cloud", "tiny", { maxOutputTokens: 256, contextWindow: 2_000 });
  const wide = model("cloud", "wide", { maxOutputTokens: 8_192, contextWindow: 128_000 });
  const cloud = provider("cloud", [tiny, wide], async function* (id) { yield id; });
  const runtime = runtimeFor(cloud);
  const result = await runtime.prepare("auto", "", "", [{ role: "user", content: "Write a long analysis" }], undefined, {
    task: "chat",
    minOutputTokens: 4_096,
    maxOutputTokens: 4_096,
  });
  assert.equal(result.model.id, "wide");
});

test("generation budget is capped to the selected model output limit", async () => {
  let received;
  const cloud = provider("cloud", [model("cloud", "free", { maxOutputTokens: 512, contextWindow: 2_048 })], async function* (_id, _messages, _signal, options) {
    received = options;
    yield "ok";
  });
  const runtime = runtimeFor(cloud);
  const result = await runtime.prepare("manual", "cloud", "free", [{ role: "user", content: "Hi" }], undefined, { maxOutputTokens: 8_192, temperature: 0.55 });
  assert.deepEqual(await Array.fromAsync(result.stream), ["ok"]);
  assert.equal(received.maxOutputTokens, 512);
});

test("LOCAL ONLY never invokes a cloud provider", async () => {
  let cloudCalls = 0;
  const local = provider("ollama", [model("ollama", "local", { locality: "local" })], async function* () { yield "local"; });
  const cloud = provider("cloud", [model("cloud", "free")], async function* () {
    cloudCalls += 1;
    yield "cloud";
  });
  const runtime = runtimeFor(local, cloud);
  const result = await runtime.prepare("local_only", "", "", [{ role: "user", content: "Hi" }]);
  assert.equal(result.model.locality, "local");
  assert.deepEqual(await Array.fromAsync(result.stream), ["local"]);
  assert.equal(cloudCalls, 0);
});

test("AUTO refuses paid-only models", async () => {
  const paid = model("cloud", "paid", { pricing: "paid" });
  const runtime = runtimeFor(provider("cloud", [paid], async function* () { yield "paid"; }));
  await assert.rejects(
    runtime.prepare("auto", "", "", [{ role: "user", content: "Hi" }]),
    (error) => error instanceof PlatformError && error.code === "model_unavailable",
  );
});
