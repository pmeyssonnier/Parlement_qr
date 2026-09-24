# Chat citoyen — Parlement bruxellois

## Objectif

Créer une application web permettant à tout citoyen de poser une question et d’obtenir une réponse fondée sur les questions et réponses du Parlement de la Région de Bruxelles-Capitale, avec des références officielles vérifiables.

Le projet commence avec un échantillon de dix questions écrites. Ce corpus est exploratoire et ne permet pas de répondre à toutes les questions sur Bruxelles.

> Ce document a été rédigé avant l’audit TypeScript (PR nº 1). Les sections « Vérifications effectuées » et « Diagnostic des connexions » décrivent l’état à ce moment-là. Pour l’organisation actuelle et les commandes, voir le [README](README.md).

## Emplacement des fichiers

L’application se trouve dans le dossier `web` du dépôt. Fichiers importants, relativement à la racine du dépôt :

| Fichier | Fonction |
|---|---|
| `echantillon_questions_reponses.json` | Les dix questions et réponses extraites |
| `index_officiel_24-29.json` | Copie de l’index officiel de la législature |
| `sources/` | Copies HTML des fiches pour vérification |
| `extraire_echantillon.py` | Script d’extraction initial |
| `LISEZMOI.md` | Sources et méthode d’échantillonnage |
| `web/.env.local` | Configuration locale et clés secrètes ; ne pas partager |
| `web/.env.example` | Exemple de configuration sans secrets |
| `web/src/components/chat.tsx` | Interface du chat : état de la conversation et assemblage |
| `web/src/components/` | Composants de l’interface (menu, réponse et sources, saisie, panneaux) |
| `web/src/lib/api-client.ts` | Appel de l’API depuis le navigateur et messages d’erreur |
| `web/src/lib/search.ts` | Recherche locale dans les documents |
| `web/src/lib/server.ts` | Connexions, recherche distante, quotas et génération IA |
| `web/src/lib/schema.ts` | Schémas de validation et types partagés |
| `web/src/app/api/chat/route.ts` | Point d’entrée serveur du chat |
| `web/supabase/migrations/001_initial.sql` | Création des tables et fonctions Supabase |
| `web/supabase/migrations/002_quota_fallback.sql` | Repli sur les extraits quand le budget IA est épuisé |
| `web/supabase/migrations/003_corpus_retention.sql` | Conservation et nettoyage des versions de corpus |
| `web/supabase/migrations/004_clone_unchanged.sql` | Reprise des fiches inchangées lors d’un import (remplacée par 005) |
| `web/supabase/migrations/005_deduplicate_documents.sql` | Stockage unique des contenus, partagés entre versions |
| `web/scripts/import-data.ts` | Importation du corpus et de ses vecteurs |
| `web/scripts/export-corpus.ts` | Exportation du corpus actif |
| `web/scripts/refresh-corpus.py` | Actualisation et extension de la collecte |
| `.github/workflows/check.yml` | Vérifications automatiques préparées pour GitHub |
| `.github/workflows/refresh.yml` | Actualisation préparée ; planification désactivée |

## Architecture retenue

| Besoin | Technologie |
|---|---|
| Application et interface | Next.js, React, TypeScript, CSS |
| Serveur applicatif | Routes serveur Next.js |
| Stockage | Supabase / PostgreSQL |
| Recherche distante | Recherche plein texte PostgreSQL et pgvector |
| Embeddings | OpenAI `text-embedding-3-small`, 1 536 dimensions |
| Synthèse | OpenAI Responses API, modèle configuré `gpt-5-mini` |
| Collecte | Python |
| Publication prévue | Vercel |
| Versionnement et automatisation prévus | GitHub et GitHub Actions |

Le fonctionnement repose sur la recherche documentaire augmentant la génération, souvent appelée RAG :

1. Importer les documents officiels et leurs métadonnées.
2. Découper les textes en passages reliés aux fiches d’origine.
3. Rechercher les passages pertinents pour la question du citoyen.
4. Fournir ces passages à l’IA pour produire une synthèse.
5. Vérifier les identifiants des références retournées.
6. Afficher la réponse, les dates et les liens officiels.

Il n’est pas nécessaire d’entraîner un modèle spécifique pour cette première version.

## Réalisations

- Échantillon de **10 questions écrites**, découpé en **36 passages**.
- Interface de chat en français avec exemples de questions, affichage adaptatif et consultation des sources.
- Recherche locale opérationnelle, sans clé API, produisant des extraits exacts et non une synthèse générée.
- Prise en compte de relances courtes dans la conversation.
- Message explicite lorsque les documents ne permettent pas de répondre.
- Distinction des réponses indiquant l’incompétence du destinataire.
- Code de génération OpenAI avec réponse structurée et validation des références.
- Schéma Supabase comprenant les fiches, passages, versions de corpus et quotas.
- Importation dans une version de préparation, puis activation après contrôle des décomptes.
- Réutilisation prévue des embeddings lorsque le contenu et le modèle n’ont pas changé.
- Scripts de collecte, d’exportation et d’actualisation.
- Limites sur la taille des messages, contrôles d’origine et quotas d’utilisation.
- Configuration de déploiement Vercel préparée.

Le calendrier automatique de collecte n’est pas activé. Les scripts et workflows doivent encore être raccordés aux services réels et vérifiés dans cet environnement.

## Vérifications effectuées

### Tests automatisés

**10 tests TypeScript réussis**, couvrant notamment :

