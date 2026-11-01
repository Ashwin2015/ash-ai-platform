import { PlatformError } from "../errors.ts";
import type { ChatTurn, ModelDescriptor, ModelProvider } from "./provider.ts";

type TagsResponse = { models?: Array<{ name?: string; remote_host?: string }> };
type ShowResponse = { capabilities?: string[]; model_info?: Record<string, unknown> };
type ChatChunk = { message?: { content?: string }; done?: boolean; error?: string };
type EmbedResponse = { embedding?: number[]; embeddings?: number[][] };

export class OllamaProvider implements ModelProvider {
  readonly id = "ollama";
  readonly displayName = "Ollama (local)";
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 15_000) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  private async request(path: string, init: RequestInit = {}, timeoutMs = this.timeoutMs) {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new PlatformError("provider_unavailable", "Ollama is unavailable. Start it on this PC and check the local URL.", 503);
    }
    if (!response.ok) {
      throw new PlatformError("provider_unavailable", `Ollama returned HTTP ${response.status}.`, 503);
    }
    return response;
  }

  async listModels(signal?: AbortSignal): Promise<ModelDescriptor[]> {
    const response = await this.request("/api/tags", { signal });
    let data: TagsResponse;
    try {
      data = await response.json() as TagsResponse;
    } catch {
      throw new PlatformError("provider_unavailable", "Ollama returned an invalid model catalogue.", 503);
    }
    const installed = (data.models ?? []).filter((model): model is typeof model & { name: string } =>
      typeof model.name === "string" && !model.remote_host && !/:cloud$/i.test(model.name),
    );
    return Promise.all(installed.map(async (model) => {
      const detailsResponse = await this.request("/api/show", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model.name }),
        signal,
      });
      let details: ShowResponse;
      try {
        details = await detailsResponse.json() as ShowResponse;
      } catch {
        throw new PlatformError("provider_unavailable", "Ollama returned invalid model capability data.", 503);
      }
      const capabilities = new Set(details.capabilities ?? []);
      const contextWindow = Number(Object.entries(details.model_info ?? {}).find(([key]) => key.endsWith(".context_length"))?.[1]);
      const vision = capabilities.has("vision");
      const embeddings = capabilities.has("embedding") || /embed|nomic|bge|minilm/i.test(model.name);
      return {
        providerId: this.id,
        id: model.name,
        displayName: model.name,
        locality: "local" as const,
        pricing: "free" as const,
        contextWindow: Number.isFinite(contextWindow) ? contextWindow : undefined,
        capabilities: {
          textInput: !embeddings || capabilities.has("completion"),
          textOutput: !embeddings || capabilities.has("completion"),
          imageInput: vision,
          pdfDirectInput: false,
          pdfTextPreprocessing: true,
          streaming: capabilities.has("completion") || !embeddings,
          toolCalling: capabilities.has("tools"),
          embeddings,
        },
        nativeCapabilities: {
          imageInput: vision,
          toolCalling: capabilities.has("tools"),
          embeddings,
        },
      };
    }));
  }

  async health(signal?: AbortSignal) {
    try {
      const models = await this.listModels(signal);
      return { available: models.length > 0, configured: true, modelCount: models.length };
    } catch (error) {
      return {
        available: false,
        configured: true,
        modelCount: 0,
        message: error instanceof PlatformError ? error.message : "Ollama is not available on this PC.",
      };
    }
  }

  async *streamChat(modelId: string, messages: ChatTurn[], signal?: AbortSignal): AsyncIterable<string> {
    const models = await this.listModels(signal);
    const model = models.find((item) => item.id === modelId);
    if (!model) throw new PlatformError("model_unavailable", "That local Ollama model is not installed.", 422);
    const needsVision = messages.some((message) => message.images?.length);
    if (needsVision && !model.capabilities.imageInput) {
      throw new PlatformError("model_unavailable", "The selected local model does not advertise vision.", 422);
    }

    const response = await this.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        messages: messages.filter((message) => message.role !== "system" || message.content).map((message, index, list) => {
          const lastUser = [...list].reverse().find((item) => item.role === "user");
          const images = message === lastUser ? message.images?.map((image) => image.base64) : undefined;
          return {
            role: message.role === "system" ? "system" : message.role,
            content: message.content,
            ...(images?.length ? { images } : {}),
          };
        }),
        stream: true,
      }),
      signal,
    }, 180_000);
    if (!response.body) throw new PlatformError("provider_unavailable", "Ollama did not return a response stream.", 503);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let emittedText = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          yield* this.parseChunk(line, () => { emittedText = true; });
        }
        if (done) break;
      }
      if (buffer.trim()) yield* this.parseChunk(buffer, () => { emittedText = true; });
      if (!emittedText) throw new PlatformError("provider_unavailable", "Ollama returned an empty response.", 502);
    } finally {
      reader.releaseLock();
    }
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const models = await this.listModels(signal);
    const model = models.find((item) => item.capabilities.embeddings) ?? models.find((item) => /embed|nomic|bge/i.test(item.id));
    if (!model) throw new PlatformError("model_unavailable", "No local embedding model is installed.", 422);
    const vectors: number[][] = [];
    for (const text of texts) {
      const response = await this.request("/api/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model.id, input: text }),
        signal,
      }, 60_000);
      const data = await response.json() as EmbedResponse;
      const vector = data.embeddings?.[0] ?? data.embedding;
      if (!vector?.length) throw new PlatformError("provider_unavailable", "Ollama returned an empty embedding.", 502);
      vectors.push(vector);
    }
    return vectors;
  }

  private *parseChunk(line: string, onText: () => void): Generator<string> {
    let chunk: ChatChunk;
    try {
      chunk = JSON.parse(line) as ChatChunk;
    } catch {
      throw new PlatformError("provider_unavailable", "Ollama returned an invalid response stream.", 502);
    }
    if (chunk.error) throw new PlatformError("provider_unavailable", "Ollama could not complete the request.", 502);
    if (typeof chunk.message?.content === "string" && chunk.message.content) {
      onText();
      yield chunk.message.content;
    }
  }
}
