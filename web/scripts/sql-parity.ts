import type { Question } from "../src/lib/schema";
import { normalize, tokens } from "../src/lib/search";

// Pure helpers of the SQL parity check: kept free of database and file access so
// that tests/sql-parity.test.ts can pin them.

/** Model name recorded on the substitute vectors: they carry no meaning. */
export const SUBSTITUTE_MODEL = "parity-md5";

/** Value of a text column in COPY ... FROM STDIN (text format): \N for null, backslash escapes. */
export function copyField(value: string | number | null): string {
  if (value === null) return "\\N";
  return String(value).replace(
    /[\\\t\n\r]/g,
    c => ({ "\\": "\\\\", "\t": "\\t", "\n": "\\n", "\r": "\\r" })[c] as string,
  );
}

export function copyRow(values: (string | number | null)[]): string {
  return values.map(copyField).join("\t");
}

/** Deterministic generator (mulberry32): the same seed always gives the same queries. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Words of the titles (accent-free, at least 4 letters), sorted so the order never depends on the corpus order. */
export function titleVocabulary(questions: readonly Question[]): string[] {
  const words = new Set<string>();
  for (const q of questions) for (const w of normalize(q.titre).match(/[a-z]{4,}/g) ?? []) words.add(w);
  return [...words].sort();
}

/** `count` queries of 1 to 4 distinct words drawn from the vocabulary with a fixed seed. */
export function randomQueries(vocabulary: readonly string[], count: number, seed: number): string[] {
  const random = seededRandom(seed);
  const queries: string[] = [];
  for (let i = 0; i < count; i++) {
    const size = 1 + Math.floor(random() * 4);
    const picked = new Set<string>();
    while (picked.size < Math.min(size, vocabulary.length)) {
      const word = vocabulary[Math.floor(random() * vocabulary.length)];
      if (word) picked.add(word);
    }
    queries.push([...picked].join(" "));
  }
  return queries;
}

/**
 * Words found in the title of exactly one question (and nowhere else in the
 * corpus) that has an answer: searched alone, they must bring that question back.
 */
export function rareTitleWords(questions: readonly Question[], limit: number, seed: number) {
  const owners = new Map<string, Set<string>>();
  const everywhere = new Map<string, number>();
  for (const q of questions) {
    for (const w of new Set(tokens(`${q.titre} ${q.auteur} ${q.question} ${q.reponse ?? ""}`))) {
      everywhere.set(w, (everywhere.get(w) ?? 0) + 1);
    }
    for (const w of new Set(tokens(q.titre))) {
      if (w.length < 5 || !/^[a-z]+$/.test(w) || !q.reponse?.trim()) continue;
      owners.set(w, (owners.get(w) ?? new Set()).add(q.moncode));
    }
  }
  const candidates = [...owners]
    .filter(([w, set]) => set.size === 1 && everywhere.get(w) === 1)
    .map(([word, set]) => ({ word, moncode: [...set][0] as string }))
    .sort((a, b) => a.word.localeCompare(b.word));
  const random = seededRandom(seed);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [
      candidates[j] as (typeof candidates)[number],
      candidates[i] as (typeof candidates)[number],
    ];
  }
  return candidates.slice(0, limit);
}

/**
 * A point of the unit sphere derived from the md5 of the text: reproducible, different for every
 * passage, and meaningless (the semantic scores are not compared). Created in the session that
 * uses it (pg_temp), so that the database keeps no trace.
 */
export const SUBSTITUTE_VECTOR_SQL = `
create function pg_temp.substitute_vector(t text) returns extensions.vector language sql immutable as $$
  select ('[' || string_agg(to_char(x / n, 'FM0.99999999'), ',' order by i) || ']')::extensions.vector
  from (select i, x, sqrt(sum(x * x) over ()) as n
        from (select i, (('x' || substr(md5(t || ':' || i), 1, 8))::bit(32)::int)::float8 / 2147483648.0 as x
              from generate_series(1, 1536) as i) a) b
$$;`;

export type Row = { id: string; score: number };

/** Score as compared: rounded to 6 decimals. */
export const round6 = (score: number) => Math.round(score * 1e6) / 1e6;

export type DifferenceKind =
  | "sql-vide"
  | "local-vide"
  | "premiere-question"
  | "questions"
  | "passages"
  | "ordre"
  | "scores"
  | "attendu";
export type Difference = { kind: DifferenceKind; detail: string };

const questionOf = (id: string) => id.split(":reponse:")[0]?.split(":question:")[0] ?? id;
const distinct = (ids: string[]) => [...new Set(ids.map(questionOf))];

