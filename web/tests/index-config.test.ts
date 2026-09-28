import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { contentHash, indexConfig } from "../scripts/index-config";
import { corpus } from "../src/lib/corpus";
import { INDEX_FORMAT, passages, searchText } from "../src/lib/documents";
import { questionEmbeddingModel } from "../src/lib/embedding";
import { questionModel } from "../src/lib/server";

const [q] = corpus.questions;
assert.ok(q);

test("empreinte : la fiche et toute la configuration d'indexation", () => {
  const small = indexConfig("text-embedding-3-small");
  assert.equal(small, `${INDEX_FORMAT};text-embedding-3-small;1536`);
  assert.equal(indexConfig(null), `${INDEX_FORMAT};sans-embeddings;1536`);
  assert.equal(contentHash(q, small), contentHash(structuredClone(q), small));
  assert.notEqual(contentHash(q, small), contentHash(q, indexConfig("text-embedding-3-large")));
  assert.notEqual(contentHash(q, small), contentHash(q, indexConfig(null)));
  assert.notEqual(contentHash(q, small), contentHash(q, small.replace(INDEX_FORMAT, "autre-format")));
  assert.notEqual(contentHash(q, small), contentHash({ ...q, reponse: `${q.reponse} modifiée` }, small));
});

// Pins what the import stores for the sample corpus. If passages() or
// searchText() change, stored rows no longer match: change INDEX_FORMAT (the
// next import then stores and embeds everything again), then update both here.
const FORMATS: Record<string, string> = {
  "passages-1": "c7be63c3accdd0064f1ddd26d87c85af11c404290f420a24debb4fb0037e96af",
};
test("format des passages : tout changement impose un nouvel INDEX_FORMAT", () => {
  const digest = createHash("sha256");
  for (const question of corpus.questions)
    for (const p of passages(question))
      digest.update(JSON.stringify([p.id, p.section, p.order, p.text, searchText(question, p)]));
  assert.equal(
    FORMATS[INDEX_FORMAT],
    digest.digest("hex"),
    "passages() ou searchText() a changé : changez INDEX_FORMAT dans src/lib/documents.ts",
  );
});

test("modèle de la question : celui de la version active", () => {
  assert.equal(questionEmbeddingModel("passages-1;text-embedding-3-large;1536", "x"), "text-embedding-3-large");
  // Imported before migration 008: the configured model, as before.
  assert.equal(questionEmbeddingModel(null, "text-embedding-3-small"), "text-embedding-3-small");
  // No comparable vectors: lexical search only.
  assert.equal(questionEmbeddingModel("passages-1;sans-embeddings;1536", "x"), null);
  assert.equal(questionEmbeddingModel("passages-1;text-embedding-3-small;3072", "x"), null);
  assert.equal(questionEmbeddingModel("", "x"), null);
});

test("modèle de la question : lecture impossible, recherche lexicale", async () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (message: string) => errors.push(message);
  try {
    assert.equal(
      await questionModel(async () => {
        throw new Error("réseau");
      }),
      null,
    );
  } finally {
    console.error = original;
  }
  assert.deepEqual(errors, [JSON.stringify({ code: "INDEX_CONFIG_UNAVAILABLE" })]);
  assert.equal(await questionModel(async () => "passages-1;modele-b;1536"), "modele-b");
});
