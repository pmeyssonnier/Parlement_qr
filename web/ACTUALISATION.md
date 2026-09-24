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

Dans Actions → Refresh parliamentary corpus → Run workflow, laissez expand à 0
pour un premier essai manuel. Vérifiez le succès de toutes les étapes.
Puis dans Settings → Secrets and variables → Actions → Variables,
ajoutez CORPUS_REFRESH_ENABLED avec la valeur true.
Pour suspendre, passez cette variable à false. Un lancement manuel reste possible.

## Périmètre et plafonds par exécution

- Export du corpus actif depuis Supabase, puis actualisation des mêmes fiches.
- Aucun ajout de nouvelles questions lors des passages hebdomadaires (expand = 0).
- Maximum 150 fiches sélectionnées. Au-delà, arrêt sans suppression du corpus.
- Une requête d'index et au plus 150 pages, avec au plus 3 tentatives par téléchargement.
- Au plus 25 appels de création d'embeddings, sans relance automatique OpenAI.
- Au plus 250 000 octets UTF-8 de texte envoyé pour ces embeddings.
- Modèle fixé pour le workflow : text-embedding-3-small.
- Réutilisation des embeddings lorsque la fiche et le modèle sont inchangés.
- Durée maximale de la tâche : 45 minutes ; exécutions sérialisées.

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
- rien de ce qui a été créé depuis moins d'une heure n'est supprimé.

Si la migration n'est pas appliquée, l'import réussit quand même et affiche un
avertissement ; les versions s'accumulent alors comme auparavant.

Les copies publiques collectées sont conservées comme artefacts GitHub pendant
30 jours. Consultez Actions pour les résultats et configurez vos notifications
GitHub Actions selon vos préférences. Aucun message Slack ou email n'est envoyé
par le script. Les nouvelles réponses sont interrogeables dès l'activation ; les compteurs
affichés sur la page d'accueil sont mis en cache et se mettent à jour en
10 minutes au plus. Un nouveau déploiement Vercel n'est pas nécessaire.
