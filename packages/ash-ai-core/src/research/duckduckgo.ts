import type { ResearchHit } from "./types.ts";

type RelatedTopic = {
  FirstURL?: string;
  Text?: string;
  Topics?: RelatedTopic[];
};

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function flattenTopics(topics: RelatedTopic[] | undefined, acc: ResearchHit[] = []) {
  for (const topic of topics || []) {
    if (topic.FirstURL && topic.Text) {
      acc.push({
        title: topic.Text.split(" - ")[0] || topic.Text.slice(0, 80),
        url: topic.FirstURL,
        snippet: topic.Text,
        domain: domainOf(topic.FirstURL),
        provider: "duckduckgo",
      });
    }
    if (topic.Topics) flattenTopics(topic.Topics, acc);
  }
  return acc;
}

export async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  const trimmed = query.trim().slice(0, 120);
  if (!trimmed) return [];
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(trimmed)}&format=json&no_html=1&skip_disambig=1`;
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "ASH-AI-Platform/0.2 (private test; DuckDuckGo Instant Answer)" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("duckduckgo_unavailable");
  const data = await response.json() as {
    Heading?: string;
    AbstractText?: string;
    AbstractURL?: string;
    RelatedTopics?: RelatedTopic[];
  };
  const hits: ResearchHit[] = [];
  if (data.AbstractURL && (data.AbstractText || data.Heading)) {
    hits.push({
      title: data.Heading || data.AbstractURL,
      url: data.AbstractURL,
      snippet: data.AbstractText || "",
      domain: domainOf(data.AbstractURL),
      provider: "duckduckgo",
    });
  }
  hits.push(...flattenTopics(data.RelatedTopics));
  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (!hit.url || seen.has(hit.url)) return false;
    seen.add(hit.url);
    return true;
  }).slice(0, 5);
}
