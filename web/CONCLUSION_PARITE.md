# Conclusion du contrôle de parité des recherches (1er octobre 2026)

Bilan du contrôle de parité entre `search_passages` (SQL, production) et `localSearch` (TypeScript),
introduit par la PR [#43](https://github.com/pmeyssonnier/Parlement_qr/pull/43). Le mode d'emploi et le détail
de ce qui est comparé sont dans [ACTUALISATION.md](ACTUALISATION.md), section « Parité des recherches SQL et
locale ». Ce document garde le résultat et les décisions.

## Conclusion

**Les deux recherches donnent maintenant le même résultat.** Le contrôle tourne en CI à chaque modification
d'une migration ou de la recherche, chaque nuit sur `main` et à la demande. Il ne tolère aucun écart.

- 0 écart sur 147 requêtes en CI (32 cas de l'audit, 100 requêtes au hasard à graine fixe, 15 mots rares).
- 0 écart sur 5 autres graines de 447 requêtes, vérifiées en local, sauf un écart de score sur une égalité
  exacte entre fiches (graine 2026, `hasard-396`). Il vient du classement SQL, qui départage les égalités
  par `rank()` sur des flottants ; la recherche locale ne le reproduit pas.
- Durée du job `sql-parity` : 1 min 15 (conteneur 13 s, `npm ci` 9 s, chargement 15 s, parité 32 s), donc un
  seul niveau de CI.

## Ce que le contrôle a révélé

Premier essai : **105 requêtes sur 147 différaient**, sans aucun écart documenté. Mesures du choix de référence
et des corrections :

| Constat | Traitement |
|---|---|
| `lexicalQuery()` envoyait des mots déjà raccourcis que la SQL raccourcissait une seconde fois (« terminus » → « terminu » ne retrouvait plus « terminus » ; 82 mots sur 1 998 du corpus, dont « bruxellois », « usagers », « processus », « emplois ») | Les mots partent tels qu'écrits : PR [#44](https://github.com/pmeyssonnier/Parlement_qr/pull/44) |
| La recherche locale divergeait de la SQL : plafond de 3 fiches, filtre avant ou après la coupe, choix des passages, racines de mots | Décision du propriétaire : **la SQL fait foi**. `localSearch` la reproduit (007) |
| « œuvre » devenait « uvre » (la ligature n'était pas décomposée) | Lecture « oeuvre », comme `fold_accents` |
| Des mots vides propres à l'application empêchaient des correspondances que la SQL trouvait (« concernant » dans les titres) | Liste de mots vides de PostgreSQL à l'indexation |
| « vélos/trottinettes » est un nom de fichier pour l'analyseur PostgreSQL, non indexé mot à mot | Reproduit côté local |

Le montage du contrôle a aussi montré que `service_role` lit 0 ligne sans `BYPASSRLS` (sécurité par ligne
activée sans règle) : le premier essai affichait « SQL vide » partout, c'était le montage et non la recherche.

Contrôle négatif : avec le poids du titre ramené de 3 à 1 dans la SQL, le contrôle signale 80 écarts ; la base
remise en état en signale 0.

## Effet sur la qualité de la recherche

`npm run audit:search` : 32 cas, 0 échec, premier rang **89 % → 93 %**, MRR **0,91 → 0,95**. Deux cas que l'on
disait « seuls les embeddings les retrouvent » (`velo-bureau`, `securite-metro`) passent en recherche lexicale :
leur marqueur `gap` a été retiré.

## Limites

- Les autres jetons composés de l'analyseur PostgreSQL (URL, adresses e-mail, mots à trait d'union) ne sont pas
  reproduits par la recherche locale.
- Le corpus de la CI est `data/corpus-refreshed.json` (106 fiches). Sur le corpus de production (environ
  39 000 passages), le chargement avec vecteurs de substitution durerait environ une demi-heure : si le fichier
  grossit, remesurer.
- Les racines viennent du paquet `snowball-stemmers` (ISC, 860 Ko) : identiques à celles de PostgreSQL sur
  7 360 des 7 362 mots du corpus ; les deux autres (`2eme`, `1ere`) sont traités à part.
- La recherche locale sert aussi de secours quand Supabase est injoignable : l'ordre de ses résultats a changé
  avec l'alignement.
- Tolérance zéro : ajouter un écart « connu » demande une décision, pas un réglage.

## Pour la suite

Toute modification de `search_passages` (nouvelle migration) ou de `src/lib/search.ts` est vérifiée par le
job `sql-parity`. Un écart signalé est soit un défaut de l'application, soit un changement de la SQL à
reporter dans `localSearch`.
