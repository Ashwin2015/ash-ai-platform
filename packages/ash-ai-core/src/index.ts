export { PlatformError, errorPayload, sanitizeLogError } from "./errors.ts";
export type { PlatformErrorCode } from "./errors.ts";

export { ProviderRegistry } from "./providers/registry.ts";
export { OllamaProvider } from "./providers/ollama.ts";
export { GeminiProvider } from "./providers/gemini.ts";
export { OpenAICompatibleProvider } from "./providers/openai-compatible.ts";
export { inferTaskFromText, scoreModelForTask } from "./providers/free-catalog.ts";
export type { ChatImage, ChatTask, ChatTurn, ModelCapabilities, ModelDescriptor, ModelProvider, StreamChatOptions, StreamFinish } from "./providers/provider.ts";

export { ChatRuntime } from "./runtime/chat-runtime.ts";
export type { PrepareOptions, RoutingMode } from "./runtime/chat-runtime.ts";

export { assistantSystemPrompt, capGeneration, classifyFinish, clipTurn, compactHistory, CONTINUE_INSTRUCTION, generationLimits, normalizeResponseStyle } from "./chat/assistant-prompt.ts";
export { classifyQuestionComplexity, inferWorkingMode, normalizeWorkingMode, selectRelevantText, shouldAutoResearch } from "./chat/working-mode.ts";

export { extractCalculations, formatCalculationContext } from "./tools/calculator.ts";
export { builtinTools } from "./tools/builtin.ts";
export type { ToolResult } from "./tools/builtin.ts";

export { formatResearchContext, runResearch } from "./research/research-service.ts";
export type { ResearchHit, ResearchResult } from "./research/types.ts";

export { MemoryService } from "./memory/memory-service.ts";
export type { MemoryRecord, MemoryScope, MemoryStatus, MemoryStore } from "./memory/contracts.ts";

export { cosine, lexicalEmbed } from "./embeddings/local.ts";
export { SlidingWindowLimiter, discardUsage } from "./reliability/rate-limit.ts";
export type { UsageEvent, UsageSink } from "./reliability/rate-limit.ts";

export const ASH_AI_CORE_VERSION = "1.0.0";
