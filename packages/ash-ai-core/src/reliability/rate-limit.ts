/** Process-local limiter. A restart clears it. It is not a shared quota across hosts. */
export class SlidingWindowLimiter {
  private readonly attempts = new Map<string, { startedAt: number; count: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  allow(key: string, now = Date.now()) {
    for (const [candidate, item] of this.attempts) {
      if (now - item.startedAt >= this.windowMs) this.attempts.delete(candidate);
    }
    if (this.attempts.size > 1_000) {
      const oldest = this.attempts.keys().next().value as string | undefined;
      if (oldest) this.attempts.delete(oldest);
    }
    const item = this.attempts.get(key);
    if (!item || now - item.startedAt >= this.windowMs) {
      this.attempts.set(key, { startedAt: now, count: 1 });
      return true;
    }
    item.count += 1;
    return item.count <= this.limit;
  }
}

export type UsageEvent = {
  at: number;
  kind: "chat" | "research" | "embed" | "other";
  userId?: string;
  providerId?: string;
  modelId?: string;
};

/** Products can persist this. The core default discards it. */
export interface UsageSink {
  record(event: UsageEvent): void;
}

export const discardUsage: UsageSink = { record() {} };
