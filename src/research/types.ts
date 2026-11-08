export type ResearchHit = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  provider: string;
  published?: string;
};

export type ResearchProvider = {
  id: string;
  search: (query: string, signal?: AbortSignal) => Promise<ResearchHit[]>;
};

export type ResearchResult = {
  query: string;
  queries: string[];
  sources: ResearchHit[];
  failedProviders: string[];
  note: string;
};
