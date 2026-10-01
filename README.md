# Parlement ouvert — questions et réponses du Parlement bruxellois

Application web où chacun peut poser une question et obtenir une réponse fondée sur
les questions écrites et les réponses publiées par le Parlement de la Région de
Bruxelles-Capitale. Chaque réponse cite ses sources, avec leur date et le lien
vers la fiche officielle.

> **Initiative indépendante.** Ce service ne représente pas le Parlement. Le corpus
> est limité : une absence de résultat ne prouve pas qu'un sujet n'a jamais été
> traité, et une réponse ancienne ne décrit pas forcément la situation actuelle.

## Fonctionnement

1. Les fiches officielles sont collectées, puis découpées en passages.
2. La recherche sélectionne les passages pertinents pour la question.
3. Deux modes :
   - **extraits** (par défaut, sans clé API) : affichage des passages exacts ;
   - **synthèse IA** (`AI_ENABLED=true`) : OpenAI rédige une réponse à partir des
     passages ; chaque référence est vérifiée avant affichage, et en cas d'échec
     l'application revient aux extraits.

Sans Supabase, l'application utilise l'échantillon local `web/data/corpus.json`.
Avec Supabase, elle interroge le corpus actif (recherche plein texte et vectorielle).

## Corpus et actualisation

Au 1er octobre 2026, **12 626 fiches** (39 071 passages) sont en ligne :

| Législature | Couverture | Fiches |
|---|---|---|
| 2024-2029 | complète | 2 578 |
| 2019-2024 | complète (chargée en entier le 1er octobre 2026) | 10 048 |

Douze fiches de 2019-2024 restent à l'écart : leur page n'a pas de texte de question.
Le détail des étapes de croissance du corpus est dans
[web/HISTORIQUE_CORPUS.md](web/HISTORIQUE_CORPUS.md).

D'autres législatures ou sélections peuvent être ajoutées par **sélection
thématique**, sans charger la législature entière : voir
[web/ACTUALISATION.md](web/ACTUALISATION.md).

Le workflow `.github/workflows/refresh.yml` actualise le corpus :

- **chaque lundi** à 04:20 UTC, une fois la variable de dépôt
  `CORPUS_REFRESH_ENABLED` passée à `true` ;
