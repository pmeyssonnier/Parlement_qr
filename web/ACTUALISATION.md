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

Avant la première exécution, appliquez dans l'ordre les migrations 003 à 007 de
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
Free). Dans Actions → Refresh parliamentary corpus → Run workflow :

- **legislature** : la législature à collecter, comme dans le nom de l'index du site
  (`19-24` pour 2019-2024) ;
- **title_filter** : une expression sur le titre français ou néerlandais, par exemple
  `Schaerbeek|Schaarbeek|Meiser|Josaphat` (majuscules indifférentes) ;
- **expand** : le nombre maximal de questions à ajouter (par exemple 100).

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
- Embeddings : au plus 100 appels et 3 000 000 d'octets UTF-8 de texte, soit environ
  400 fiches nouvelles. Le dépassement est détecté **avant** toute écriture.
- Modèle fixé pour le workflow : text-embedding-3-small.
- Durée maximale de la tâche : 60 minutes ; exécutions sérialisées.

## Stockage

Depuis la migration 005, chaque contenu (fiche, passages et embeddings) n'est stocké
qu'une fois ; une version du corpus n'est qu'une liste de références. Une version de
retour arrière ne coûte que les fiches qui ont changé depuis. Le nettoyage supprime
les contenus que plus aucune version n'utilise.

Mesure du 25 septembre 2026 : base complète de 176 Mo pour 2 406 fiches, dont
155 Mo pour `document_passages` (environ 75 Mo de données, environ 80 Mo d'index
vectoriel et plein texte), soit environ 69 ko par fiche, index compris. Projection :
environ 188 Mo après le rattrapage (2 578 fiches) et environ 425 Mo
pour 6 000 fiches en fin de législature : à surveiller avec l'offre Free de Supabase
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
