const GEMINI_FREE_PATTERN = /(flash|lite|gemma|flash-latest)/i;
const GEMINI_PAID_PATTERN = /(pro|ultra|imagen|veo|robotics)/i;
const GROQ_CHAT_PATTERN = /(llama|gemma|mixtral|qwen|gpt-oss|deepseek|kimi|compound|scout)/i;
const GROQ_NON_CHAT = /(whisper|tts|guard)/i;

export function classifyGeminiPricing(modelId: string): "limited_free" | "paid" {
  if (GEMINI_PAID_PATTERN.test(modelId) && !/flash/i.test(modelId)) return "paid";
  if (GEMINI_FREE_PATTERN.test(modelId)) return "limited_free";
  return "paid";
}

export function isGroqFreeChatModel(modelId: string) {
  return GROQ_CHAT_PATTERN.test(modelId) && !GROQ_NON_CHAT.test(modelId);
}

export function isOpenRouterZeroPrice(model: {
  id?: string;
  pricing?: { prompt?: string | number; completion?: string | number };
}) {
  return Boolean(model.id?.endsWith(":free")) &&
    Number(model.pricing?.prompt ?? 1) === 0 &&
    Number(model.pricing?.completion ?? 1) === 0;
}

export function inferTaskFromText(content: string): "chat" | "reasoning" | "coding" | "vision" | "document" {
  const text = content.toLowerCase();
  if (/\b(code|function|typescript|python|bug|refactor|compile|stack trace)\b/.test(text) || /```/.test(content)) {
    return "coding";
  }
  if (/\b(reason|prove|step by step|analyse|analyze|why)\b/.test(text)) return "reasoning";
  return "chat";
}

export function scoreModelForTask(model: {
  id: string;
  locality: "local" | "cloud";
  pricing: string;
  capabilities: { imageInput: boolean };
}, task: string) {
  let score = 0;
  if (model.locality === "local") score += 40;
  if (model.pricing === "free") score += 20;
  else if (model.pricing === "limited_free") score += 10;
  if (task === "vision" && model.capabilities.imageInput) score += 50;
  if (task === "coding" && /(code|coder|qwen|deepseek|codellama|devstral)/i.test(model.id)) score += 25;
  if (task === "reasoning" && /(reason|r1|think|qwq)/i.test(model.id)) score += 20;
  if (task === "document" && (model.capabilities.imageInput || /(long|32k|128k)/i.test(model.id))) score += 10;
  return score;
}
