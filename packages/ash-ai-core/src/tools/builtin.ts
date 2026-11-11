import { extractCalculations, formatCalculationContext } from "./calculator.ts";
import { formatResearchContext, runResearch } from "../research/research-service.ts";

export type ToolResult = { id: string; ok: boolean; text: string };

/** Products call only the tools they need. This does not give the model a shell or a browser. */
export const builtinTools = [
  {
    id: "calculator",
    description: "Deterministic arithmetic extracted from the user text.",
    async run(input: string): Promise<ToolResult> {
      return { id: "calculator", ok: true, text: formatCalculationContext(extractCalculations(input)) };
    },
  },
  {
    id: "research",
    description: "Wikipedia and DuckDuckGo instant answers. Not a general web crawl.",
    async run(input: string): Promise<ToolResult> {
      const research = await runResearch(input);
      return { id: "research", ok: research.sources.length > 0, text: formatResearchContext(research) };
    },
  },
];
