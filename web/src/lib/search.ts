import { newStemmer } from "snowball-stemmers";
import { passages, searchText } from "./documents";
import type { Hit, Passage, Question } from "./schema";

const stop = new Set(
  "a au aux avec ce ces c cette dans de des du d en et est faire fait il ils elle elles je la le les l leur lui mais me mes mon ne nos nous on ou par pas pour pourquoi qu que quel quelle quels quelles qui quoi sa se ses son sont sur t ta te tes tout tous tu un une vos votre vous y plus comme comment peut peux peuvent etre avoir ai information informations dit dire sait savoir pouvez concernant question reponse merci moi donne donner".split(
    " ",
  ),
);
export function normalize(s: string) {
  return (
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      // Ligatures do not decompose: « œuvre » must read « oeuvre », as search_passages (fold_accents) does.
      .replace(/œ/g, "oe")
      .replace(/æ/g, "ae")
  );
}
/** Words of a text: accent-free, lowercase, without stop words, as written. */
function words(s: string): string[] {
  return (normalize(s).match(/[a-z0-9]{2,}/g) || []).filter(w => !stop.has(w));
}
const french = newStemmer("french");
const roots = new Map<string, string>();
/**
 * The root of a word, as PostgreSQL's French configuration computes it (Snowball), so that the local
 * search and search_passages match the same words. Words starting with a digit (« 2eme ») stay as they are.
 */
function stem(w: string) {
  let root = roots.get(w);
  if (root === undefined) {
    root = /^\d/.test(w) ? w : french.stem(w);
    roots.set(w, root);
  }
  return root;
}
// PostgreSQL's French stop list (tsearch_data/french.stop), without the accented entries, which
// never match: search_passages folds accents before indexing.
const postgresStop = new Set(
  "au aux avec ce ces dans de des du elle en et eux il je la le leur lui ma mais me mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous suis es est sommes sont serai seras sera serons serez seront serais serait serions seriez seraient fus fut furent sois soit soyons soyez soient fusse fusses fussions fussiez fussent ayant ayante ayantes ayants eu eue eues eus ai as avons avez ont aurai auras aura aurons aurez auront aurais aurait aurions auriez auraient avais avait avions aviez avaient eut eurent aie aies ait ayons ayez aient eusse eusses eussions eussiez eussent".split(
    " ",
  ),
);
/**
 * Roots of the words of a text as search_passages indexes them: without PostgreSQL's own stop words,
 * but with the application's (« concernant », for one, is indexed and matches a query word of the same root).
 */
