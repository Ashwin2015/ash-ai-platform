import assert from "node:assert/strict";
import test from "node:test";

const OLLAMA = process.env.ASH_PLATFORM_OLLAMA_URL || "http://127.0.0.1:11434";

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
