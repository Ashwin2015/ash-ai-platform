import { PlatformError } from "../errors.ts";

const WIKI = "https://en.wikipedia.org/w/api.php";

export async function searchWikipedia(query: string, signal?: AbortSignal) {
  const trimmed = query.trim().slice(0, 120);
  if (!trimmed) throw new PlatformError("invalid_request", "A search query is required.", 400);
  const searchUrl = `${WIKI}?action=opensearch&limit=3&namespace=0&format=json&search=${encodeURIComponent(trimmed)}`;
  const response = await fetch(searchUrl, {
    headers: { Accept: "application/json", "User-Agent": "ASH-AI-Platform/0.2 (private test; wikipedia.org API)" },
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
