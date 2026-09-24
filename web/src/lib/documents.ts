import { corpusSchema, type Question, type Nature, type Passage, type Hit, type Source } from "./schema";

export function safeSourceUrl(value: string) {
  const url = new URL(value);
  if (
    !["www.parlement.brussels", "parlement.brussels", "weblex.brussels"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("Source non officielle");
  url.protocol = "https:";
  return url.toString();
}
export function validateCorpus(raw: unknown) {
  const corpus = corpusSchema.parse(raw);
  if (corpus.nombre_elements !== corpus.questions.length) throw new Error("Décompte incohérent");
  const ids = corpus.questions.map(q => `${q.base}:${q.moncode}:${q.langue}`);
  if (new Set(ids).size !== ids.length || new Set(corpus.questions.map(q => q.id)).size !== ids.length)
    throw new Error("Identifiants en double");
  for (const q of corpus.questions) q.url_source = safeSourceUrl(q.url_source);
  return corpus;
}
export function nature(q: Question): Nature {
  if (!q.reponse?.trim()) return "absente";
  if (
    /aucune des questions ne relève|ne relève(?:nt)? pas de (?:ma|la) compétence|adresser toutes vos questions à ma collègue/i.test(
      q.reponse,
    )
  )
    return "incompetence";
  if (q.reponse.length < 600 && /renvoie|réponse à la question/i.test(q.reponse)) return "renvoi";
  return "fond";
}
// Paragraph boundaries are preserved; very long paragraphs are split on words.
export function splitText(text: string, max = 2200): string[] {
  const parts: string[] = [];
  let current = "";
  for (const paragraph of text.split(/\n+/).filter(Boolean)) {
    if (current && current.length + paragraph.length + 1 > max) {
      parts.push(current);
      current = "";
    }
    if (paragraph.length <= max) {
      current += (current ? "\n" : "") + paragraph;
      continue;
    }
    for (const word of paragraph.split(/\s+/)) {
      if (current && current.length + word.length + 1 > max) {
        parts.push(current);
        current = "";
      }
      current += (current ? " " : "") + word;
    }
  }
  if (current) parts.push(current);
  return parts;
}
export function passages(q: Question): Passage[] {
  return (["question", "reponse"] as const).flatMap(section =>
    splitText(q[section] || "").map((text, order) => ({
      id: `${q.id}:${section}:${order}`,
      questionId: q.id,
      section,
      text,
      order,
    })),
  );
}
export function toSource(hit: Hit): Source {
  return {
    id: hit.passage.id,
    title: hit.question.titre,
    author: hit.question.auteur,
    recipient: hit.question.destinataire,
    date: hit.question.date_reponse,
    url: safeSourceUrl(hit.question.url_source),
    excerpt: hit.passage.text,
    nature: nature(hit.question),
  };
}
