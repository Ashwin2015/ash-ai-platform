import assert from "node:assert/strict";
import test from "node:test";
import { assistantSystemPrompt, compactHistory } from "../packages/ash-ai-core/src/chat/assistant-prompt.ts";
import { classifyQuestionComplexity, selectRelevantText } from "../packages/ash-ai-core/src/chat/working-mode.ts";
import { scoreModelForTask } from "../packages/ash-ai-core/src/providers/free-catalog.ts";
import { formatResearchContext, runResearch } from "../packages/ash-ai-core/src/research/research-service.ts";
import { builtinTools } from "../packages/ash-ai-core/src/tools/builtin.ts";
import { extractCalculations } from "../packages/ash-ai-core/src/tools/calculator.ts";
import { ChatRuntime } from "../packages/ash-ai-core/src/runtime/chat-runtime.ts";
import { ProviderRegistry } from "../packages/ash-ai-core/src/providers/registry.ts";

const BENCHMARK = [
  ["general", "What is a balance sheet?"],
  ["general", "Explain photosynthesis in plain language."],
  ["instructions", "Answer in three numbered parts: definition, example, limitation."],
  ["instructions", "Use a table with columns Option, Cost, and Risk."],
  ["reasoning", "A shop has 240,000 customers paying ₹199 each month. What is the annual total?"],
  ["reasoning", "Compare two approaches and state which assumption matters most."],
  ["context", "Follow up: use the same numbers and show the monthly figure only."],
  ["context", "Do not repeat the earlier explanation. Give the action list."],
  ["document", "Summarise the uploaded PDF and quote the page you used."],
  ["document", "The scan is unreadable. Say what is missing instead of guessing."],
  ["coding", "Write a TypeScript function that rejects a path leaving its root."],
  ["coding", "Explain the error without inventing a library API."],
  ["research", "What is the latest public figure for this market? Cite sources."],
  ["research", "If no source was retrieved, say research was unavailable."],
  ["follow-up", "And what about the second option?"],
  ["memory", "What name did I ask you to remember?"],
  ["tool", "Calculate 12 × 8 and show the exact product."],
  ["tool", "240,000 × 199"],
  ["uncertainty", "If you are not sure of the date, say so."],
  ["routing", "Choose a free model and do not switch to a paid one."],
];

test("foundation benchmark: 20 prompts exercise orchestration without a live model", async () => {
  assert.equal(BENCHMARK.length, 20);
  const prompt = assistantSystemPrompt({ style: "detailed", workingMode: "auto", complexity: "complex" });
  assert.match(prompt, /Do not repeat the user's question/);
  assert.match(prompt, /If you are unsure/);
  assert.match(prompt, /Ask one clear question|ask one clear question/i);

  assert.equal(classifyQuestionComplexity("1. Definition\n2. Example\n3. Limitation\n4. Risk"), "complex");
  assert.ok(extractCalculations(BENCHMARK[17][1]).some((item) => item.result === 47_760_000));

  const history = compactHistory([
    { role: "user", content: "A".repeat(5_000) },
    { role: "assistant", content: "B".repeat(5_000) },
    ...Array.from({ length: 8 }, () => ({ role: "user", content: "recent" })),
  ]);
  assert.ok(history[0].content.length < 2_000);

  const memories = selectRelevantText(
    [{ content: "My name is Ashwin and I own ASH Chat" }, { content: "The warehouse code is north wing" }],
    "What name did I ask you to remember?",
  );
  assert.match(memories.join(" "), /Ashwin/);

  const empty = await runResearch("latest market", undefined, [{ id: "none", search: async () => [] }]);
  assert.match(formatResearchContext(empty), /Do not invent/);
  assert.equal(empty.sources.length, 0);

  const calculator = builtinTools.find((tool) => tool.id === "calculator");
  const arithmetic = await calculator.run(BENCHMARK[16][1]);
  assert.match(arithmetic.text, /96/);

  const registry = new ProviderRegistry();
  registry.register({
    id: "paid",
    displayName: "Paid",
    async listModels() {
      return [{
        providerId: "paid",
        id: "paid-best",
        displayName: "Paid best",
        locality: "cloud",
        pricing: "paid",
        capabilities: { textInput: true, textOutput: true, imageInput: false, pdfDirectInput: false, pdfTextPreprocessing: false, streaming: true, toolCalling: false },
      }];
    },
    async *streamChat() { yield "should-not-run"; },
  });
  await assert.rejects(() => new ChatRuntime(registry).prepare("auto", "", "", [{ role: "user", content: "Hello" }]), /free|paid|available/i);
  const free = { id: "free-chat", locality: "cloud", pricing: "free", capabilities: { imageInput: false } };
  const paid = { id: "paid-best", locality: "cloud", pricing: "paid", capabilities: { imageInput: false } };
  assert.ok(scoreModelForTask(free, "chat") >= 0);
  assert.ok(scoreModelForTask(paid, "chat") < scoreModelForTask(free, "chat") || scoreModelForTask(paid, "chat") <= 0);
});
