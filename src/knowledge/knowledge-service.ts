import { randomUUID } from "node:crypto";
import { cosine, EmbeddingService } from "../embeddings/local.ts";
import { chunkText } from "../multimodal/documents.ts";
import type { PlatformDatabase } from "../storage/database.ts";

export class KnowledgeService {
  private readonly database: PlatformDatabase;
  private readonly embeddings: EmbeddingService;

  constructor(database: PlatformDatabase, embeddings: EmbeddingService) {
    this.database = database;
    this.embeddings = embeddings;
  }

  async ingest(userId: string, projectId: string | null, title: string, text: string, attachmentId: string | null, signal?: AbortSignal) {
    const chunks = chunkText(text);
    const documentId = randomUUID();
    await this.database.createKnowledgeDocument(userId, {
      id: documentId,
      projectId,
      attachmentId,
      title,
      createdAt: Date.now(),
    });
    if (!chunks.length) return { documentId, chunkCount: 0 };
    const vectors = await this.embeddings.embed(chunks, signal);
    for (const [index, content] of chunks.entries()) {
      const pageMatch = content.match(/Page (\d+):/);
      await this.database.createKnowledgeChunk(userId, {
        id: randomUUID(),
        documentId,
        projectId,
        ordinal: index,
        content,
        embedding: JSON.stringify(vectors[index] ?? []),
        page: pageMatch ? Number(pageMatch[1]) : null,
      });
    }
    return { documentId, chunkCount: chunks.length };
  }

  async retrieve(userId: string, projectId: string | null, query: string, limit = 5, signal?: AbortSignal) {
    const chunks = await this.database.listKnowledgeChunks(userId, projectId);
    if (!chunks.length) return [];
    const [queryVector] = await this.embeddings.embed([query], signal);
    const ranked = chunks.map((chunk) => {
      let embedding: number[] = [];
      try {
        embedding = chunk.embedding ? JSON.parse(chunk.embedding) as number[] : [];
      } catch {
        embedding = [];
      }
      const semantic = embedding.length ? cosine(queryVector, embedding) : 0;
      const lexical = chunk.content.toLowerCase().includes(query.toLowerCase()) ? 0.15 : 0;
      return { ...chunk, score: semantic + lexical };
    }).sort((left, right) => right.score - left.score);
    return ranked.filter((chunk) => chunk.score > 0.05).slice(0, limit);
  }
}
