import { PlatformError } from "../errors.ts";
import { classifyGeminiPricing } from "./free-catalog.ts";
import { providerFetch, readJson, readSseJson } from "./http.ts";
import type { ChatTurn, ModelDescriptor, ModelProvider } from "./provider.ts";

type GeminiCatalog = {
  models?: Array<{
    name?: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
    inputTokenLimit?: number;
  }>;
};
type GeminiChunk = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
};

export class GeminiProvider implements ModelProvider {
  readonly id = "gemini";
  readonly displayName = "Google Gemini";
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://generativelanguage.googleapis.com/v1beta") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async health(signal?: AbortSignal) {
    if (!this.apiKey) {
      return { available: false, configured: false, modelCount: 0, message: "Add GEMINI_API_KEY in ASH AI Platform .env.local." };
    }
    try {
      const models = await this.listModels(signal);
      return {
        available: models.length > 0,
        configured: true,
        modelCount: models.length,
        message: models.length ? undefined : "Gemini is reachable, but no free-tier chat model is currently eligible.",
      };
    } catch (error) {
      return {
        available: false,
        configured: true,
        modelCount: 0,
        message: error instanceof Error ? error.message : "Gemini discovery failed.",
      };
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelDescriptor[]> {
    if (!this.apiKey) return [];
    const response = await providerFetch(`${this.baseUrl}/models?pageSize=1000`, {
      headers: { "x-goog-api-key": this.apiKey },
      signal,
    }, this.displayName);
    const data = await readJson<GeminiCatalog>(response, this.displayName);
    return (data.models ?? [])
      .filter((model): model is typeof model & { name: string } =>
        typeof model.name === "string" && model.supportedGenerationMethods?.includes("generateContent") === true,
      )
      .map((model) => {
        const id = model.name.replace(/^models\//, "");
        const pricing = classifyGeminiPricing(id);
        return {
          providerId: this.id,
          id,
          displayName: model.displayName ?? id,
          locality: "cloud" as const,
          pricing,
          contextWindow: model.inputTokenLimit,
          capabilities: {
            textInput: true,
            textOutput: true,
            imageInput: id.startsWith("gemini-"),
            pdfDirectInput: false,
            pdfTextPreprocessing: true,
            streaming: true,
            toolCalling: false,
          },
          note: pricing === "limited_free"
            ? "Google free-tier quota still applies; this model is eligible for FREE FIRST routing."
            : "Not treated as free; excluded from AUTO and FREE CLOUD.",
        };
      })
      .filter((model) => model.pricing === "limited_free")
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async *streamChat(modelId: string, messages: ChatTurn[], signal?: AbortSignal): AsyncIterable<string> {
    const allowed = await this.listModels(signal);
    if (!allowed.some((model) => model.id === modelId)) {
      throw new PlatformError("model_unavailable", "That Gemini model is not verified as free-tier for this platform.", 422);
    }
    const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
    const contents = messages.filter((message) => message.role !== "system").map((message, index, list) => {
      const lastUser = [...list].reverse().find((item) => item.role === "user");
      return {
        role: message.role === "assistant" ? "model" : "user",
        parts: [
          { text: message.content },
          ...(message === lastUser ? (message.images ?? []).map((image) => ({
            inlineData: { mimeType: image.mimeType, data: image.base64 },
          })) : []),
        ],
      };
    });
    const response = await providerFetch(
      `${this.baseUrl}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents,
          generationConfig: { temperature: 0.6 },
        }),
        signal,
      },
      this.displayName,
      180_000,
    );
    let emitted = false;
    for await (const chunk of readSseJson<GeminiChunk>(response, this.displayName)) {
      const text = chunk.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      if (text) {
        emitted = true;
        yield text;
      }
    }
    if (!emitted) throw new PlatformError("provider_unavailable", "Gemini returned an empty response.", 502);
  }
}
