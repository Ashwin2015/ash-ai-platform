import type { OllamaProvider } from "../providers/ollama.ts";

function tokenize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 1);
}

export function lexicalEmbed(text: string, dimensions = 256) {
  const vector = new Float64Array(dimensions);
  for (const token of tokenize(text)) {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index += 1) {
      hash = Math.imul(hash ^ token.charCodeAt(index), 16777619);
    }
    vector[(hash >>> 0) % dimensions] += 1;
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vector, (value) => value / norm);
}

export function cosine(left: number[], right: number[]) {
  const size = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < size; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return dot / ((Math.sqrt(leftNorm) || 1) * (Math.sqrt(rightNorm) || 1));
}

export class EmbeddingService {
  private readonly ollama?: OllamaProvider;

  constructor(ollama?: OllamaProvider) {
    this.ollama = ollama;
  }

  async embed(texts: string[], signal?: AbortSignal) {
    if (this.ollama) {
      try {
        return await this.ollama.embed(texts, signal);
      } catch {
        // Local lexical embeddings remain available when no embedding model is installed.
      }
    }
    return texts.map((text) => lexicalEmbed(text));
  }
}
