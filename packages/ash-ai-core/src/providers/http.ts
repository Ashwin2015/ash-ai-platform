import { PlatformError } from "../errors.ts";

export async function providerFetch(url: string, init: RequestInit, label: string, timeoutMs = 20_000) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new PlatformError("provider_unavailable", `${label} is unavailable.`, 503);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const quota = response.status === 429 || /quota|rate limit/i.test(detail);
    throw new PlatformError(
      quota ? "rate_limited" : "provider_unavailable",
      quota ? `${label} rate limit or free-tier quota was reached.` : `${label} returned HTTP ${response.status}.`,
      quota ? 429 : 503,
    );
  }
  return response;
}

export async function readJson<T>(response: Response, label: string): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new PlatformError("provider_unavailable", `${label} returned invalid JSON.`, 502);
  }
}

export async function* readSseJson<T>(response: Response, label: string): AsyncIterable<T> {
  if (!response.body) throw new PlatformError("provider_unavailable", `${label} did not return a stream.`, 503);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const raw of events) {
        const dataLines = raw.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
        if (!dataLines.length || dataLines.join("\n") === "[DONE]") continue;
        try {
          yield JSON.parse(dataLines.join("\n")) as T;
        } catch {
          throw new PlatformError("provider_unavailable", `${label} returned an invalid stream chunk.`, 502);
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
