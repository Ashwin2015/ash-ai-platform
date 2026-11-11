import { loadCore } from "./load-core.mjs";

const core = await loadCore();
const [calculator] = core.builtinTools;
const arithmetic = await calculator.run("12 × 8");
console.log(`ASH AI Core ${core.ASH_AI_CORE_VERSION}`);
console.log(arithmetic.text || "No arithmetic was found.");
console.log("Register only the providers this product needs. AUTO must not select paid models.");