/**
 * Same passage identifiers in the same order, then the same scores to 6 decimals. A difference is
 * given its most specific kind: one side empty, another first question, other questions, other
 * passages of the same questions, same passages in another order.
 */
export function compareRows(local: Row[], sql: Row[]): Difference[] {
  const differences: Difference[] = [];
  const a = local.map(r => r.id);
  const b = sql.map(r => r.id);
  if (a.length !== b.length || a.some((id, i) => id !== b[i])) {
    const detail = `local ${JSON.stringify(a)} ≠ SQL ${JSON.stringify(b)}`;
    const [lq, sq] = [distinct(a), distinct(b)];
    let kind: DifferenceKind;
    if (!b.length) kind = "sql-vide";
    else if (!a.length) kind = "local-vide";
    else if (lq[0] !== sq[0]) kind = "premiere-question";
    else if (lq.length !== sq.length || lq.some((q, i) => q !== sq[i])) kind = "questions";
    else if ([...a].sort().join() !== [...b].sort().join()) kind = "passages";
    else kind = "ordre";
    differences.push({ kind, detail });
    return differences;
  }
  local.forEach((row, i) => {
    const other = sql[i] as Row;
    if (round6(row.score) !== round6(other.score)) {
      differences.push({
        kind: "scores",
        detail: `${row.id} : local ${round6(row.score)} ≠ SQL ${round6(other.score)}`,
      });
    }
  });
  return differences;
}

export type SqlRow = Row & { question_id: string };

/**
 * Differences the migrations document, by kind. A known kind is reported without failing the check, but
 * only while the documented property holds (see documentedProblem): a SQL that stops doing what its
 * migration says fails. Every other kind fails. Add a kind only for a difference that is documented.
 */
export const KNOWN_KINDS: Partial<Record<DifferenceKind, string>> = {
  scores:
    "documenté par 006 : la SQL renvoie un rang fusionné (RRF, 1/(60+rang), commun aux passages d'une fiche), " +
    "le local une somme d'IDF ; les valeurs ne se comparent pas",
  ordre:
    "documenté par 007 : la SQL place les deux passages de la première fiche, puis le meilleur de chacune des " +
    "suivantes, puis leurs seconds passages ; le local trie par score",
};

/** Reciprocal-rank-fusion score as 006 computes it without a vector: 1 / (60 + rank), rank >= 1. */
export function rrfRank(score: number): number | null {
  const rank = 1 / score - 60;
  return Math.abs(rank - Math.round(rank)) < 1e-6 && Math.round(rank) >= 1 ? Math.round(rank) : null;
}

/**
 * Checks, on the rows the SQL returned, the property that documents a known kind. Returns the problem,
 * or null when the documented behaviour holds.
 * - scores (006): every score is 1/(60+rank), the passages of one question share it, and the questions,
 *   in order of first appearance, never rise in score.
 * - ordre (007): the first question comes first (two passages at most), then every other question once,
 *   and only then second passages.
 */
export function documentedProblem(kind: DifferenceKind, rows: readonly SqlRow[]): string | null {
  if (kind === "scores") {
    const byQuestion = new Map<string, number>();
    let previous = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      if (rrfRank(row.score) === null) return `score ${round6(row.score)} de ${row.id} : pas de la forme 1/(60+rang)`;
      const known = byQuestion.get(row.question_id);
      if (known !== undefined && round6(known) !== round6(row.score))
        return `${row.question_id} : scores différents entre ses passages`;
      if (known === undefined) {
        if (row.score > previous + 1e-12)
          return `${row.question_id} : score plus élevé que celui d'une fiche mieux classée`;
        previous = row.score;
        byQuestion.set(row.question_id, row.score);
      }
    }
    return null;
  }
  if (kind === "ordre") {
    const counts = new Map<string, number>();
    let secondPassages = false;
    rows.forEach(row => {
      counts.set(row.question_id, (counts.get(row.question_id) ?? 0) + 1);
    });
    const first = rows[0]?.question_id;
    const seen = new Set<string>();
    let index = 0;
    // The first question's passages open the list.
    while (index < rows.length && rows[index]?.question_id === first) seen.add(rows[index++]?.question_id as string);
    for (; index < rows.length; index++) {
      const question = (rows[index] as SqlRow).question_id;
      if (question === first) return `${first} : un passage de la première fiche après d'autres fiches`;
      if (seen.has(question)) secondPassages = true;
      else if (secondPassages) return `${question} : un premier passage après des seconds passages`;
      else seen.add(question);
    }
    for (const [question, count] of counts) if (count > 2) return `${question} : plus de deux passages`;
    return null;
  }
  return null;
}
