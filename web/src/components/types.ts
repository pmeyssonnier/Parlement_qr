/** Corpus facts rendered by the server page and shown across the interface. */
export type CorpusSummary = {
  count: number;
  answerCount: number;
  extractedAt: string;
  /** Most recent date among the documents; null before migration 010. */
  latestDocument: string | null;
  method: string;
  ai: boolean;
};
export type Panel = "method" | "privacy";

// The exploratory sample shipped with the repository has exactly 10 questions.
export const isDemoCorpus = (corpus: CorpusSummary) => corpus.count === 10;
