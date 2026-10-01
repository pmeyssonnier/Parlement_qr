// Reference questions for audit:search, on data/corpus-refreshed.json. Each case
// names the questions (moncode) that must appear among the first distinct
// questions returned; the CI replays them on the local search, without AI.

export type SearchCase = {
  /** Stable slug, used in reports. */
  id: string;
  /** titre: wording close to the title; citoyen: everyday wording; suivi: follow-up. */
  kind: "titre" | "citoyen" | "suivi" | "hors_sujet";
  question: string;
  /** Previous user questions, for follow-ups. */
  history?: string[];
  /** Any of these questions is a pass; null means no result is expected. */
  expect: string[] | null;
  /** Worst accepted rank among distinct questions (1-based). Default: DEFAULT_MAX_RANK. */
  maxRank?: number;
  /** Documented weakness: reported, but not counted as a failure. */
  gap?: string;
};

export const DEFAULT_MAX_RANK = 3;

export const searchCases: SearchCase[] = [
  // Formulations proches du titre de la fiche.
  {
    id: "expatries-vote",
    kind: "titre",
    question: "Comment les expatriés sont-ils informés de leur droit de vote ?",
    expect: ["167744"],
    maxRank: 1,
  },
  {
    id: "stib-chaleur",
    kind: "titre",
    question: "Que fait la STIB en cas de forte chaleur ?",
    expect: ["167348", "167374"],
    maxRank: 1,
  },
  {
    id: "clean-brussels",
    kind: "titre",
    question: "Que prévoit clean.brussels pour réduire les emballages ?",
    expect: ["166346"],
    maxRank: 1,
  },
  {
    id: "tram-55",
    kind: "titre",
    question: "Quelle est la fréquentation du tram 55 ?",
    expect: ["170245"],
    maxRank: 1,
  },
  {
    id: "allocation-loyer",
    kind: "titre",
    question: "Combien de ménages bénéficient de l’allocation loyer ?",
    expect: ["170157"],
    maxRank: 1,
  },
  {
    id: "bornes-recharge",
    kind: "titre",
    question: "Quelle est la puissance des bornes de recharge publiques ?",
    expect: ["170152"],
    maxRank: 1,
  },
  {
    id: "actiris-rendez-vous",
    kind: "titre",
    question: "Quel est le délai du premier rendez-vous chez Actiris ?",
    expect: ["170155"],
    maxRank: 1,
  },
  {
    id: "lez-bim",
    kind: "titre",
    question: "Quelles sont les exemptions LEZ pour les bénéficiaires BIM ?",
    expect: ["169916", "169915"],
    maxRank: 1,
  },
  {
    id: "bus-71",
    kind: "titre",
    question: "Comment évolue la fréquentation de la ligne de bus 71 ?",
    expect: ["170243"],
    maxRank: 1,
  },
  {
    id: "taxibus",
    kind: "titre",
    question: "Qu'en est-il du service Taxibus de la STIB ?",
    expect: ["169943"],
    maxRank: 1,
  },
  {
    id: "zaca",
    kind: "titre",
    question: "Quelles sont les zones à concentration d'accidents ?",
    expect: ["170127", "169937"],
  },
  {
    id: "cyclostrades",
    kind: "titre",
    question: "Les cyclostrades sont-elles raccordées au réseau cyclable ?",
    expect: ["169917"],
    maxRank: 1,
  },
  {
    id: "absenteisme",
    kind: "titre",
    question: "Quel est le taux d’absentéisme dans l’administration régionale ?",
    expect: ["170111"],
    maxRank: 1,
  },
  {
    id: "cube-bleu",
    kind: "titre",
    question: "Quels permis pour le cube bleu de la place De Brouckère ?",
    expect: ["170291"],
    maxRank: 1,
  },
  {
    id: "de-lijn",
    kind: "titre",
    question: "La réduction de l'offre de De Lijn à Bruxelles",
    expect: ["169939"],
    maxRank: 1,
  },
  {
    id: "neutralite-stib",
    kind: "titre",
    question: "Le principe de neutralité s'applique-t-il à la STIB ?",
    expect: ["170147"],
  },
  {
    id: "antinoyade",
    kind: "titre",
    question: "Le système antinoyade dans les piscines",
    expect: ["170151"],
    maxRank: 1,
  },
  {
    id: "flexi-jobs",
    kind: "titre",
    question: "Le recours aux flexi-jobs par les plus de 65 ans",
    expect: ["170121"],
    maxRank: 1,
  },
  {
    id: "elagage",
    kind: "titre",
    question: "Période d'interdiction d'élagage et d'abattage des arbres",
    expect: ["170106"],
    maxRank: 1,
  },
  {
    id: "villo",
    kind: "titre",
    question: "Que se passe-t-il après la fin du service Villo ?",
    expect: ["167067"],
    maxRank: 1,
  },
  // Formulations citoyennes, loin des mots du titre.
  {
    id: "pmr-transports",
    kind: "citoyen",
    question: "Les personnes en fauteuil roulant peuvent-elles prendre les transports publics ?",
    expect: ["169912", "169914"],
  },
  {
    id: "permis-delai",
    kind: "citoyen",
    question: "Combien de temps faut-il pour obtenir un permis d'urbanisme ?",
    expect: ["170105"],
    gap: "« combien de temps », « obtenir » absents de la fiche (« délai moyen de traitement ») : seuls les embeddings la retrouvent.",
  },
  {
    id: "velo-bureau",
    kind: "citoyen",
    question: "Où garer son vélo au bureau ?",
    expect: ["170128", "170115"],
  },
  {
    id: "pollution-hopitaux",
    kind: "citoyen",
    question: "Les hôpitaux sont-ils exposés à la pollution de l'air ?",
    expect: ["166342"],
  },
  {
    id: "animaux-refuges",
    kind: "citoyen",
    question: "Contrôle-t-on les animaux dans les refuges ?",
    expect: ["170190"],
  },
  {
    id: "securite-metro",
    kind: "citoyen",
    question: "Les entrées du métro sont-elles sûres ?",
    expect: ["170112"],
  },
  // Relances : le sujet de la question précédente est conservé.
  {
    id: "suivi-bus-71",
    kind: "suivi",
    question: "Et pourquoi ?",
    history: ["Comment évolue la fréquentation de la ligne de bus 71 ?"],
    expect: ["170243"],
    maxRank: 1,
  },
  {
    id: "suivi-expatries",
    kind: "suivi",
    question:
      "Quelles actions ont effectivement été réalisées, selon la réponse ministérielle, sans reprendre les propositions de la députée ?",
    history: ["Comment les expatriés sont-ils informés de leur droit de vote ?"],
    expect: ["167744"],
    maxRank: 1,
  },
  // Hors corpus : aucune source ne doit être proposée.
  {
    id: "hors-cantines",
    kind: "hors_sujet",
    question: "Quelles sont les mesures concernant les cantines scolaires ?",
    expect: null,
  },
  { id: "hors-espace", kind: "hors_sujet", question: "Astronautes martiens et fusées interstellaires", expect: null },
  { id: "hors-meteo", kind: "hors_sujet", question: "Météo de demain", expect: null },
  { id: "hors-bitcoin", kind: "hors_sujet", question: "Quel est le prix du bitcoin ?", expect: null },
];

