/** Repeatable manual/live-quality scenarios for `npm run test:live:quality`. */
export const LIVE_QUALITY_PROMPTS = [
  { id: 1, name: "General knowledge", prompt: "What is HTML used for?", workingMode: "auto", responseStyle: "normal", webSearch: false },
  { id: 2, name: "Beginner explanation", prompt: "Explain DNS to a beginner.", workingMode: "auto", responseStyle: "normal", webSearch: false },
  { id: 3, name: "Business analysis", prompt: "Analyse opening a small cafe with assumptions and risks.", workingMode: "deep_analysis", responseStyle: "detailed", webSearch: false },
  { id: 4, name: "Research with sources", prompt: "Research what photosynthesis is and cite sources.", workingMode: "research", responseStyle: "detailed", webSearch: true },
  { id: 5, name: "Research no reliable sources", prompt: "Research zzqxpv_nonexistent_entity_99281 market share.", workingMode: "research", responseStyle: "normal", webSearch: true },
  { id: 6, name: "Financial calculation", prompt: "If 240,000 customers × ₹199 per month, what is annual revenue?", workingMode: "auto", responseStyle: "normal", webSearch: false },
  { id: 7, name: "Multi-step reasoning", prompt: "If all roses are flowers and some flowers fade quickly, can we conclude all roses fade quickly?", workingMode: "auto", deepReasoning: true, webSearch: false },
  { id: 8, name: "Coding", prompt: "Write a TypeScript isPalindrome function with a short explanation.", workingMode: "coding", responseStyle: "detailed", webSearch: false },
  { id: 9, name: "PDF analysis", prompt: null, skip: "Requires manual PDF upload in the UI." },
  { id: 10, name: "Context retention", prompt: "Remember the codename BLUEFIN.", followUp: "What codename should you remember?", workingMode: "auto", webSearch: false },
  { id: 11, name: "Long structured response", prompt: "Give Summary, Details, and Example sections for REST APIs.", workingMode: "auto", responseStyle: "detailed", webSearch: false },
  { id: 12, name: "Contradiction detection", prompt: "The plan is 90 days. Flag anything that implies 24 weeks instead.", workingMode: "deep_analysis", responseStyle: "detailed", webSearch: false },
  { id: 13, name: "Short answer", prompt: "Define RAM in one sentence only.", workingMode: "auto", responseStyle: "short", webSearch: false },
  { id: 14, name: "Deep analysis mode", prompt: "Compare SQLite vs Postgres for a solo developer app.", workingMode: "deep_analysis", responseStyle: "deep_analysis", webSearch: false },
  { id: 15, name: "Provider failure recovery", prompt: "Say hello in one short sentence.", note: "Temporarily invalidate a provider key or stop Ollama to observe fallback.", workingMode: "auto", webSearch: false },
];