- La cohérence du corpus et la fidélité des passages.
- Le rejet des doublons et des liens non officiels.
- La recherche sur la STIB, le vote et les emballages.
- L’absence de réponse inventée pour un sujet absent.
- Le traitement des réponses d’incompétence.
- La contextualisation des relances.
- Le rejet des citations inconnues ou manquantes.
- Les limites des messages et de l’historique.

**2 tests Python réussis**, vérifiant le nouveau collecteur sur les dix sources initiales et son refus d’une structure HTML inconnue.

Le contrôle TypeScript a réussi. Une compilation de production a également réussi avant les derniers ajouts aux scripts d’importation et d’actualisation. Une nouvelle compilation complète devra être effectuée avant publication.

### Vérifications dans le navigateur

Les parcours suivants ont été vérifiés manuellement :

- Question sur les mesures de la STIB en période de forte chaleur.
- Affichage d’extraits datés et de leurs références.
- Relance « Et dans les trams ? ».
- Ouverture d’une référence vers une fiche officielle.
- Question sur un sujet absent du corpus.
- Affichage de l’explication du périmètre documentaire.

Une suite de tests Playwright a été préparée, mais son exécution complète n’a pas été confirmée. Les appels réels à l’IA, les fonctions SQL et l’importation distante ne sont pas encore validés.

## Diagnostic des connexions

Les paramètres suivants sont renseignés dans `web/.env.local` :

```text
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_SECRET_KEY
QUOTA_SECRET
APP_ORIGIN
```

La présence d’une valeur ne garantit pas sa validité.

### Supabase

L’URL contenait un chemin supplémentaire. Elle a été corrigée pour pointer vers la racine HTTPS du même projet.

Après correction, la vérification renvoie **HTTP 401**. L’authentification reste refusée. Il faut vérifier la validité de la clé secrète et son appartenance au projet indiqué par l’URL.

La création des tables et l’existence d’un corpus actif n’ont donc pas pu être confirmées.

### OpenAI

La vérification du modèle renvoie **HTTP 401**, avec le code **`invalid_api_key`**.

Il faut remplacer la valeur par une clé API OpenAI valide. Une clé révoquée, incomplète ou incorrecte ne permet pas de poursuivre les tests.

### État de la génération

```text
AI_ENABLED=false
```

La synthèse IA reste désactivée. Le mode documentaire local a été testé avant la configuration distante. Avec Supabase renseigné mais inaccessible, l’application peut afficher une indisponibilité plutôt que revenir silencieusement au corpus local.

## Actions à effectuer pour reprendre

1. Ouvrir `web/.env.local` dans un éditeur local.
2. Remplacer `OPENAI_API_KEY` par une clé API OpenAI valide.
3. Vérifier que `SUPABASE_URL` correspond à l’URL racine du projet choisi.
4. Remplacer `SUPABASE_SECRET_KEY` par la clé secrète de ce même projet. Ne pas utiliser une clé publique destinée au navigateur.
5. Enregistrer le fichier, sans transmettre les valeurs dans la conversation.
6. Refaire les vérifications de connexion.
7. Appliquer dans l’ordre les migrations de `web/supabase/migrations/` (001 à 005, dans l’ordre) dans le projet Supabase prévu, après vérification de son état existant.
8. Importer les dix fiches et leurs embeddings.
9. Vérifier le corpus actif, les droits d’accès, la recherche et les quotas.
10. Activer la synthèse IA et tester de vraies réponses sourcées.
11. Refaire les tests et la compilation de production.
12. Configurer Vercel, ses variables d’environnement et l’origine publique exacte.
13. Déployer une version de préproduction puis valider le parcours public.
14. Élargir progressivement le corpus et activer une actualisation surveillée.

## Commandes disponibles

À exécuter dans le dossier `web` :

```powershell
npm.cmd run check:config
npm.cmd test
npm.cmd run typecheck
python scripts/test-collector.py
npm.cmd run import:data -- --validate-only
npm.cmd run dev
```

Une fois Supabase créé et les accès validés :

```powershell
npm.cmd run import:data
npm.cmd run export:data
npm.cmd run build
```

L’importation avec embeddings appelle OpenAI et peut entraîner une consommation facturée. Les vérifications de présence de configuration n’affichent jamais les clés.

## Limites avant ouverture au public

- Le corpus de dix fiches est trop limité pour un service généraliste sur Bruxelles.
- Une déclaration ministérielle historique ne doit pas être présentée comme une observation actuelle.
- L’absence de résultat ne prouve pas que le Parlement n’a jamais traité le sujet.
- Une citation valide ne garantit pas à elle seule que la synthèse est fidèle : une évaluation humaine reste nécessaire.
- Les seuils et classements de recherche devront être ajustés sur un corpus plus large.
- Les paramètres de conservation, les conditions de réutilisation des sources et les informations sur l’exploitant devront être finalisés avant publication.
- Les quotas préparés plafonnent les appels, pas un montant exact en euros.
- La base distante, la génération IA et le déploiement public restent à vérifier.

## État final de cette analyse

**Prototype développé et testé localement. Connexions externes bloquées par des erreurs d’authentification. Application non encore déployée publiquement.**

Aucune clé secrète ni valeur d’identification sensible n’est incluse dans ce document.

## Documentation de référence

- [Codes d’erreur OpenAI](https://developers.openai.com/api/docs/guides/error-codes)
- [Clés API Supabase](https://supabase.com/docs/guides/getting-started/api-keys)
- [Recherche hybride Supabase](https://supabase.com/docs/guides/ai/hybrid-search)
- [Déploiement Vercel](https://vercel.com/docs/deployments)
- [Sources parlementaires](https://www.parlement.brussels/interpellations-et-questions/)