export type CaseResult = {
  id: string;
  kind: SearchCase["kind"];
  question: string;
  pass: boolean;
  gap: boolean;
  /** 1-based rank of the first expected question, null if absent. */
  rank: number | null;
  ids: string[];
  /** Questions of the sources shown to the reader without AI. */
  shown?: string[];
  reason?: string;
};

/** Judges one case from the distinct question codes, in ranked order. */
export function evaluateCase(c: SearchCase, ids: string[]): CaseResult {
  const base = { id: c.id, kind: c.kind, question: c.question, gap: Boolean(c.gap), ids };
  if (c.expect === null)
    return ids.length
      ? { ...base, pass: false, rank: null, reason: "résultats pour une question hors corpus" }
      : { ...base, pass: true, rank: null };
  const expected = new Set(c.expect);
  const index = ids.findIndex(id => expected.has(id));
  const rank = index < 0 ? null : index + 1;
  const maxRank = c.maxRank ?? DEFAULT_MAX_RANK;
  if (rank === null) return { ...base, pass: false, rank, reason: "fiche attendue absente" };
  if (rank > maxRank) return { ...base, pass: false, rank, reason: `rang ${rank} au-delà de ${maxRank}` };
  return { ...base, pass: true, rank };
}

/**
 * Judges what the reader sees without AI: an expected question must also be
 * among the sources shown, and an off-topic question must show none.
 */
export function withDisplay(result: CaseResult, c: SearchCase, shown: string[]): CaseResult {
  const judged = { ...result, shown };
  if (!result.pass) return judged;
  if (c.expect === null)
    return shown.length
      ? { ...judged, pass: false, reason: "sources affichées pour une question hors corpus" }
      : judged;
  return shown.some(id => c.expect?.includes(id))
    ? judged
    : { ...judged, pass: false, reason: "fiche attendue retrouvée mais non affichée" };
}

/** Aggregate figures: failures exclude documented gaps; MRR covers cases expecting a question. */
export function summarize(results: CaseResult[]) {
  const withExpectation = results.filter(r => r.kind !== "hors_sujet");
  const reciprocal = withExpectation.map(r => (r.rank ? 1 / r.rank : 0));
  return {
    cases: results.length,
    failed: results.filter(r => !r.pass && !r.gap).length,
    knownGaps: results.filter(r => !r.pass && r.gap).length,
    resolvedGaps: results.filter(r => r.pass && r.gap).map(r => r.id),
    top1: withExpectation.filter(r => r.rank === 1).length / Math.max(withExpectation.length, 1),
    mrr: reciprocal.reduce((n, x) => n + x, 0) / Math.max(reciprocal.length, 1),
  };
}
