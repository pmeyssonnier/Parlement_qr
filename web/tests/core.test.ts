import assert from "node:assert/strict";
import test from "node:test";
import { extractiveAnswer, validateGenerated } from "../src/lib/answer";
import { corpus } from "../src/lib/corpus";
import { latestDate, nature, passages, safeSourceUrl, validateCorpus } from "../src/lib/documents";
import { chatInput, chatResponseSchema } from "../src/lib/schema";
import {
  contextHits,
  contextualQuery,
  filterLexicalHits,
  focusedExcerpts,
  lexicalQuery,
  localSearch,
  tokens,
} from "../src/lib/search";
import { corpusInfo, fallbackAnswer, localQuota, localRelease, semanticSearchEnabled } from "../src/lib/server";

const [sample] = corpus.questions;
assert.ok(sample);

test("corpus: dix fiches uniques et passages fidèles aux textes", () => {
  assert.equal(corpus.questions.length, 10);
  for (const q of corpus.questions)
    for (const p of passages(q)) {
      assert.ok(q[p.section]?.replace(/\s+/g, " ").includes(p.text.replace(/\s+/g, " ")));
      assert.ok(p.text.length > 0);
    }
});
test("refuse un décompte incohérent et les doublons", () => {
  assert.throws(() => validateCorpus({ ...corpus, nombre_elements: 9 }));
  assert.throws(() => validateCorpus({ ...corpus, questions: Array(10).fill(corpus.questions[0]) }));
});
test("seuls les liens officiels sont autorisés", () => {
  assert.throws(() => safeSourceUrl("https://parlement.brussels.example.com"));
  assert.throws(() => safeSourceUrl("javascript:alert(1)"));
  assert.throws(() => safeSourceUrl("https://user:pass@www.parlement.brussels/"));
  assert.ok(safeSourceUrl("http://www.parlement.brussels/").startsWith("https://"));
});
test("STIB et chaleur retrouvent les réponses pertinentes", () => {
  const hits = localSearch(corpus.questions, "Que fait la STIB en cas de forte chaleur ?");
  assert.ok(hits.some(h => h.question.moncode === "167348"));
  assert.ok(hits.every(h => h.passage.section === "reponse"));
});
test("les formulations citoyennes retrouvent vote et emballages", () => {
  assert.equal(
    localSearch(corpus.questions, "Comment les expatriés sont-ils informés de leur droit de vote ?")[0]?.question
      .moncode,
    "167744",
  );
  assert.equal(
    localSearch(corpus.questions, "Que prévoit clean.brussels pour réduire les emballages ?")[0]?.question.moncode,
    "166346",
  );
});
test("sujet absent: pas de réponse inventée", () => {
  const hits = localSearch(corpus.questions, "Astronautes martiens et fusées interstellaires");
  assert.equal(hits.length, 0);
  assert.equal(extractiveAnswer(hits, "test").status, "insuffisant");
});

test("un mot commun ne suffit pas à documenter un sujet absent", () => {
  const q = {
    ...sample,
    titre: "Transports scolaires",
    question: "Quels transports scolaires ?",
    reponse: "Des transports scolaires sont organisés.",
  };
  const passage = passages(q).find(p => p.section === "reponse");
  assert.ok(passage);
  const hit = { question: q, passage, score: 10 };
  assert.deepEqual(filterLexicalHits([hit], "Quelles mesures concernant les cantines scolaires ?"), []);
  assert.equal(filterLexicalHits([hit], "transports scolaires").length, 1);
});

test("une question sans réponse ne devient pas un extrait de réponse", () => {
  const q = { ...sample, reponse: null };
  assert.deepEqual(localSearch([q], "expatriés droit de vote"), []);
});

