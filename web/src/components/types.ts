/** Corpus facts rendered by the server page and shown across the interface. */
export type CorpusSummary = { count: number; answerCount: number; extractedAt: string; method: string; ai: boolean };
export type Panel = "method" | "privacy";

// The exploratory sample shipped with the repository has exactly 10 questions.
export const isDemoCorpus = (corpus: CorpusSummary) => corpus.count === 10;
