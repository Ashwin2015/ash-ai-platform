import assert from "node:assert/strict";
import test from "node:test";
import { assistantSystemPrompt } from "../src/chat/assistant-prompt.ts";
import { classifyQuestionComplexity, inferWorkingMode, shouldAutoResearch } from "../src/chat/working-mode.ts";
import { formatResearchContext, runResearch } from "../src/research/research-service.ts";
import { extractCalculations } from "../src/tools/calculator.ts";

const CASES = [
  { id: 1, name: "Simple factual", prompt: "What is HTML?", expect: { complexity: "simple", research: false, mode: "auto" } },
  { id: 2, name: "Beginner explanation", prompt: "Explain photosynthesis to a 10-year-old.", expect: { complexity: "simple", research: false } },
  { id: 3, name: "Complex reasoning", prompt: "Analyse two warehouse layouts, compare trade-offs, and give a deep recommendation.", expect: { mode: "deep_analysis" } },
  { id: 4, name: "Multi-part instructions", prompt: "1. Define the market\n2. List costs\n3. Give risks\n4. Give a 90-day plan", expect: { complexity: "complex" } },
  { id: 5, name: "Business analysis", prompt: "Analyse this idea and state assumptions, not invented statistics.", expect: { mode: "deep_analysis" } },
  { id: 6, name: "Market research", prompt: "Research the latest EV market share in Europe with sources.", expect: { mode: "research", research: true } },
  { id: 7, name: "Financial calculations", prompt: "240,000 customers × ₹199 per month. Annual revenue?", expect: { calc: 573_120_000 } },
  { id: 8, name: "Contradiction detection", prompt: "The plan is 90 days. Do not silently change it to 24 weeks.", expect: { promptHas: /90 days/ } },
  { id: 9, name: "Long-form planning", prompt: "Write a 90-day execution plan with weekly checkpoints.", expect: { complexity: "simple" } },
  { id: 10, name: "Coding", prompt: "Write a typescript function that parses ISO dates.", expect: { mode: "coding" } },
  { id: 11, name: "Document analysis", prompt: "Summarise the attached PDF.", expect: { research: false } },
  { id: 12, name: "Image understanding", prompt: "What is in this screenshot?", expect: { research: false } },
  { id: 13, name: "Context retention", prompt: "What project name should you remember?", expect: { research: false } },
  { id: 14, name: "Uncertainty", prompt: "Estimate 2027 demand. Label it as an estimate.", expect: { promptHas: /estimate/i } },
  { id: 15, name: "Incomplete recovery", prompt: "Continue.", expect: { research: false } },
];

test("ASH evaluation suite: routing, arithmetic, research honesty, instruction prompts", async () => {
  for (const item of CASES) {
    if (item.expect.complexity) {
      assert.equal(classifyQuestionComplexity(item.prompt), item.expect.complexity, item.name);
    }
    if (item.expect.mode) {
      assert.equal(inferWorkingMode(item.prompt, "auto"), item.expect.mode, item.name);
    }
    if (item.expect.research === true) {
      assert.equal(shouldAutoResearch(item.prompt, inferWorkingMode(item.prompt, "auto")), true, item.name);
    }
    if (item.expect.research === false) {
      assert.equal(shouldAutoResearch(item.prompt, "auto"), false, item.name);
    }
    if (item.expect.calc) {
      assert.ok(extractCalculations(item.prompt).some((calc) => calc.result === item.expect.calc), item.name);
    }
  }
  const system = assistantSystemPrompt({ style: "detailed", deepReasoning: false, workingMode: "auto" });
  assert.match(system, /Do not answer a different question/);
  assert.match(system, /Never present an estimate as a verified fact/);
  assert.match(system, /fabricating sources/);
  const emptyResearch = await runResearch("x", undefined, [{ id: "none", search: async () => [] }]);
  assert.match(formatResearchContext(emptyResearch), /Do not invent/);
  assert.doesNotMatch(formatResearchContext(emptyResearch), /https:\/\/made-up/);
});

export const COMPETITOR_PROCEDURE = {
  note: "Live ChatGPT, Claude, Gemini and DeepSeek product tests were not run in this environment. Use the same 15 prompts with matching tools on/off and record product, model, date, search, tools, errors, citations and completion.",
};