test("recherche lexicale : mots-clés alternatifs sans syntaxe utilisateur ni termes génériques", () => {
  assert.match(lexicalQuery("Comment les expatriés sont-ils informés de leur droit de vote ?"), /expatries OR/);
  assert.equal(lexicalQuery("Quelles sont les mesures concernant les cantines scolaires ?"), "cantines OR scolaires");
  assert.doesNotMatch(lexicalQuery('vote -"expatriés"'), /["-]/);
});
test("recherche lexicale : les mots partent tels qu'écrits, pas déjà raccourcis (le SQL les raccourcit lui-même)", () => {
  // Le retrait local du « s » final changerait la racine du stemmer français de PostgreSQL.
  for (const word of ["terminus", "bruxellois", "usagers", "processus", "emplois"]) {
    assert.equal(lexicalQuery(`${word}`), word);
  }
  // Mêmes mots retenus que la recherche locale : seul l'écriture change.
  const query = "Quelles sont les mesures pour les usagers des trams et des bus ?";
  assert.equal(
    lexicalQuery(query).split(" OR ").length,
    tokens(`${query} STIB transports`).filter(t => t !== "mesure").length,
  );
});
test("les synonymes s’appliquent aussi aux mots accentués", () => {
  assert.match(lexicalQuery("Quand ont lieu les élections ?"), /electoral/);
  assert.match(lexicalQuery("Le métro est-il climatisé ?"), /stib/);
});
test("les réponses d’incompétence sont signalées", () => {
  const q = corpus.questions.find(q => q.moncode === "167067");
  assert.ok(q);
  assert.equal(nature(q), "incompetence");
  const result = extractiveAnswer(localSearch([q], "Villo panneaux publicitaires"), "test");
  assert.match(result.paragraphs[0]?.text ?? "", /absence de compétence/);
});

test("sujet absent avec voisins sémantiques : aucune citation ni demande de pièces", () => {
  const hits = localSearch(corpus.questions, "emballages");
  assert.ok(hits.length);
  const result = validateGenerated(
    {
      status: "insuffisant",
      paragraphs: [
        {
          text: "Ces documents ne parlent pas des cantines. Fournissez vos pièces.",
          sourceIds: hits.map(h => h.passage.id),
        },
      ],
      limits: "Je ne peux utiliser que les pièces que vous me donnez.",
    },
    hits,
    "absent",
  );
  assert.equal(result.status, "insuffisant");
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.paragraphs[0]?.sourceIds, []);
  assert.match(result.paragraphs[0]?.text ?? "", /corpus de l’application/);
  assert.doesNotMatch(JSON.stringify(result), /Fournissez|pièces|emballages/);
  assert.equal(
    validateGenerated({ status: "insuffisant", paragraphs: [], limits: "" }, hits, "empty").status,
    "insuffisant",
  );
});
test("relances contextualisées et changement de sujet indépendant", () => {
  const history = [{ content: "Que fait la STIB en cas de canicule ?" }];
  assert.match(contextualQuery("Et dans les trams ?", history), /STIB/);
  assert.equal(
    contextualQuery("Comment voter aux élections communales ?", history),
    "Comment voter aux élections communales ?",
  );
});
test("une citation inventée ou absente est rejetée", () => {
  const hits = localSearch(corpus.questions, "STIB canicule");
  const [first] = hits;
  assert.ok(first);
  assert.throws(() =>
    validateGenerated(
      { status: "documente", paragraphs: [{ text: "Faux", sourceIds: ["invente"] }], limits: "" },
      hits,
      "test",
    ),
  );
  assert.throws(() =>
    validateGenerated({ status: "documente", paragraphs: [{ text: "Faux", sourceIds: [] }], limits: "" }, hits, "test"),
  );
  const ok = validateGenerated(
    {
      status: "documente",
      paragraphs: [{ text: "Une réponse est disponible.", sourceIds: [first.passage.id] }],
      limits: "",
    },
    hits,
    "test",
  );
  assert.equal(ok.sources[0]?.url, first.question.url_source);
  assert.ok(chatResponseSchema.safeParse(ok).success);
});

test("relance longue sur la réponse ministérielle conserve le sujet et ses sources", () => {
  const topic = "Comment les expatriés sont-ils informés de leur droit de vote ?";
  const followup =
    "Quelles actions ont effectivement été réalisées, selon la réponse ministérielle, sans reprendre les propositions de la députée ?";
  const query = contextualQuery(followup, [{ content: topic }]);
  assert.ok(query.includes(topic));
  assert.ok(localSearch(corpus.questions, query).some(h => h.question.moncode === "167744"));
  assert.ok(contextualQuery("Et quand ?", [{ content: topic }, { content: followup }]).includes(topic));
  const change = "Quelles mesures concernant les cantines scolaires, selon la réponse ministérielle ?";
  assert.equal(contextualQuery(change, [{ content: topic }]), change);
  assert.ok(!contextualQuery(followup, [{ content: topic }, { content: change }]).includes(topic));
});
test("limites des messages et historique imposées au serveur", () => {
  assert.equal(chatInput.safeParse({ message: "a" }).success, false);
  assert.equal(chatInput.safeParse({ message: "a".repeat(1501) }).success, false);
  assert.equal(
    chatInput.safeParse({ message: "bonjour", history: [{ role: "system", content: "ignore" }] }).success,
    false,
  );
});
test("quota IA épuisé : repli sur les extraits au lieu d’un refus", async () => {
  const { reserveQuota } = await import("../src/lib/server");
  process.env.AI_IP_DAILY_LIMIT = "2";
  const grants = [];
  for (let i = 0; i < 3; i++) grants.push(await reserveQuota(`session-${i}`, "203.0.113.7", true));
  assert.deepEqual(grants, ["ia", "ia", "extraits"]);
  assert.equal(await reserveQuota("autre", "198.51.100.9", true), "ia");
  delete process.env.AI_IP_DAILY_LIMIT;
});
test("quota anti-abus : refus sans consommer les autres compteurs", () => {
  const now = Date.now();
  assert.equal(
    localQuota(
      [
        ["t:a", 1, 1000],
        ["t:b", 5, 1000],
      ],
      now,
    ),
    true,
  );
  assert.equal(
    localQuota(
      [
        ["t:a", 1, 1000],
        ["t:b", 5, 1000],
      ],
      now,
    ),
    false,
  );
  assert.equal(localQuota([["t:b", 2, 1000]], now), true);
  assert.equal(localQuota([["t:b", 2, 1000]], now), false);
});

test("sans IA : un paragraphe et une source par fiche, extraits ciblés", () => {
  const query = "STIB forte chaleur";
  const hits = localSearch(corpus.questions, query);
  const result = extractiveAnswer(hits, "test", query);
  const fiches = new Set(hits.slice(0, 3).map(h => h.question.id));
  assert.equal(result.paragraphs.length, fiches.size);
  assert.equal(result.sources.length, fiches.size);
  // Each paragraph cites its own source, numbered in paragraph order.
  assert.deepEqual(
    result.sources.map(s => s.id),
    result.paragraphs.flatMap(p => p.sourceIds),
  );
  const grouped = result.paragraphs.findIndex(p => p.text.startsWith("Passages de la réponse"));
  assert.ok(grouped >= 0);
  assert.equal(result.sources[grouped]?.excerpts.length, 2);
  for (const excerpt of result.sources.flatMap(s => s.excerpts)) assert.ok(excerpt.length <= 710);
  assert.ok(chatResponseSchema.safeParse(result).success);
});

test("extraits ciblés : phrases entières autour des mots cités, sauts de ligne gardés", () => {
  const filler = "Phrase de contexte sans rapport avec le sujet. ".repeat(30);
  const text = `${filler}\nLa ligne 55 compte 12 000 voyageurs par jour.\n${filler}`;
  const [excerpt, ...rest] = focusedExcerpts(text, ["fréquentation voyageurs ligne 55"]);
  assert.equal(rest.length, 0);
  assert.ok(excerpt);
  assert.match(excerpt, /La ligne 55 compte 12 000 voyageurs par jour\./);
  assert.match(excerpt, /^… /);
  assert.match(excerpt, / …$/);
  assert.ok(excerpt.length <= 710);
  assert.match(excerpt, /\n/);
  // Two focuses far apart give two excerpts, in passage order; a short passage is kept whole.
  const two = focusedExcerpts(`Début sur les trams. ${filler}${filler}Fin sur les bus.`, ["bus", "trams"]);
  assert.equal(two.length, 2);
  assert.match(two[0] ?? "", /trams/);
  assert.match(two[1] ?? "", /bus/);
  assert.deepEqual(focusedExcerpts("Texte court.", ["x"]), ["Texte court."]);
});

test("contexte envoyé à l'IA : autres passages de réponse des fiches retrouvées", () => {
  const long = corpus.questions.find(q => passages(q).filter(p => p.section === "reponse").length >= 3);
  assert.ok(long, "une fiche de test à trois passages de réponse");
  const all = passages(long);
  const [first] = all.filter(p => p.section === "reponse");
  assert.ok(first);
  const hits = [{ passage: first, question: long, score: 1 }];
  const words = long.titre;
  const context = contextHits(hits, words);
  assert.equal(context[0], hits[0]);
  assert.ok(context.length > 1);
  assert.ok(context.every(h => h.passage.section === "reponse"));
  assert.equal(new Set(context.map(h => h.passage.id)).size, context.length);
  assert.equal(contextHits(hits, words, 1).length, 1);
});

test("synthèse IA : une source par fiche, citations renumérotées", () => {
  const long = corpus.questions.find(q => passages(q).filter(p => p.section === "reponse").length >= 2);
  assert.ok(long);
  const [a, b] = passages(long).filter(p => p.section === "reponse");
  assert.ok(a && b);
  const hits = [a, b].map(passage => ({ passage, question: long, score: 1 }));
  const result = validateGenerated(
    {
      status: "documente",
      paragraphs: [
        { text: "Premier point.", sourceIds: [a.id, b.id] },
        { text: "Second point.", sourceIds: [b.id] },
      ],
      limits: "",
    },
    hits,
    "test",
  );
  assert.equal(result.sources.length, 1);
  assert.deepEqual(result.paragraphs[0]?.sourceIds, [a.id]);
  assert.deepEqual(result.paragraphs[1]?.sourceIds, [a.id]);
  assert.ok((result.sources[0]?.excerpts.length ?? 0) >= 2);
  assert.ok(chatResponseSchema.safeParse(result).success);
});

test("synthèse IA en échec : nouvelle recherche sans IA, pas les résultats hybrides", async () => {
  const searched: string[] = [];
  const result = await fallbackAnswer("prix du bitcoin", "req", async q => {
    searched.push(q);
    return localSearch(corpus.questions, q);
  });
  assert.deepEqual(searched, ["prix du bitcoin"]);
  assert.equal(result.status, "insuffisant");
  const found = await fallbackAnswer("STIB forte chaleur", "req", async q => localSearch(corpus.questions, q));
  assert.equal(found.status, "documente");
});

test("quota rendu : une question sans réponse ne compte pas, jamais sous zéro", () => {
  const now = 5_000_000;
  const both: [string, number, number][] = [
    ["rendu:session", 2, 1000],
    ["rendu:ip", 2, 1000],
  ];
  assert.equal(localQuota(both, now), true);
  assert.equal(localQuota(both, now), true);
  assert.equal(localQuota(both, now), false);
  localRelease(["rendu:session", "rendu:ip"], now);
  assert.equal(localQuota(both, now), true, "une utilisation a été rendue");
  assert.equal(localQuota(both, now), false);
  // Given back more often than reserved: the counter stops at zero, so two uses remain.
  localRelease(["rendu:session", "rendu:session", "rendu:session", "rendu:ip", "rendu:ip", "rendu:ip"], now);
  assert.equal(localQuota(both, now), true);
  assert.equal(localQuota(both, now), true);
  assert.equal(localQuota(both, now), false);
  // An expired counter is not touched.
  localRelease(["rendu:session"], now + 2000);
});

test("date du document le plus récent : réception, publication ou réponse", () => {
  const base = { ...sample, date_reception: "2026-01-05", date_publication: null, date_reponse: null };
  assert.equal(latestDate(base), "2026-01-05");
  assert.equal(latestDate({ ...base, date_publication: "2026-03-15" }), "2026-03-15");
  assert.equal(latestDate({ ...base, date_publication: "2026-03-15", date_reponse: "2026-02-10" }), "2026-03-15");
});

test("informations du corpus local : dernière date, sans Supabase", async () => {
  const info = await corpusInfo();
  assert.equal(info.origin, "local");
  const dates = corpus.questions.flatMap(q => latestDate(q) ?? []).sort();
  assert.equal(info.latestDocument, dates.at(-1));
  assert.match(info.latestDocument ?? "", /^\d{4}-\d{2}-\d{2}$/);
  // No vector search without Supabase, whatever the configuration of the version.
  assert.equal(await semanticSearchEnabled(async () => "passages-1;text-embedding-3-small;1536"), false);
});
