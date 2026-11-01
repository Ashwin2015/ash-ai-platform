import { randomUUID } from "node:crypto";
import { PlatformError } from "../errors.ts";
import type { PlatformDatabase } from "../storage/database.ts";

const MAX_MEMORY = 2_000;

export class MemoryService {
  private readonly database: PlatformDatabase;
  private readonly now: () => number;

  constructor(database: PlatformDatabase, now: () => number = Date.now) {
    this.database = database;
    this.now = now;
  }

  async list(userId: string, scope?: "personal" | "project", projectId?: string | null, status?: "pending" | "approved") {
    return this.database.listMemories(userId, scope, projectId, status);
  }

  async create(userId: string, input: { scope: "personal" | "project"; projectId?: string | null; content: string; status?: "pending" | "approved" }) {
    const content = input.content.trim();
    if (!content || content.length > MAX_MEMORY) {
      throw new PlatformError("invalid_request", `Memory must be 1–${MAX_MEMORY} characters.`, 400);
    }
    if (input.scope === "project" && !input.projectId) {
      throw new PlatformError("invalid_request", "Project memory requires a project.", 400);
    }
    const record = {
      id: randomUUID(),
      scope: input.scope,
      projectId: input.scope === "project" ? input.projectId ?? null : null,
      content,
      status: input.status ?? "pending",
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    await this.database.createMemory(userId, record);
    return record;
  }

  async update(userId: string, id: string, patch: { content?: string; status?: "pending" | "approved" }) {
    if (patch.content && (patch.content.trim().length < 1 || patch.content.length > MAX_MEMORY)) {
      throw new PlatformError("invalid_request", `Memory must be 1–${MAX_MEMORY} characters.`, 400);
    }
    if (!await this.database.updateMemory(userId, id, { ...patch, content: patch.content?.trim() }, this.now())) {
      throw new PlatformError("not_found", "Memory not found.", 404);
    }
  }

  async delete(userId: string, id: string) {
    if (!await this.database.deleteMemory(userId, id)) throw new PlatformError("not_found", "Memory not found.", 404);
  }

  suggestFromMessage(content: string) {
    const facts = content.split(/[\n.]+/).map((part) => part.trim()).filter((part) =>
      part.length > 24 &&
      /^(i am|i'm|my name|i live|i work|i prefer|remember that|we decided|the project)/i.test(part),
    );
    return facts.slice(0, 3);
  }
}
