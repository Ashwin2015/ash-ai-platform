import assert from "node:assert/strict";
import test from "node:test";
import { loadCore } from "../src/load-core.mjs";

test("starter reaches the pinned or monorepo ASH AI Core", async () => {
  const core = await loadCore();
  assert.equal(core.ASH_AI_CORE_VERSION, "1.0.0");
  const maths = core.extractCalculations("12 × 8");
  assert.ok(maths.some((item) => item.result === 96));
  const research = core.assistantSystemPrompt({ style: "normal", workingMode: "research" });
  assert.match(research, /fabricating sources/);
});