- **à la demande** : Actions → Refresh parliamentary corpus → *Run workflow*
  (et non *Re-run*, qui rejoue l'ancien code), champ `expand` = nombre de questions
  à ajouter (300 par défaut, 800 au plus, 0 pour actualiser seulement).

Chaque exécution revérifie les fiches susceptibles d'avoir changé, ajoute les
questions absentes, puis n'envoie à OpenAI que les fiches nouvelles ou modifiées
(plafond : 100 appels et 3 Mo de texte). Une page du Parlement injoignable est
reportée à l'exécution suivante ; si le site est en panne, l'exécution s'arrête
sans toucher au corpus en ligne. La nouvelle version n'est activée qu'après un
import complet, et les deux précédentes sont conservées pour un retour arrière.

### Stockage

Depuis la migration 005, chaque fiche n'est stockée qu'une fois, quelle que soit la
version qui l'utilise. Mesure du 1er octobre 2026, avec 12 626 fiches et 39 071
passages dans la version active :

| Élément | Taille |
|---|---|
| `document_passages` (passages, vecteurs et index) | 402 Mo |
| `question_documents` (fiches complètes) | 46 Mo |
| `version_questions` (liste des fiches de chaque version) | 12 Mo |
| `corpus_versions` et `quotas` | moins de 0,2 Mo |
| **Base complète** | **471 Mo** |

- Une fiche coûte environ **36 ko**, index compris (les trois tables du corpus, soit
  460 Mo, divisées par 12 626 fiches), soit environ 10,5 ko par passage. La mesure du
  25 septembre 2026 donnait 69 ko : l'écart vient probablement de la suppression de
  l'index vectoriel HNSW inutilisé par la migration 009, non remesuré séparément.
- Ces tailles comptent tout ce qui est stocké, y compris les contenus des versions de
  retour arrière encore conservées ; leur coût propre se mesure avec la dernière requête
  ci-dessous (non remesuré le 1er octobre).
- Projection : environ **546 Mo** au plafond de 15 000 fiches (environ 36 ko par fiche),
  soit environ 75 Mo de plus qu'aujourd'hui. La limite de l'offre Free (500 Mo) est
  dépassée depuis le passage à l'offre Pro : vérifier le quota de disque dans
  *Settings → Usage* de Supabase.

Pour mesurer la place occupée, dans l'éditeur SQL de Supabase :

```sql
-- Taille totale de la base
select pg_size_pretty(pg_database_size(current_database())) as taille_base;

-- Répartition par table (données + index)
select relname as table_name,
       pg_size_pretty(pg_total_relation_size(relid)) as taille_totale
from pg_catalog.pg_statio_user_tables
where schemaname = 'public'
order by pg_total_relation_size(relid) desc;

-- Poids de chaque version (hors index) ; « propres » : passages qu'aucune autre
-- version n'utilise, c'est-à-dire ce que la version coûte réellement
with partage as (
  select content_hash, count(*) as nb_versions
  from version_questions
  group by content_hash
)
select v.id, v.active, v.activation_unknown, v.count as fiches,
       pg_size_pretty(sum(pg_column_size(p.*))) as passages,
       pg_size_pretty(coalesce(sum(pg_column_size(p.*)) filter (where s.nb_versions = 1), 0)) as propres
from corpus_versions v
join version_questions vq on vq.version_id = v.id
join partage s on s.content_hash = vq.content_hash
join document_passages p on p.content_hash = vq.content_hash
group by v.id, v.active, v.activation_unknown, v.count, v.created_at
order by v.created_at desc;
```

Détails dans [web/ACTUALISATION.md](web/ACTUALISATION.md).

## Organisation du dépôt

| Emplacement | Contenu |
|---|---|
| `web/` | Application Next.js / React / TypeScript |
| `web/src/app/` | Page d'accueil et routes serveur (`/api/chat`, `/api/health`) |
| `web/src/components/` | Interface du chat |
| `web/src/lib/` | Recherche, génération, quotas, schémas et client de l'API |
| `web/supabase/tests/` | Tests SQL des migrations 008 et 010, rejoués par la CI sur une base pgvector jetable (`run.sh`, jamais sur Supabase) |
| `web/supabase/migrations/` | Schéma PostgreSQL, à appliquer dans l'ordre (001 → 010) |
| `web/scripts/` | Import, export et actualisation du corpus, audit de la recherche |
| `web/tests/` | Tests unitaires (`node:test`) et de navigateur (Playwright) |
| `web/data/` | Corpus d'échantillon et copies des pages collectées |
| `.github/workflows/` | Vérifications automatiques (`check.yml`) et actualisation du corpus (`refresh.yml`) |
| Racine | Échantillon initial de dix questions et son extraction (voir [LISEZMOI.md](LISEZMOI.md)) |

## Démarrage rapide

Prérequis : Node.js 22 ou plus récent. Python 3 seulement pour les scripts de collecte.

```powershell
cd web
npm ci
npm run dev
```

Ouvrez ensuite http://127.0.0.1:3000. Sans configuration, l'application fonctionne
en mode extraits sur l'échantillon local.

Pour Supabase ou OpenAI, copiez `web/.env.example` en `web/.env.local` et
renseignez les valeurs. Ne publiez jamais ce fichier. `npm run check:config`
indique ce qui manque sans afficher les secrets.

## Commandes

À lancer dans `web/` :

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` puis `npm run start` | Version de production locale |
| `npm test` | Tests unitaires |
| `npm run test:e2e` | Tests de navigateur Playwright (desktop et mobile) |
| `npm run typecheck` | Contrôle TypeScript, scripts et tests compris |
| `npm run lint` / `npm run format` | Contrôle et formatage Biome |
| `npm run check:config` | Vérifie la présence des variables d'environnement |
| `npm run import:data -- --validate-only` | Valide un corpus sans rien importer |
| `npm run import:data` | Importe et active un corpus dans Supabase (appels OpenAI facturés) |
| `npm run export:data` | Exporte le corpus actif de Supabase |
| `npm run audit:search` | Rejoue les cas de référence de la recherche (`scripts/search-cases.ts`) : rang, MRR, écarts connus. `--case=<id>` pour un seul cas, `--remote` sur Supabase, `--ai` avec synthèse (facturée) |
| `python scripts/test-collector.py` | Teste le collecteur Python |

Sous Windows PowerShell, si `npm` est bloqué par la stratégie d'exécution, utilisez `npm.cmd`.

La CI (`.github/workflows/check.yml`) lance Biome, le contrôle TypeScript, les tests
unitaires, la validation du corpus, les cas de recherche (`audit:search` sur
`data/corpus-refreshed.json`), le build et les tests Playwright, sans Supabase ni OpenAI.
Un second job rejoue les migrations et leurs tests SQL sur une base PostgreSQL et pgvector
jetable. Les migrations 010 et suivantes inscrivent leur numéro dans `schema_migrations` :
`/api/health` compare la version lue en base (`schema`) à celle qu'attend le code
(`schemaExpected`).

## Documentation

| Document | Contenu |
|---|---|
| [LISEZMOI.md](LISEZMOI.md) | Sources officielles, décomptes de l'index et méthode d'échantillonnage |
| [web/DEPLOIEMENT.md](web/DEPLOIEMENT.md) | Publication d'une version de test sur Vercel |
| [web/ACTUALISATION.md](web/ACTUALISATION.md) | Actualisation hebdomadaire, rattrapage, plafonds, stockage et conservation des versions |
| [GUIDE_ASSISTANT_QUESTIONS_REPONSES.md](GUIDE_ASSISTANT_QUESTIONS_REPONSES.md) | Étapes d'import et d'association question → réponses, pour construire un assistant similaire sur une autre source |
| [ANALYSE_ET_STATUT_DU_PROJET.md](ANALYSE_ET_STATUT_DU_PROJET.md) | Architecture, historique et limites avant ouverture au public |

## Contribuer

- Le code est formaté par Biome et les fins de ligne sont en LF (`.gitattributes`),
  y compris sous Windows.
- `git config blame.ignoreRevsFile .git-blame-ignore-revs` fait ignorer à
  `git blame` le commit de formatage.
- Toute modification du schéma passe par une nouvelle migration numérotée dans
  `web/supabase/migrations/`, suivie de la mise à jour de `web/src/lib/database.types.ts`.

## Licence

Le code est distribué sous licence [MIT](LICENSE).

Cette licence ne couvre pas les documents parlementaires conservés dans le dépôt :
questions, réponses, index et copies de pages officielles (`sources/`,
`liste_source.html`, `question_source.html`, `source_test.html`,
`index_officiel_24-29.json`, `echantillon_questions_reponses.json`, `web/data/`).
Ils proviennent du site du Parlement de la Région de Bruxelles-Capitale et restent
soumis à ses conditions de réutilisation.
