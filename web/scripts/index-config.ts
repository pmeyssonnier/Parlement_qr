import { createHash } from "node:crypto";
import { INDEX_FORMAT } from "../src/lib/documents";
import { indexConfig as versionConfig } from "../src/lib/embedding";
import type { Question } from "../src/lib/schema";

/** Everything stored rows depend on besides the question itself. */
export function indexConfig(model: string | null): string {
  return versionConfig(INDEX_FORMAT, model);
}

/**
 * Key of a question's stored rows (question_documents, document_passages).
 * Another model, dimension or passage format gives other rows: those of the
 * active version are never rewritten by an import in preparation.
 */
export function contentHash(q: Question, config: string): string {
  return createHash("sha256").update(JSON.stringify(q)).update("\n").update(config).digest("hex");
}
