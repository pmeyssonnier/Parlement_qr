import type { Question, Hit } from "./schema";
import { passages } from "./documents";

const stop = new Set("a au aux avec ce ces c cette dans de des du d en et est faire fait il ils elle elles je la le les l leur lui mais me mes mon ne nos nous on ou par pas pour pourquoi qu que quel quelle quels quelles qui quoi sa se ses son sont sur t ta te tes tout tous tu un une vos votre vous y plus comme comment peut peux peuvent etre avoir ai information informations dit dire sait savoir pouvez concernant question reponse merci moi donne donner".split(" "));
export function normalize(s: string) { return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase(); }
export function tokens(s: string): string[] {
  return [...new Set((normalize(s).match(/[a-z0-9]{2,}/g) || []).filter(w => !stop.has(w)).map(w => w.length > 4 ? w.replace(/s$/, "") : w))];
}
function expanded(s: string) {
  return s + (/\b(chaud|chaleur|chaleurs|canicule)\b/i.test(s) ? " chaleur canicule climatisation conditionné" : "")
    + (/\b(bus|tram|trams|métro|metro|métros|metros)\b/i.test(s) ? " STIB transports" : "")
    + (/\b(voter|vote|élection|election)\b/i.test(s) ? " élections électoral inscription" : "");
}
export function contextualQuery(message: string, history: { content: string }[]) {
  const followup = /^(et\b|pourquoi\b|combien\b|quand\b|cela\b|ça\b|ceux\b|celles\b)/i.test(message.trim()) && tokens(message).length < 5;
  return followup && history.length ? `${history.at(-1)!.content} ${message}` : message;
}
export function localSearch(questions: Question[], query: string, limit = 6): Hit[] {
  const terms = tokens(expanded(query));
  const original = tokens(query);
  if (!original.length) return [];
  const docs = questions.map(q => ({ q, ps: passages(q), all: new Set(tokens(`${q.titre} ${q.auteur} ${q.question} ${q.reponse || ""}`)) }));
  const idf = (term: string) => Math.log(1 + docs.length / (1 + docs.filter(d => d.all.has(term)).length));
  const ranked = docs.map(({ q, ps, all }) => {
    const title = new Set(tokens(`${q.titre} ${q.auteur}`));
    const exact = original.filter(t => all.has(t));
    if (!exact.length) return { q, ps, score: 0 };
    const score = terms.reduce((n, t) => n + (all.has(t) ? idf(t) * (title.has(t) ? 3 : 1) : 0), 0) / Math.sqrt(terms.length);
    return { q, ps, score };
  }).filter(d => d.score >= 0.5).sort((a, b) => b.score - a.score);
  if (!ranked.length) return [];
  const results: Hit[] = [];
  for (const doc of ranked.filter(d => d.score >= ranked[0].score * 0.42).slice(0, 3)) {
    const answers = doc.ps.filter(p => p.section === "reponse");
    const pool = answers.length ? answers : doc.ps;
    const best = pool.map(p => ({ passage: p, question: doc.q, score: doc.score + terms.filter(t => new Set(tokens(p.text)).has(t)).reduce((n, t) => n + idf(t), 0) })).sort((a, b) => b.score - a.score).slice(0, 2);
    results.push(...best);
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
