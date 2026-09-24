import { passages } from "./documents";
import type { Hit, Passage, Question } from "./schema";

const stop = new Set(
  "a au aux avec ce ces c cette dans de des du d en et est faire fait il ils elle elles je la le les l leur lui mais me mes mon ne nos nous on ou par pas pour pourquoi qu que quel quelle quels quelles qui quoi sa se ses son sont sur t ta te tes tout tous tu un une vos votre vous y plus comme comment peut peux peuvent etre avoir ai information informations dit dire sait savoir pouvez concernant question reponse merci moi donne donner".split(
    " ",
  ),
);
export function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
export function tokens(s: string): string[] {
  return [
    ...new Set(
      (normalize(s).match(/[a-z0-9]{2,}/g) || [])
        .filter(w => !stop.has(w))
        .map(w => (w.length > 4 ? w.replace(/s$/, "") : w)),
    ),
  ];
}
// Match on the normalized text: without the u flag, \b treats accented
// letters as word boundaries, so /\bélection/ never matched.
function expanded(s: string) {
  const n = normalize(s);
  return (
    s +
    (/\b(chaud|chaleurs?|canicule)\b/.test(n) ? " chaleur canicule climatisation conditionné" : "") +
    (/\b(bus|trams?|metros?)\b/.test(n) ? " STIB transports" : "") +
    (/\b(voter?|elections?)\b/.test(n) ? " élections électoral inscription" : "")
  );
}
const queryGeneric = new Set(["mesure", "action", "prevu", "prevoit", "realisee", "effectivement", "informe"]);
const filterGeneric = new Set(
  "mesure action prevu prevoit realisee effectivement informe selon ministerielle ministre deputee proposition reprendre sans ete ont cas forte fort".split(
    " ",
  ),
);
export function lexicalQuery(query: string) {
  // websearch_to_tsquery otherwise requires every word of a natural-language
  // question to occur together, including wording absent from the source.
  return tokens(expanded(query))
    .filter(term => !queryGeneric.has(term))
    .slice(0, 40)
    .join(" OR ");
}
// Tokenizing a whole question is the costly step: cache it per question object.
const documentTermsCache = new WeakMap<Question, Set<string>>();
function documentTerms(q: Question) {
  let terms = documentTermsCache.get(q);
  if (!terms) {
    terms = new Set(tokens(`${q.titre} ${q.question} ${q.reponse || ""}`));
    documentTermsCache.set(q, terms);
  }
  return terms;
}
export function filterLexicalHits(hits: Hit[], query: string): Hit[] {
  const terms = tokens(query).filter(t => !filterGeneric.has(t));
  if (!terms.length) return [];
  return hits.filter(hit => {
    // A shared generic word (e.g. 'scolaire') alone must not make a document
    // about another topic look like an answer about school canteens.
    const document = documentTerms(hit.question);
    const matched = terms.filter(t => document.has(t)).length;
    return hit.passage.section === "reponse" && matched / terms.length >= 0.6;
  });
}
export function contextualQuery(message: string, history: { content: string }[]) {
  const isFollowup = (text: string) => {
    const normalized = normalize(text.trim());
    // An explicitly named new topic takes precedence over a reference to a minister.
    if (/\b(concernant|au sujet de|a propos de|sur le sujet de)\b/.test(normalized)) return false;
    const shortFollowup =
      /^(et\b|pourquoi\b|combien\b|quand\b|cela\b|ca\b|ceux\b|celles\b)/.test(normalized) && tokens(text).length < 5;
    const sourceFollowup =
      /\b(selon|dans|d'apres) la reponse (ministerielle|du ministre|de la ministre|de la secretaire)\b|\b(sans reprendre|sans inclure) les propositions\b|\b(ces|lesdites) (actions|mesures|propositions)\b/.test(
        normalized,
      );
    return shortFollowup || sourceFollowup;
  };
  if (!isFollowup(message) || !history.length) return message;
  const context: string[] = [];
  for (const { content } of history.slice(-4).reverse()) {
    context.unshift(content);
    if (!isFollowup(content)) break;
  }
  return [...context, message].join(" ");
}
type IndexedDocument = {
  q: Question;
  passages: { passage: Passage; terms: Set<string> }[];
  all: Set<string>;
  title: Set<string>;
};
type SearchIndex = { documents: IndexedDocument[]; documentFrequency: Map<string, number> };
// The corpus is immutable once loaded: tokenize it once per questions array
// instead of on every query.
const indexes = new WeakMap<readonly Question[], SearchIndex>();
function searchIndex(questions: readonly Question[]): SearchIndex {
  const cached = indexes.get(questions);
  if (cached) return cached;
  const documentFrequency = new Map<string, number>();
  const documents = questions.map(q => {
    const all = new Set(tokens(`${q.titre} ${q.auteur} ${q.question} ${q.reponse || ""}`));
    for (const term of all) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    return {
      q,
      passages: passages(q).map(passage => ({ passage, terms: new Set(tokens(passage.text)) })),
      all,
      title: new Set(tokens(`${q.titre} ${q.auteur}`)),
    };
  });
  const index = { documents, documentFrequency };
  indexes.set(questions, index);
  return index;
}
export function localSearch(questions: readonly Question[], query: string, limit = 6): Hit[] {
  const terms = tokens(expanded(query));
  const original = tokens(query);
  if (!original.length) return [];
  const { documents, documentFrequency } = searchIndex(questions);
  const idf = (term: string) => Math.log(1 + documents.length / (1 + (documentFrequency.get(term) ?? 0)));
  const ranked = documents
    .map(doc => {
      if (!original.some(t => doc.all.has(t))) return { doc, score: 0 };
      const score =
        terms.reduce((n, t) => n + (doc.all.has(t) ? idf(t) * (doc.title.has(t) ? 3 : 1) : 0), 0) /
        Math.sqrt(terms.length);
      return { doc, score };
    })
    .filter(d => d.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top) return [];
  const results: Hit[] = [];
  for (const { doc, score } of ranked.filter(d => d.score >= top.score * 0.42).slice(0, 3)) {
    const answers = doc.passages.filter(p => p.passage.section === "reponse");
    const pool = answers.length ? answers : doc.passages;
    const best = pool
      .map(p => ({
        passage: p.passage,
        question: doc.q,
        score: score + terms.filter(t => p.terms.has(t)).reduce((n, t) => n + idf(t), 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    results.push(...best);
  }
  return filterLexicalHits(
    results.sort((a, b) => b.score - a.score),
    query,
  ).slice(0, limit);
}
