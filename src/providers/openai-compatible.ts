import { PlatformError } from "../errors.ts";
import { isGroqFreeChatModel, isOpenRouterZeroPrice } from "./free-catalog.ts";
import { providerFetch, readJson, readSseJson } from "./http.ts";
import type { ChatTurn, ModelDescriptor, ModelProvider } from "./provider.ts";

type Catalog = {
  data?: Array<{
    id?: string;
    name?: string;
    active?: boolean;
    pricing?: { prompt?: string | number; completion?: string | number };
    architecture?: { input_modalities?: string[]; output_modalities?: string[] };
    context_length?: number;
    supported_parameters?: string[];
  }>;
};
type StreamChunk = {
  choices?: Array<{ delta?: { content?: string } }>;
  error?: { message?: string } | string;
};

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: "groq" | "openrouter";
  readonly displayName: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly referer: string;
  private modelsCache: { expiresAt: number; models: ModelDescriptor[] } | null = null;

  constructor(id: "groq" | "openrouter", displayName: string, apiKey: string, baseUrl: string, referer = "") {
    this.id = id;
    this.displayName = displayName;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.referer = referer;
  }

  async health(signal?: AbortSignal) {
    if (!this.apiKey) {
      return {
        available: false,
        configured: false,
        modelCount: 0,
        message: `Add ${this.id.toUpperCase()}_API_KEY in ASH AI Platform .env.local.`,
      };
    }
    try {
      const models = await this.listModels(signal);
      return {
        available: models.length > 0,
        configured: true,
        modelCount: models.length,
        message: models.length ? undefined : `${this.displayName} is reachable, but no verified free chat model is currently listed.`,
      };
    } catch (error) {
      return {
        available: false,
        configured: true,
        modelCount: 0,
        message: error instanceof Error ? error.message : `${this.displayName} discovery failed.`,
      };
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelDescriptor[]> {
    if (!this.apiKey) return [];
    if (this.modelsCache && this.modelsCache.expiresAt > Date.now()) return this.modelsCache.models;
    const response = await providerFetch(`${this.baseUrl}/models`, {
      headers: this.headers(),
      signal,
    }, this.displayName);
    const data = await readJson<Catalog>(response, this.displayName);
    const models = (data.data ?? [])
      .filter((model): model is typeof model & { id: string } => typeof model.id === "string" && model.active !== false)
      .filter((model) => this.id === "groq" ? isGroqFreeChatModel(model.id) : isOpenRouterZeroPrice(model))
      .map((model) => ({
        providerId: this.id,
        id: model.id,
        displayName: model.name || model.id,
        locality: "cloud" as const,
        pricing: "limited_free" as const,
        contextWindow: model.context_length,
        capabilities: {
          textInput: model.architecture?.input_modalities?.includes("text") ?? true,
          textOutput: model.architecture?.output_modalities?.includes("text") ?? true,
          imageInput: model.architecture?.input_modalities?.includes("image") ?? false,
          pdfDirectInput: false,
          pdfTextPreprocessing: true,
          streaming: true,
          toolCalling: model.supported_parameters?.includes("tools") ?? false,
        },
        note: this.id === "openrouter"
          ? "Catalog reports zero input/output price. Free endpoints may still rate-limit."
          : "Included from Groq's current chat catalogue as a limited free-tier candidate.",
      }));
    this.modelsCache = { expiresAt: Date.now() + 45_000, models };
    return models;
  }

  async *streamChat(modelId: string, messages: ChatTurn[], signal?: AbortSignal): AsyncIterable<string> {
    const allowed = await this.listModels(signal);
    const selected = allowed.find((model) => model.id === modelId);
    if (!selected) {
      throw new PlatformError("model_unavailable", `That ${this.displayName} model is not a verified free model.`, 422);
    }
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    const payload = messages.map((message) => {
      if (message === lastUser && message.images?.length) {
        return {
          role: message.role,
          content: [
            { type: "text", text: message.content },
            ...message.images.map((image) => ({
              type: "image_url",
              image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
            })),
          ],
        };
      }
      return { role: message.role, content: message.content };
    });
    const response = await providerFetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: modelId, messages: payload, temperature: 0.6, stream: true }),
      signal,
    }, this.displayName, 180_000);
    let emitted = false;
    for await (const chunk of readSseJson<StreamChunk>(response, this.displayName)) {
      if (chunk.error) {
        const message = typeof chunk.error === "string" ? chunk.error : chunk.error.message;
        throw new PlatformError("provider_unavailable", message || `${this.displayName} reported a stream error.`, 502);
      }
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) {
        emitted = true;
        yield text;
      }
    }
    if (!emitted) throw new PlatformError("provider_unavailable", `${this.displayName} returned an empty response.`, 502);
  }

  private headers() {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.id === "openrouter") {
      headers["HTTP-Referer"] = this.referer || "http://127.0.0.1:3036";
      headers["X-Title"] = "ASH AI Platform";
    }
    return headers;
  }
}
