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
/**
 * The parts of a passage that bear on each focus (the question, or each
 * paragraph citing it), in passage order: whole sentences, at most about
 * `max` characters each, « … » where cut. Overlapping parts are merged and
 * line breaks are kept.
 */
export function focusedExcerpts(text: string, focuses: string[], max = 700): string[] {
  const clean = text.replace(/[ \t]+/g, " ").trim();
  // A stored passage can itself start mid-sentence (lowercase): mark it too.
  const cutBefore = (excerpt: string) => /^\p{Ll}/u.test(excerpt);
  if (clean.length <= max) return [cutBefore(clean) ? `… ${clean}` : clean];
  // Sentences; a long run without punctuation (a list) is cut between words.
  const pieces: string[] = [];
  for (const sentence of clean.match(/[^.!?;:]*[.!?;:]+\s*|[^.!?;:]+/g) ?? [clean]) {
    let current = "";
    for (const word of sentence.split(/(?<=\s)/)) {
      if (current && current.length + word.length > 250) {
        pieces.push(current);
        current = "";
      }
      current += word;
    }
    if (current) pieces.push(current);
  }
  const pieceTerms = pieces.map(piece => tokens(piece));
  const windows = (focuses.length ? focuses : [""]).map(focus => {
    const wanted = new Set(tokens(focus));
    const matches = pieceTerms.map(terms => terms.filter(t => wanted.has(t)).length);
    // From the most relevant piece, grow towards the more relevant neighbour.
    let start = matches.indexOf(Math.max(...matches));
    let end = start + 1;
    let length = pieces[start]?.length ?? 0;
    for (;;) {
      const before = pieces[start - 1];
      const after = pieces[end];
      const canBefore = before !== undefined && length + before.length <= max;
      const canAfter = after !== undefined && length + after.length <= max;
      if (!canBefore && !canAfter) break;
      if (canBefore && (!canAfter || (matches[start - 1] ?? 0) > (matches[end] ?? 0))) {
        start--;
        length += before.length;
      } else {
        end++;
        length += after?.length ?? 0;
      }
    }
    return [start, end] as [number, number];
  });
  const merged: [number, number][] = [];
  for (const [start, end] of windows.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged.map(([start, end]) => {
    const excerpt = pieces.slice(start, end).join("").trim();
    return `${start > 0 || cutBefore(excerpt) ? "… " : ""}${excerpt}${end < pieces.length ? " …" : ""}`;
  });
}
/**
 * Passages given to the model: the hits, then other answer passages of the
 * same questions that mention the query. The search returns at most two
 * passages per question, while a long ministerial answer often gives its
 * figures in another one; the MP's question adds words, not facts, and is
 * skipped. One more passage per question in turn, best questions first; the
 * three best may get three.
 */
export function contextHits(hits: Hit[], query: string, limit = 12): Hit[] {
  const wanted = new Set(tokens(expanded(query)));
  const seen = new Set(hits.map(hit => hit.passage.id));
  const candidates = [...new Map(hits.map(hit => [hit.question.id, hit])).values()].map(hit => ({
    hit,
    extra: passages(hit.question).filter(
      passage =>
        !seen.has(passage.id) && passage.section === "reponse" && tokens(passage.text).some(t => wanted.has(t)),
    ),
  }));
  const result = [...hits];
  for (let round = 0; round < 3; round++) {
    for (const [rank, { hit, extra }] of candidates.entries()) {
      const passage = extra[round];
      if (!passage || (round > 0 && rank >= 3)) continue;
      if (result.length >= limit) return result;
      result.push({ passage, question: hit.question, score: hit.score });
    }
  }
  return result;
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
