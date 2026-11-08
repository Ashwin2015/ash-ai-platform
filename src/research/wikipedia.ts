import { PlatformError } from "../errors.ts";
import type { ResearchHit } from "./types.ts";

const WIKI = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "ASH-AI-Platform/0.2 (private test; wikipedia.org API)";

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "en.wikipedia.org";
  }
}

export async function searchWikipedia(query: string, signal?: AbortSignal) {
  const trimmed = query.trim().slice(0, 120);
  if (!trimmed) throw new PlatformError("invalid_request", "A search query is required.", 400);
  const searchUrl = `${WIKI}?action=opensearch&limit=3&namespace=0&format=json&search=${encodeURIComponent(trimmed)}`;
  const response = await fetch(searchUrl, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
  }).catch(() => {
    throw new PlatformError("provider_unavailable", "Wikipedia lookup is unavailable.", 503);
  });
  if (!response.ok) throw new PlatformError("provider_unavailable", "Wikipedia lookup is unavailable.", 503);
  const data = await response.json() as [string, string[], string[], string[]];
  const titles = Array.isArray(data[1]) ? data[1] : [];
  const snippets = Array.isArray(data[2]) ? data[2] : [];
  const links = Array.isArray(data[3]) ? data[3] : [];
  const articles = titles.slice(0, 3).map((title, index) => ({
    title,
    snippet: snippets[index] || "",
    url: links[index] || "",
  }));
  return {
    source: "wikipedia",
    query: trimmed,
    articles,
    note: "Untrusted encyclopedia snippets. Not a live web crawl.",
  };
}

export async function searchWikipediaHits(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  const result = await searchWikipedia(query, signal);
  const hits: ResearchHit[] = result.articles.filter((item) => item.url).map((item) => ({
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    domain: domainOf(item.url),
    provider: "wikipedia",
  }));
  const first = hits[0];
  if (!first) return hits;
  try {
    const extractUrl = `${WIKI}?action=query&prop=extracts&exintro=1&explaintext=1&format=json&titles=${encodeURIComponent(first.title)}`;
    const response = await fetch(extractUrl, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
    });
    if (!response.ok) return hits;
    const data = await response.json() as { query?: { pages?: Record<string, { extract?: string }> } };
    const extract = Object.values(data.query?.pages || {})[0]?.extract?.slice(0, 900);
    if (extract) hits[0] = { ...first, snippet: extract };
  } catch {
    return hits;
  }
  return hits;
}
