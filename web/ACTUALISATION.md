# Actualisation hebdomadaire du corpus

## Préparation et activation

Le workflow GitHub Actions `.github/workflows/refresh.yml` est préparé pour chaque
lundi à 04:20 UTC (06:20 en été et 05:20 en hiver à Bruxelles). GitHub peut retarder
le démarrage. Ce n'est pas une tâche dépendant d'un ordinateur allumé.

Le traitement planifié reste désactivé tant que la variable de dépôt
CORPUS_REFRESH_ENABLED ne vaut pas exactement true.

Dans GitHub → Settings → Secrets and variables → Actions → Secrets,
créez trois Repository secrets :

- SUPABASE_URL
- SUPABASE_SECRET_KEY
- OPENAI_API_KEY

Copiez leurs valeurs directement depuis votre configuration locale, sans les
publier dans un fichier ou une conversation. Les variables Vercel ne sont pas
transmises automatiquement à GitHub Actions.

Avant la première exécution, appliquez dans l'ordre les migrations 003 à 010 de
`supabase/migrations/` dans l'éditeur SQL de Supabase.

Dans Actions → Refresh parliamentary corpus → Run workflow, mettez expand à 0
pour un premier essai manuel. Vérifiez le succès de toutes les étapes.
Puis dans Settings → Secrets and variables → Actions → Variables,
ajoutez CORPUS_REFRESH_ENABLED avec la valeur true.
Pour suspendre, passez cette variable à false. Un lancement manuel reste possible.

## Ce que fait chaque exécution

1. Export du corpus actif depuis Supabase.
2. Téléchargement de l'index officiel des questions écrites PRB de la législature 2024-2029.
3. Nouveau téléchargement des seules fiches susceptibles d'avoir changé :
   - question sans réponse reçue depuis moins de 240 jours (la réponse arrive en
     général en quelques mois, 197 jours au plus dans le corpus) ;
   - question plus ancienne toujours sans réponse : revérifiée par roulement, chacune
     une fois toutes les 4 semaines, pour récupérer les réponses tardives ;
   - réponse publiée depuis moins de 14 jours (corrections tardives).
   Les autres fiches sont reprises telles quelles, sans téléchargement.
4. Ajout de questions **absentes du corpus**, des plus récentes aux plus anciennes :
   les nouvelles questions d'abord, puis l'historique de la législature. Une fiche
   dont le texte de question n'est pas encore publié est écartée ; elle sera retentée
   lors d'une exécution suivante.
5. Import : les fiches inchangées sont recopiées dans Supabase avec leurs embeddings,
   sans appel OpenAI ; seules les fiches nouvelles ou modifiées sont vectorisées.

## Version du schéma et fraîcheur du corpus

Les migrations sont appliquées à la main. Depuis la migration 010, chacune inscrit son
numéro dans `schema_migrations`, et `/api/health` donne :
- `schema` : la dernière migration appliquée dans la base ;
- `schemaExpected` : celle qu'attend le code déployé. S'ils diffèrent, le journal Vercel
  contient `SCHEMA_VERSION_MISMATCH` : appliquez les migrations manquantes dans l'ordre ;
- `latestDocument` : la date la plus récente parmi les fiches du corpus (réception,
  publication ou réponse). La date de collecte ne dit pas jusqu'où vont les documents ;
  la page d'accueil affiche aussi « Documents jusqu'au … ».

## Rattrapage de la législature

Le nombre de questions ajoutées par exécution vaut 300 par défaut :

- lancement manuel : champ **expand** (0 = actualiser seulement, 500 au plus) ;
- exécution planifiée : variable de dépôt `CORPUS_WEEKLY_ADD`, 300 si elle est absente.

Le rattrapage de la législature est terminé depuis le 25 septembre 2026 (2 578 fiches,
en 14 exécutions). Le même réglage n'ajoute désormais que les nouvelles questions.
Pour un rattrapage futur (par exemple après une remise à zéro), lancez manuellement le
workflow plusieurs fois, une exécution après l'autre (elles sont sérialisées).
Le journal de collecte indique à chaque exécution le nombre de questions encore
absentes du corpus.

## Législatures précédentes : sélection thématique

Le corpus peut aussi contenir des questions d'une législature précédente, choisies
par leur titre, sans charger la législature entière (stockage limité de l'offre
Free).

**Préréglage (le plus simple).** Dans Actions → Refresh parliamentary corpus → Run
workflow, choisissez dans la liste **Préréglage** l'option « Schaerbeek 2019-2024
(voiries régionales) », puis cliquez sur Run workflow : la législature, le filtre et
son libellé viennent de `web/scripts/title-selections.json` (questions 2019-2024 dont le
titre cite Schaerbeek, Meiser, Josaphat ou une voirie régionale schaerbeekoise, en
français et en néerlandais). Pour compléter la liste des voiries, modifiez ce fichier
dans une PR.

**Sélection libre.** Avec le préréglage « Actualisation de la législature en cours »,
les champs suivants s'appliquent :

- **legislature** : la législature à collecter, comme dans le nom de l'index du site
  (`19-24` pour 2019-2024) ;
