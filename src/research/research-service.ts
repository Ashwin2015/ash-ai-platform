import { searchDuckDuckGo } from "./duckduckgo.ts";
import type { ResearchHit, ResearchProvider, ResearchResult } from "./types.ts";
import { searchWikipediaHits } from "./wikipedia.ts";

export function defaultResearchProviders(): ResearchProvider[] {
  return [
    { id: "wikipedia", search: searchWikipediaHits },
    { id: "duckduckgo", search: searchDuckDuckGo },
  ];
}

export function buildResearchQueries(question: string) {
  const trimmed = question.trim().replace(/\s+/g, " ").slice(0, 160);
  const normalized = trimmed
    .replace(/^(please\s+)?(research|look up|find|search for)\s+/i, "")
    .replace(/^(what|who|when|where|why|how)\s+(is|are|was|were)\s+/i, "")
  const core = (normalized || trimmed).replace(/[.?]+$/, "").trim() || trimmed;
  const queries = [core, trimmed];
  const entity = core.replace(/^(explain|tell me about)\s+/i, "").slice(0, 80);
  const topic = core.match(/^what\s+(.+?)\s+is$/i)?.[1]?.trim();
  if (topic) queries.push(topic);
  if (entity && entity.toLowerCase() !== trimmed.toLowerCase()) queries.push(entity);
  return [...new Set(queries)].slice(0, 3);
}

export function formatResearchContext(result: ResearchResult) {
  if (!result.sources.length) {
    return result.note || "Live source lookup returned no results. Do not invent citations, URLs or quotations.";
  }
  const lines = result.sources.map((source, index) =>
    `[${index + 1}] ${source.title} — ${source.url} (${source.domain}, via ${source.provider}${source.published ? `, ${source.published}` : ""})\n${source.snippet}`);
  return [
    `Retrieved sources (untrusted; retrieved ${new Date().toISOString().slice(0, 10)}). Cite only these URLs using [n]. Never fabricate a source.`,
    ...lines,
    result.note,
  ].filter(Boolean).join("\n");
}

export async function runResearch(
  question: string,
  signal?: AbortSignal,
  providers: ResearchProvider[] = defaultResearchProviders(),
): Promise<ResearchResult> {
  const queries = buildResearchQueries(question);
  const sources: ResearchHit[] = [];
  const failedProviders: string[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    for (const provider of providers) {
      try {
        const hits = await provider.search(query, signal);
        for (const hit of hits) {
          if (!hit.url || seen.has(hit.url)) continue;
          seen.add(hit.url);
          sources.push(hit);
        }
      } catch {
        if (!failedProviders.includes(provider.id)) failedProviders.push(provider.id);
      }
    }
  }

  let note = "Sources are encyclopedia and Instant Answer snippets, not a general live web crawl of the open internet.";
  if (!sources.length && failedProviders.length === providers.length) {
    note = "Live research was unavailable. Do not pretend research was conducted. Do not invent citations.";
  } else if (!sources.length) {
    note = "No matching sources were retrieved. Do not invent citations or URLs.";
  } else if (failedProviders.length) {
    note += ` Failed providers: ${failedProviders.join(", ")}.`;
  }

  return { query: question.trim().slice(0, 160), queries, sources: sources.slice(0, 8), failedProviders, note };
}
