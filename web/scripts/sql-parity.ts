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
  const words = new Map<string, string>();
  for (const q of questions) {
    for (const w of new Set(tokens(`${q.titre} ${q.auteur} ${q.question} ${q.reponse ?? ""}`))) {
      everywhere.set(w, (everywhere.get(w) ?? 0) + 1);
    }
    // The word as written (what a user types), counted by root (what the searches compare).
    for (const w of new Set(normalize(q.titre).match(/[a-z]{5,}/g) ?? [])) {
      const root = tokens(w)[0];
      if (!root || !q.reponse?.trim()) continue;
      owners.set(root, (owners.get(root) ?? new Set()).add(q.moncode));
      words.set(root, w);
    }
  }
  const candidates = [...owners]
    .filter(([w, set]) => set.size === 1 && everywhere.get(w) === 1)
    .map(([root, set]) => ({ word: words.get(root) as string, moncode: [...set][0] as string }))
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