- **title_filter** : une expression sur le titre français ou néerlandais, par exemple
  `Schaerbeek|Schaarbeek|Meiser|Josaphat` (majuscules indifférentes) ;
- **title_filter_label** (facultatif) : le libellé du filtre affiché aux visiteurs, par
  exemple « Schaerbeek ou une de ses voiries régionales » ;
- **expand** : le nombre maximal de questions à ajouter (par exemple 100).

Le filtre ne porte que sur les titres. Préférez les noms propres au secteur (Meiser,
Lambermont, Dailly…) et précisez le type de voie pour les noms courants (« rue des
Palais » plutôt que « Palais »), en français et en néerlandais.

Les fiches des autres législatures ne sont ni revérifiées, ni recherchées dans
l'index de la législature collectée : elles sont conservées telles quelles.
L'exécution planifiée du lundi porte toujours sur la législature en cours, sans
filtre. Le panneau « Sources et méthode » du site indique, pour chaque législature,
s'il s'agit de la législature complète ou d'une sélection thématique.

## Plafonds par exécution

- Corpus : 6 000 fiches au plus. Au-delà, arrêt sans suppression du corpus.
- Téléchargements : l'index et au plus 900 pages. Les fiches à revérifier passent en
  premier ; les ajouts utilisent le reste.
- Site injoignable : 5 tentatives pour l'index (pauses de 5, 10, 20 puis 40 s), 3 pour
  une page (pauses de 2 puis 4 s). Une page qui ne répond toujours pas est
  **reportée** à l'exécution suivante au lieu de faire échouer le lot : une fiche à
  revérifier garde sa version précédente, une fiche à ajouter reste absente. Au-delà
  de 10 pages reportées, ou dès 3 pages reportées de suite (site en panne),
  l'exécution s'arrête sans remplacer le corpus. Le bilan de collecte indique le
  nombre de fiches reportées.
- Texte disparu : une fiche déjà dans le corpus qui revient du site sans texte de
  question (incident passager du site) **garde sa version précédente** et sera
  revérifiée à l'exécution suivante. Au-delà de 10 fiches dans ce cas lors d'une même
  exécution (structure des pages probablement modifiée), l'exécution s'arrête sans
  remplacer le corpus. Le bilan de collecte indique le nombre de fiches conservées.
- Fiche absente de l'index : une fiche du corpus que l'index ne liste plus (retirée,
  ou ligne incomplète, sans date de réception) **garde sa version précédente** et
  n'est pas téléchargée. Le journal affiche son code et le motif ; la liste est
  enregistrée dans `missing-from-index.json` de l'artefact, à côté de l'index reçu.
  Au-delà de 10 fiches absentes (index probablement tronqué), l'exécution s'arrête
  sans remplacer le corpus.
- Embeddings : au plus 3 000 000 d'octets UTF-8 de texte, soit environ 400 fiches
  nouvelles, et 300 appels. Le dépassement est détecté **avant** toute écriture, et le
  message donne le volume prévu. Pour une réindexation complète, lancez le workflow à la
  main avec `max_embedding_mb` relevé (voir « Réindexation »).
- Limite de débit OpenAI : le compte est limité à 1 000 000 de tokens par minute
  (erreur 429). Une requête refusée n'est pas facturée : l'import attend le délai
  annoncé par OpenAI et réessaie, jusqu'à 8 tentatives par lot, et le journal affiche
  « Limite de débit OpenAI atteinte : nouvelle tentative dans … s ». Une réindexation
  complète (environ 4 millions de tokens) prend donc quelques minutes de plus. Un
  compte sans crédit (`insufficient_quota`) n'est pas réessayé.
- Modèle fixé pour le workflow : text-embedding-3-small.
- Durée maximale de la tâche : 60 minutes ; exécutions sérialisées.

## Réindexation (migration 008)

Chaque contenu stocké est identifié par une empreinte de la fiche **et** de sa
configuration d'indexation : format des passages (`INDEX_FORMAT` dans
`src/lib/documents.ts`), modèle d'embedding et dimensions. La configuration est
enregistrée sur chaque version (`corpus_versions.index_config`), et les lignes stockées
ne peuvent plus être modifiées. Un import en préparation ou échoué ne touche donc
jamais les vecteurs de la version active. La recherche vectorise la question avec le
modèle de la version active, pas avec la variable `EMBEDDING_MODEL`. `activate_corpus`
refuse une version dont un passage n'a pas de vecteur de ce modèle, ou dont une fiche
n'a aucun passage.

Une réindexation complète est donc nécessaire :
- une fois, juste après la migration 008 (toutes les empreintes changent) ;
- à chaque changement de modèle d'embedding ;
- à chaque changement de `passages()` ou de `searchText()`, que le test
  `tests/index-config.test.ts` signale en demandant de changer `INDEX_FORMAT`.

Procédure :
1. Appliquez `supabase/migrations/008_index_config.sql` dans l'éditeur SQL de
   Supabase. La version active reste en ligne.
2. Fusionnez le code qui l'utilise. N'attendez pas entre les deux étapes : l'ancien code
   d'import ne peut plus compléter un contenu déjà stocké.
