export type WorkingMode = "auto" | "research" | "deep_analysis" | "coding";

const MODE_ALIASES: Record<string, WorkingMode> = {
  auto: "auto",
  research: "research",
  deep_analysis: "deep_analysis",
  deep: "deep_analysis",
  analysis: "deep_analysis",
  coding: "coding",
  code: "coding",
};

export function normalizeWorkingMode(value: unknown): WorkingMode {
  if (typeof value === "string" && MODE_ALIASES[value]) return MODE_ALIASES[value];
  return "auto";
}

export function inferWorkingMode(text: string, explicit?: unknown): WorkingMode {
  const requested = normalizeWorkingMode(explicit);
  if (requested !== "auto") return requested;
  const lower = text.toLowerCase();
  if (/```/.test(text) || /\b(typescript|javascript|python|stack trace|refactor|compile error|function\s+\w+\s*\()\b/i.test(text)) {
    return "coding";
  }
  if (/\b(latest|current|as of|news|market share|who is the ceo|today's|this week|this quarter|cite sources|with sources)\b/i.test(lower)
    || /\bresearch\b/.test(lower)) {
    return "research";
  }
  if (/\b(business plan|business analysis|trade-?offs?|deep dive|compare alternatives|risks and limitations)\b/i.test(lower)
    || (/\b(analyse|analyze)\b/.test(lower) && /\b(assumptions|risks|recommend|trade-?offs?)\b/i.test(lower))) {
    return "deep_analysis";
  }
  return "auto";
}

export function shouldAutoResearch(text: string, workingMode: WorkingMode, webSearch?: boolean) {
  if (webSearch === true) return true;
  if (workingMode === "research") return true;
  if (workingMode === "coding") return false;
  const lower = text.toLowerCase();
  if (/\b(do not search|without (web )?search|no (web )?research|don't look (it )?up)\b/i.test(lower)) return false;
  if (/\b(what is 2\+2|hello|hi there)\b/.test(lower) && text.length < 40) return false;
  return /\b(latest|current events?|as of 20\d{2}|today's|this week|who (is|was) the (ceo|president)|stock price|market share|news about)\b/i.test(lower)
    || /\bresearch\b/.test(lower);
}

export function classifyQuestionComplexity(text: string): "simple" | "moderate" | "complex" {
  const parts = text.split(/\n+/).filter(Boolean).length;
  const asks = (text.match(/\?/g) || []).length;
  const numbered = /^\s*\d+[.)]/m.test(text);
  if (text.length < 80 && parts < 2 && asks <= 1 && !numbered) return "simple";
  if (text.length > 400 || parts >= 4 || asks >= 3 || numbered) return "complex";
  return "moderate";
}

export function selectRelevantText(items: { content: string }[], query: string, limit = 5) {
  const tokens = new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
  if (!tokens.size) return items.slice(0, Math.min(2, limit)).map((item) => item.content);
  const scored = items.map((item) => {
    const words = item.content.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
    const score = words.reduce((sum, word) => sum + (tokens.has(word) ? 1 : 0), 0);
    return { content: item.content, score };
  }).filter((item) => item.score > 0 || (
    (/my name|what(?:'s| is) my name/i.test(query) && /^(my name is|i am|i'm\b)/i.test(item.content)) ||
    (/remember/i.test(query) && /^(remember that|we decided)/i.test(item.content))
  ));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((item) => item.content);
}
