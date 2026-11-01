export type ModelCapabilities = {
  textInput: boolean;
  textOutput: boolean;
  imageInput: boolean;
  pdfDirectInput: boolean;
  pdfTextPreprocessing: boolean;
  streaming: boolean;
  toolCalling: boolean;
  embeddings?: boolean;
};

export type ModelDescriptor = {
  providerId: string;
  id: string;
  displayName: string;
  locality: "local" | "cloud";
  pricing: "free" | "limited_free" | "paid" | "unknown";
  capabilities: ModelCapabilities;
  nativeCapabilities?: Partial<ModelCapabilities>;
  contextWindow?: number;
  note?: string;
};

export type ChatImage = { mimeType: string; base64: string };

export type ChatTurn = {
  role: "user" | "assistant" | "system";
  content: string;
  images?: ChatImage[];
};

export type ChatTask = "chat" | "reasoning" | "coding" | "vision" | "document" | "embeddings";

export interface ModelProvider {
  readonly id: string;
  readonly displayName: string;
  listModels(signal?: AbortSignal): Promise<ModelDescriptor[]>;
  health?(signal?: AbortSignal): Promise<{ available: boolean; configured: boolean; modelCount: number; message?: string }>;
  streamChat(modelId: string, messages: ChatTurn[], signal?: AbortSignal): AsyncIterable<string>;
  embed?(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}
