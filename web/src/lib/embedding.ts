// Embedding configuration of an indexed corpus version. The import records it
// in corpus_versions.index_config; the server must embed questions the same
// way, or it would compare vectors of incompatible spaces without noticing.
export const EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const NO_EMBEDDINGS = "sans-embeddings";

/** index_config of a version: passage format, embedding model, dimensions. */
export function indexConfig(format: string, model: string | null): string {
  return `${format};${model ?? NO_EMBEDDINGS};${EMBEDDING_DIMENSIONS}`;
}

/**
 * Model to embed questions with for the active version, or null when its
 * vectors cannot be compared (import without embeddings, other dimensions):
 * the search is then lexical only. A version imported before migration 008
 * has no configuration and keeps the configured model, as before.
 */
export function questionEmbeddingModel(config: string | null, legacyModel: string): string | null {
  if (config === null) return legacyModel;
  const [, model, dimensions] = config.split(";");
  if (!model || model === NO_EMBEDDINGS || Number(dimensions) !== EMBEDDING_DIMENSIONS) return null;
  return model;
}
