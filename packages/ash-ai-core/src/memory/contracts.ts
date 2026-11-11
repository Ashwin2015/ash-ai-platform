export type MemoryScope = "personal" | "project";
export type MemoryStatus = "pending" | "approved";

export type MemoryRecord = {
  id: string;
  scope: MemoryScope;
  projectId: string | null;
  content: string;
  status: MemoryStatus;
  createdAt: number;
  updatedAt: number;
};

/** Storage adapter. Products supply their own database. The core does not open SQLite or Postgres. */
export interface MemoryStore {
  listMemories(userId: string, scope?: MemoryScope, projectId?: string | null, status?: MemoryStatus): Promise<MemoryRecord[]> | MemoryRecord[];
  createMemory(userId: string, memory: MemoryRecord): Promise<unknown> | unknown;
  updateMemory(userId: string, memoryId: string, patch: { content?: string; status?: MemoryStatus }, now: number): Promise<boolean> | boolean;
  deleteMemory(userId: string, memoryId: string): Promise<boolean> | boolean;
}