3. Appliquez `supabase/migrations/009_drop_unused_vector_index.sql`. Elle supprime
   l'index vectoriel HNSW, que la recherche n'utilise pas (elle calcule la distance
   exacte). Il ralentissait chaque insertion de vecteur : le 28 septembre 2026, la
   première réindexation (exécution n° 20) a dépassé le délai maximal d'une requête
   Supabase (erreur 57014, `statement timeout`) dès le premier lot de passages.
4. Lancez le workflow à la main avec `expand` à 0 et `max_embedding_mb` à 25. Pour le
   corpus de 2 689 fiches (environ 8 300 passages et 16 Mo de texte) : environ 90
   appels, 4 millions de tokens, soit environ 0,10 $ avec text-embedding-3-small.
5. Le journal doit indiquer « 0 déjà stockées, 2 689 nouvelles ou modifiées », puis
   « Corpus activé ».
6. Si l'exécution s'arrête (limite de débit OpenAI, réseau), relancez-la telle quelle :
   les fiches déjà enregistrées sont reprises sans nouvel appel OpenAI, et seules les
   autres sont vectorisées. La version de préparation abandonnée est supprimée
   automatiquement par la rétention. Le 29 septembre 2026, la première tentative
   avec la migration 009 a enregistré 1 934 fiches sur 2 689 en 2 minutes, puis s'est
   arrêtée sur une limite de débit (erreur 429) : d'où l'attente automatique ci-dessus.

Stockage : la migration 009 libère l'index HNSW (plusieurs dizaines de Mo). La
réindexation ajoute ensuite une copie complète des passages et de leur index plein
texte. La base reste nettement sous la limite de 500 Mo de l'offre Free. Les anciens contenus sont supprimés quand plus aucune
version conservée ne les utilise, soit après deux actualisations hebdomadaires.
Vérifiez la taille avec les requêtes de mesure du README.

La migration a été testée sur PostgreSQL 16 et pgvector 0.8.0 avec
`supabase/tests/008_index_config.sql` (14 cas). Ce test s'exécute sur une base locale
jetable, jamais sur Supabase.

## Stockage

Depuis la migration 005, chaque contenu (fiche, passages et embeddings) n'est stocké
qu'une fois ; une version du corpus n'est qu'une liste de références. Une version de
retour arrière ne coûte que les fiches qui ont changé depuis. Le nettoyage supprime
les contenus que plus aucune version n'utilise.

Mesure du 25 septembre 2026 : base complète de 176 Mo pour 2 406 fiches, dont
155 Mo pour `document_passages` (environ 75 Mo de données, environ 80 Mo d'index
vectoriel et plein texte), soit environ 69 ko par fiche, index compris. Projection :
environ 196 Mo avec le corpus du 25 septembre 2026 (2 689 fiches, dont 111 de la
sélection 2019-2024) et environ 430 Mo pour 6 100 fiches en fin de législature : à surveiller avec l'offre Free de Supabase
(500 Mo). Les requêtes de mesure figurent dans le README.

Les plafonds OpenAI portent sur le volume et les appels, pas sur des euros.
Ils s'appliquent à chaque lancement, y compris manuel. Plusieurs lancements
peuvent donc cumuler des dépenses. Les appels du chat ont leurs propres limites.
Une opération échouée peut avoir consommé une partie du budget avant l'arrêt.

## Garanties et suivi

La nouvelle version devient active seulement après import complet et vérification
des décomptes. En cas de plafond atteint ou d'erreur, la précédente reste active.
Après activation, l'import supprime les anciennes versions (migration
`supabase/migrations/003_corpus_retention.sql`, à appliquer une fois dans l'éditeur
SQL de Supabase) :

- la version active et les 2 dernières versions ayant été actives sont conservées
  pour un retour arrière (variable IMPORT_KEEP_VERSIONS) ;
- les imports interrompus, jamais activés, sont supprimés ;
- rien de ce qui a été créé depuis moins d'une heure n'est supprimé ;
- les versions inactives antérieures à la migration ne sont jamais supprimées
  automatiquement : rien ne permet de savoir si elles ont été en ligne (un import
  peut échouer après sa dernière question, avant ses passages). La migration les
  marque `activation_unknown`.

Pour les supprimer à la main après vérification, dans l'éditeur SQL de Supabase :

```sql
select id, created_at, count from corpus_versions where activation_unknown order by created_at desc;
-- puis, pour chaque version dont vous êtes certain de ne plus avoir besoin :
delete from corpus_versions where id = '<id>' and activation_unknown and not active;
```

Si la migration n'est pas appliquée, l'import réussit quand même et affiche un
avertissement ; les versions s'accumulent alors comme auparavant.

Les copies publiques collectées sont conservées comme artefacts GitHub pendant
30 jours. Consultez Actions pour les résultats et configurez vos notifications
GitHub Actions selon vos préférences. Aucun message Slack ou email n'est envoyé
par le script. Les nouvelles réponses sont interrogeables dès l'activation ; les compteurs
affichés sur la page d'accueil sont mis en cache et se mettent à jour en
10 minutes au plus. Un nouveau déploiement Vercel n'est pas nécessaire.
