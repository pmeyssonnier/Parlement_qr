# Questions et réponses du Parlement bruxellois

Recherche et extraction réalisées le 23 septembre 2026.

## Sources disponibles

- [Liste officielle et filtres](https://www.parlement.brussels/interpellations-et-questions/?dos_type=qe) : législature, assemblée PRB/ARCCC, type d'intervention, recherche et publication. Le sélecteur propose les législatures depuis 1989–1995 jusqu'à 2024–2029. Cette présence dans le sélecteur ne garantit pas la complétude des archives.
- [Index JSON utilisé par le site](https://www.parlement.brussels/prb_includes/weblex/data/dos_qu_legis_24-29.json) : métadonnées françaises et néerlandaises, auteurs, destinataires, dates, liens des fiches. Il s'agit d'une ressource publique du site, pas d'une API documentée avec garantie de stabilité identifiée lors de cette recherche.
- [Recherche avancée](https://www.parlement.brussels/weblex-quest-form/).
- Les fiches individuelles contiennent les dates, les actes de procédure et, pour les dix questions écrites vérifiées, les textes des questions et réponses en français. D'autres interventions renvoient aux comptes rendus PDF hébergés sur Weblex. Des annexes peuvent nécessiter une extraction séparée.
- Le [Parlement francophone bruxellois](https://www.parlementfrancophone.brussels/) publie aussi des questions/réponses, mais relève d'un autre périmètre institutionnel (COCOF), non fusionné avec cet échantillon régional.

## Décompte de l'index téléchargé

7 187 fiches : 6 083 PRB et 1 104 ARCCC. Parmi les fiches PRB, 2 577 sont des questions écrites. Toutes assemblées confondues : 2 941 questions écrites, 2 633 questions orales, 871 demandes d'explication, 677 questions d'actualité et 65 interpellations. Ces décomptes décrivent la ressource téléchargée, sans garantie d'exhaustivité.

## Échantillon

Dix questions écrites PRB reçues au plus tard le 30 juin 2025, triées par date puis identifiant décroissants, avec un auteur distinct par fiche. Les dix retenues portent toutes la date de réception du 30 juin 2025 sur le site. Le recul temporel permet d'examiner des réponses publiées. Ce choix est exploratoire, non aléatoire et non représentatif du corpus.

Les dix fiches comportent un texte de réponse. Les fiches 167067 et 166382 indiquent une incompétence du destinataire ou un renvoi à une autre ministre ; elles ne doivent pas être comptées comme des réponses substantielles sans qualification supplémentaire. La fiche 167374 renvoie également à une autre question en complément de sa réponse.

## Fichiers

- `echantillon_questions_reponses.json` : dix fiches structurées, textes des blocs question/réponse, dates ISO, auteur, destinataire, numéro, identifiant Weblex, actes, liens et limites méthodologiques.
- `index_officiel_24-29.json` : copie brute de l'index officiel ; les lignes y sont des tableaux positionnels et certains champs contiennent du HTML.
- `sources/` : copies HTML des dix fiches pour vérifier l'extraction.
- `extraire_echantillon.py` : extraction reproductible en Python 3 sans dépendance tierce. Utilise les fichiers locaux en cache lorsqu'ils existent.
- `preparer_apercu.py` : contrôle de présence des vingt textes dans les sources et préparation de l'aperçu de cette conversation.

Les valeurs manquantes sont représentées par `null`. Les entités HTML sont décodées ; les espaces et paragraphes sont normalisés. Les textes ne sont pas des résumés. Les annexes et leur contenu ne sont pas intégrés. La langue de l'échantillon est le français, avec conservation du titre néerlandais fourni par l'index.

## Pour étendre l'extraction

Réutiliser les liens de l'index, distinguer PRB et ARCCC, traiter séparément les versions linguistiques, conserver les sources et la date de collecte, limiter le rythme des requêtes et vérifier les conditions de réutilisation avant diffusion d'un corpus complet. Une absence de texte ne suffit pas à conclure qu'une question est sans réponse. Les numéros de question ne sont pas des identifiants uniques ; utiliser le couple `base` / `moncode`.
