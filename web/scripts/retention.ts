// Inactive versions left after prune_corpus_versions, classified with the
// same rules as supabase/migrations/003_corpus_retention.sql.
export type InactiveVersion = { activated_at: string | null; activation_unknown: boolean };

const count = (n: number, singular: string, plural: string) => `${n} ${n > 1 ? plural : singular}`;

export function retentionSummary(removed: number, remaining: InactiveVersion[], keep: number): string {
  const unknown = remaining.filter(v => v.activation_unknown).length;
  const rollback = remaining.filter(v => !v.activation_unknown && v.activated_at !== null).length;
  // Never activated and not removed: created less than an hour ago.
  const recent = remaining.length - unknown - rollback;
  const kept = [
    // Not a hard cap: versions created less than an hour ago are always
    // protected, so several close imports can exceed the target.
    `${count(rollback, "version", "versions")} pour retour arrière (cible : ${keep}, hors versions récentes protégées)`,
    ...(unknown
      ? [`${count(unknown, "version antérieure", "versions antérieures")} à la migration, jamais supprimée(s)`]
      : []),
    ...(recent ? [`${count(recent, "import récent non activé", "imports récents non activés")}`] : []),
  ];
  return `Rétention : ${count(removed, "version supprimée", "versions supprimées")} ; conservé : ${kept.join(", ")}.`;
}