function indexedRoots(s: string): string[] {
  // PostgreSQL's parser reads « vélos/trottinettes » or « /vélos » as one file name: its words are not
  // indexed on their own. (Other compound tokens, URLs and e-mail addresses are not reproduced.)
  const text = normalize(s).replace(/\/?[a-z0-9]+(?:\/[a-z0-9]+)+|\/[a-z0-9]+/g, " ");
  return (text.match(/[a-z0-9]{2,}/g) || []).filter(w => !postgresStop.has(w)).map(stem);
}
export function tokens(s: string): string[] {
  return [...new Set(words(s).map(stem))];
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
// Generic words are listed as written and compared by root, like the terms they are compared with.
const queryGeneric = new Set(
  ["mesure", "action", "prevu", "prevoit", "realisee", "effectivement", "informe"].map(stem),
);
const filterGeneric = new Set(
  "mesure action prevu prevoit realisee effectivement informe selon ministerielle ministre deputee proposition reprendre sans ete ont cas forte fort"
    .split(" ")
    .map(stem),
);
/** The query terms search_passages scores: one per root, in the order written, with the word as written. */
function lexicalTerms(query: string): [term: string, word: string][] {
  const terms = new Map<string, string>();
  for (const word of words(expanded(query))) if (!terms.has(stem(word))) terms.set(stem(word), word);
  return [...terms].filter(([term]) => !queryGeneric.has(term)).slice(0, 40);
}
export function lexicalQuery(query: string) {
  // websearch_to_tsquery otherwise requires every word of a natural-language
  // question to occur together, including wording absent from the source.
  // The terms are the same as tokens() selects, but sent as written: search_passages
  // stems them itself (PostgreSQL's French stemmer), and stemming a word the local
  // search has already shortened gives another root (« terminus » → « terminu » no
  // longer matches « terminus », nor « bruxellois », « usagers », « processus »…).
  return lexicalTerms(query)
    .map(([, word]) => word)
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
// The local search follows search_passages (migration 007), the search of production:
// the same documents, terms, weights, selection and order, so that the two answer alike.
// The roots are PostgreSQL's too (Snowball French).
type IndexedDocument = {
  q: Question;
  passages: { passage: Passage; terms: Set<string>; roots: string[] }[];
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
  const documents: IndexedDocument[] = [];
  for (const q of questions) {
    const own = passages(q);
    // Only questions with an answer passage are searched.
    if (!own.some(p => p.section === "reponse")) continue;
    // What is indexed is each passage's search text: title, author, recipient and the passage itself.
    const indexed = own.map(passage => ({
      passage,
      terms: new Set(indexedRoots(searchText(q, passage))),
      // Every word of the passage text, by root, in order: ts_rank_cd counts their occurrences.
      roots: indexedRoots(passage.text),
    }));
    const all = new Set(indexed.flatMap(p => [...p.terms]));
    for (const term of all) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    documents.push({ q, passages: indexed, all, title: new Set(indexedRoots(q.titre)) });
  }
  const index = { documents, documentFrequency };
  indexes.set(questions, index);
  return index;
}
function compareIds(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function localSearch(questions: readonly Question[], query: string, limit = 6): Hit[] {
  const terms = lexicalTerms(query).map(([term]) => term);
  if (!terms.length) return [];
  const wanted = new Set(terms);
  const { documents, documentFrequency } = searchIndex(questions);
  const idf = (term: string) => Math.log(1 + documents.length / (1 + (documentFrequency.get(term) ?? 0)));
  const lexical = documents
    .map(doc => ({
      doc,
      score:
        terms.reduce((n, t) => n + (doc.all.has(t) ? idf(t) * (doc.title.has(t) ? 3 : 1) : 0), 0) /
        Math.sqrt(terms.length),
    }))
    .filter(d => d.score > 0);
  // Rank fusion as in SQL, without a vector: 1 / (60 + rank), ties sharing the rank (rank()).
  const max = Math.max(1, Math.min(limit, 8));
  const selected = lexical
    .map(({ doc, score }) => {
      const rank = 1 + lexical.filter(other => other.score > score + 1e-9).length;
      return { doc, fused: 1 / (60 + rank), leader: rank === 1 };
    })
    .sort((a, b) => Number(b.leader) - Number(a.leader) || b.fused - a.fused || compareIds(a.doc.q.id, b.doc.q.id))
    .slice(0, max)
    .sort((a, b) => b.fused - a.fused || compareIds(a.doc.q.id, b.doc.q.id));
  const rows = selected.flatMap(({ doc, fused }, documentRank) =>
    doc.passages
      .filter(p => p.passage.section === "reponse")
      // The passages with the most occurrences of query words first, then in passage order: with
      // an OR query ts_rank_cd gives each occurrence its own cover, so its rank is their sum.
      .map(p => ({ p, matched: p.roots.filter(root => wanted.has(root)).length }))
      .sort((a, b) => b.matched - a.matched || a.p.passage.order - b.p.passage.order)
      .slice(0, 2)
      .map(({ p }, passageRank) => ({
        hit: { passage: p.passage, question: doc.q, score: fused } satisfies Hit,
        documentRank,
        passageRank,
      })),
  );
  // The two best passages of the first question, then the best passage of each following
  // question, then their second passages.
  const position = (r: (typeof rows)[number]) => (r.documentRank === 0 ? 0 : r.passageRank + 1);
  rows.sort((a, b) => position(a) - position(b) || a.documentRank - b.documentRank || a.passageRank - b.passageRank);
  return filterLexicalHits(
    rows.slice(0, max).map(r => r.hit),
    query,
  ).slice(0, limit);
}
