# Historique du corpus

Journal des exécutions du workflow `Refresh parliamentary corpus` (`.github/workflows/refresh.yml`)
depuis le début : combien de fiches ont été ajoutées, combien restaient à charger, et pourquoi
certaines exécutions ont échoué. Reconstitué le 1er octobre 2026 à partir des journaux
GitHub Actions des 41 exécutions (du 24/09 au 01/10) (les journaux ne sont conservés que 90 jours : ce
fichier garde la trace).

La version destinée au public, en termes simples, est dans `src/lib/changelog.ts` (menu « Nouveautés »).

## Lexique

- **Ajoutées** : questions absentes du corpus, collectées pendant l'exécution.
- **Écartées** : fiches mises de côté parce que la page n'a pas de texte de question (ou pas de bloc
  de question). Elles sont réessayées à chaque exécution, donc elles restent comptées dans « encore
  absentes ».
- **Encore absentes** : questions de l'index officiel que le corpus ne contient pas encore (la ligne
  « encore absentes du corpus » du bilan de collecte, écartées comprises).
- **Corpus après** : nombre de fiches dans la version activée à la fin de l'exécution (ligne
  « Corpus activé » du journal d'import).
- Les heures sont en UTC. `n/d` : non disponible (ancien format de journal, ou ligne de bilan non lue).
  Un `~` devant un chiffre signale une valeur **calculée** (le chiffre précédent moins les fiches
  ajoutées), et non lue dans le journal.

## Exécutions réussies

| Run | Date | Législature | Ajoutées | Écartées | Encore absentes | Corpus après |
|---|---|---|---|---|---|---|
| #1 | 24/09 13:37 | échantillon | 106 | 0 | n/d | 106 |
| #2 | 24/09 14:57 | échantillon | 0 | 0 | n/d | 106 |
| #3 | 24/09 16:20 | 2024-2029 | 300 | 25 | 2 197 | 406 |
| #4 | 24/09 16:51 | 2024-2029 | 400 | 25 | 1 797 | 806 |
| #5 | 24/09 17:11 | 2024-2029 | 400 | 25 | 1 397 | 1 206 |
| #6 | 24/09 18:27 | 2024-2029 | 400 | 25 | 997 | 1 606 |
| #7 | 24/09 19:28 | 2024-2029 | 400 | 25 | 597 | 2 006 |
| #9 | 24/09 20:20 | 2024-2029 | 400 | 25 | 197 | 2 406 |
| #14 | 25/09 07:24 | 2024-2029 | 172 | 25 | 25 | 2 578 |
| #15 | 25/09 10:17 | 2024-2029 | 0 | 25 | 25 | 2 578 |
| #16 | 25/09 10:36 | 2024-2029 | 0 | 25 | 25 | 2 578 |
| #17 | 25/09 11:05 | 2019-2024 (sélection Schaerbeek) | 111 | 1 | 1 | 2 689 |
| #18 | 28/09 07:56 | 2024-2029 | 0 | 25 | 25 | 2 689 |
| #19 (planifié) | 28/09 10:56 | 2024-2029 | 0 | 25 | 25 | 2 689 |
| #22 | 29/09 11:58 | 2024-2029 | 0 | 0 | 35 | 2 689 |
| #25 | 30/09 21:24 | 2019-2024 | 500 | 2 | 9 449 | 3 189 |
| #28 | 30/09 22:59 | 2019-2024 | 500 | 2 | 8 949 | 3 689 |
| #29 | 30/09 23:32 | 2019-2024 | 800 | 2 | 8 149 | 4 489 |
| #30 | 01/10 06:12 | 2019-2024 | 800 | n/d | ~7 349 | 5 289 |
| #31 | 01/10 06:39 | 2019-2024 | 800 | n/d | ~6 549 | 6 089 |
| #32 | 01/10 07:25 | 2019-2024 | 800 | n/d | ~5 749 | 6 889 |
| #33 | 01/10 07:53 | 2019-2024 | 800 | n/d | ~4 949 | 7 689 |
| #34 | 01/10 08:22 | 2019-2024 | 800 | n/d | ~4 149 | 8 489 |
| #35 | 01/10 09:06 | 2019-2024 | 800 | n/d | ~3 349 | 9 289 |
| #36 | 01/10 09:35 | 2019-2024 | 800 | n/d | ~2 549 | 10 089 |
| #38 | 01/10 10:47 | 2019-2024 | 800 | n/d | ~1 749 | 10 889 |
| #39 | 01/10 11:16 | 2019-2024 | 800 | n/d | ~949 | 11 689 |
| #40 | 01/10 11:45 | 2019-2024 | 800 | n/d | ~149 | 12 489 |
| #41 | 01/10 12:15 | 2019-2024 | 137 | 12 | 12 | 12 626 |

Détails utiles :

- Les runs #1 et #2 utilisent un ancien format de journal (pas de ligne « Revérifiées », plafond
  d'import de 150 fiches).
- Le run #22 a enregistré 755 fiches « nouvelles ou modifiées » alors qu'il n'en ajoutait aucune :
  réindexation après la migration 008 (plafond d'embeddings relevé à 300 appels et 25 Mo).
- Depuis le run #29, une partie des fiches enregistrées avait déjà été stockée par un run interrompu
  (#27) : elles sont reconnues par empreinte et ne sont pas renvoyées à OpenAI.
- À chaque run, environ 4 à 5 Mo de texte partent chez OpenAI pour 800 fiches (quelques cents).

Bilan du run #41 (dernier chargement) : 137 questions ajoutées, **12 écartées**, 12 encore absentes
(ce sont les 12 écartées), 153 pages téléchargées, aucune page injoignable. Les valeurs `~` des
runs #30 à #40 sont cohérentes avec ce bilan : 149 questions restaient avant le #41, soit
137 ajoutées + 12 écartées.

## Bilan du chargement de 2019-2024

- Corpus final au 01/10/2026 : **12 626 fiches**, dont 2 578 de la législature 2024-2029 et
  **10 048 de 2019-2024** (111 de la sélection Schaerbeek du 25/09, le reste chargé du 30/09 au 01/10).
- 12 fiches de 2019-2024 restent à l'écart (pas de texte de question, ou pas de bloc de question sur
  la page). Elles sont réessayées à chaque exécution et rejoindront le corpus si le site publie leur texte.
- Index officiel 2019-2024 : environ 10 060 questions (10 048 chargées + 12 écartées).
- 41 exécutions en 8 jours : 29 réussies (dont 23 ont ajouté des fiches, de 106 à 12 626) et 12 échecs
  ou annulations, tous sans conséquence sur la version active.

## Exécutions échouées ou annulées

Aucune de ces exécutions n'a modifié le corpus en production : la version précédente est restée active.

| Run | Date | Étape | Cause |
|---|---|---|---|
| #8 | 24/09 20:13 | collecte | annulé en cours de collecte |
| #10 | 24/09 20:52 | collecte | délai dépassé en téléchargeant l'index (5 tentatives) |
| #11 | 24/09 22:29 | collecte | texte vide pour une fiche existante (170236) |
| #12 | 25/09 06:42 | collecte | délai dépassé en téléchargeant l'index |
| #13 | 25/09 07:13 | collecte | fiches de la version précédente absentes de l'index |
| #20 | 28/09 14:03 | import | échec de l'enregistrement des passages |
| #21 | 29/09 11:29 | import | limite OpenAI atteinte (429) après 1 934 fiches |
| #23 | 30/09 20:55 | — | annulé |
| #24 | 30/09 21:01 | collecte | fiche 162860 sans bloc de question (corrigé : PR nº 37) |
| #26 | 30/09 22:16 | collecte | `--expand` limité à 500 (relevé à 800 : PR nº 39) |
| #27 | 30/09 22:24 | import | activation coupée au bout de 8 s (`statement_timeout` de `service_role` relevé à 120 s) |
| #37 | 01/10 10:24 | collecte | site du Parlement injoignable (réessai réussi 20 minutes plus tard) |

## Comment compléter ce fichier

Pour chaque nouvelle exécution, relever dans son journal :

1. la ligne de bilan de la collecte : `Revérifiées : … ajoutées : … écartées : … encore absentes du corpus : …` ;
2. la ligne `Corpus activé : N fiches, P passages (X déjà stockées, Y nouvelles ou modifiées)`.

Ajouter une ligne au tableau des réussites (ou des échecs, avec l'étape et la cause), puis, si la
mise à jour est visible pour les lecteurs, une entrée dans `src/lib/changelog.ts`.
