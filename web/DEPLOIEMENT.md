# Publier une version de test sur Vercel

Ce guide utilise le dossier local à jour : aucun envoi GitHub n'est nécessaire.
Le site utilise le corpus déjà actif dans Supabase. Ne relancez pas l'importation.

## 1. Connecter le dossier à Vercel

Ouvrez une deuxième fenêtre PowerShell :

```powershell
cd "<dossier du dépôt>\web"
npx.cmd vercel login
npx.cmd vercel link
```

La première commande Vercel peut proposer son installation : acceptez.
Connectez-vous dans le navigateur. Pour `link`, sélectionnez votre compte,
créez un projet (par exemple `parlement-citoyen-test` si disponible), et utilisez
le dossier courant `./`. Choisissez Next.js si le framework est demandé.

## 2. Configurer les variables sur le site Vercel

Dans le projet : Settings → Environment Variables. Sélectionnez **Preview**.
Copiez les valeurs directement depuis `.env.local`, sans les transmettre dans un chat.

| Nom | Valeur |
| --- | --- |
| SUPABASE_URL | Même URL que dans `.env.local` |
| SUPABASE_SECRET_KEY | Même clé serveur que dans `.env.local` |
| OPENAI_API_KEY | Même clé que dans `.env.local` |
| QUOTA_SECRET | Même secret aléatoire de 32 caractères minimum que dans `.env.local` |
| AI_ENABLED | true |
| CHAT_MODEL | gpt-5-mini |
| EMBEDDING_MODEL | text-embedding-3-small |
| DAILY_AI_REQUEST_LIMIT | 100 |
| AI_IP_DAILY_LIMIT | 10 |
| SESSION_HOURLY_REQUEST_LIMIT | 20 |

Ne préfixez aucun secret par NEXT_PUBLIC_. Ne copiez pas APP_ORIGIN=http://localhost:3000.
L'adresse exacte du déploiement est autorisée automatiquement grâce à VERCEL_URL.
Pour un futur domaine personnalisé, renseignez APP_ORIGIN avec son origine HTTPS.
Les quotas limitent des nombres de demandes, pas une somme en euros. Cette version
partage le corpus et les compteurs Supabase avec le site local.

Dans Settings → Deployment Protection, conservez la protection d'accès de la
version de test si elle est disponible et invitez les testeurs avec les options
proposées par Vercel. Vérifiez les conditions du plan choisi avant de le valider.

## 3. Déployer la version de test

Dans le même dossier PowerShell :

```powershell
npx.cmd vercel deploy
```

N'ajoutez pas --prod : il s'agit d'une version Preview.
La commande téléverse le code local et donne l'URL de test. Les secrets sont
fournis par les variables du projet, et non téléversés avec `.env.local`.
Aucune modification de tables Supabase n'est requise.

## 4. Vérifier le résultat

Ouvrez l'URL fournie, authentifiez-vous si la protection le demande, puis vérifiez :

- 106 questions et 94 réponses disponibles (ou les nouveaux chiffres du corpus actif) ;
- `/api/health` : status ok, documents 106, answers 94, mode ia ;
- une question connue, puis une relance ;
- un sujet absent ;
- les liens officiels et l'affichage sur téléphone.

Après une modification de variable, relancez `npx.cmd vercel deploy`.
En cas d'erreur, transmettre uniquement le message, sans les valeurs des secrets.

Documentation : https://vercel.com/docs/projects/deploy-from-cli

## Site actuellement publié en Production

Le domaine https://parlement-citoyen-test.vercel.app utilise l'environnement
**Production**. Pour le mettre à jour, configurez les mêmes variables dans
Production et définissez :

```dotenv
APP_ORIGIN=https://parlement-citoyen-test.vercel.app
```

Après modification des variables, redéployez depuis Vercel ou exécutez
`npx.cmd vercel deploy --prod` depuis `web`. Un futur déploiement GitHub doit
utiliser `web` comme Root Directory dans les paramètres du projet Vercel.

## Diagnostiquer une panne ou une lenteur

Chaque question posée au chat écrit une ligne dans Vercel → projet → **Logs**, sans
la question, la réponse ni aucune donnée personnelle : un identifiant aléatoire
(`requestId`, également renvoyé au navigateur en cas d'erreur), un code et la durée
de chaque étape en millisecondes.

```json
{"requestId":"…","code":"CHAT_OK","mode":"ia","status":"documente","ms":{"quota":85,"embedding":420,"search":230,"generation":24800,"total":25600}}
{"requestId":"…","code":"CHAT_UNAVAILABLE","cause":"SEARCH_UNAVAILABLE","ms":{"quota":90,"embedding":400,"search":8000,"total":8500}}
```

| Durée | Étape |
|---|---|
| `quota` | Compteur de questions (Supabase, `reserve_chat_quota`) |
| `embedding` | Vectorisation de la question (OpenAI, mode IA seulement) |
| `search` | Recherche des passages (Supabase, `search_passages`) |
| `generation` | Rédaction de la synthèse (OpenAI, mode IA seulement) |
| `total` | Ensemble de la requête |

En cas d'erreur 503, `cause` indique l'étape en échec :

| Cause | Signification |
|---|---|
| `QUOTA_UNAVAILABLE` | Compteur de questions injoignable ou en erreur (Supabase) |
| `SEARCH_UNAVAILABLE` | Recherche en erreur (Supabase) |
| `CONFIGURATION` | Mode IA sans Supabase ou avec un `QUOTA_SECRET` de moins de 32 caractères |
| `UNEXPECTED` | Autre erreur, par exemple une fiche renvoyée dans un format inattendu |

Une étape absente de `ms` n'a pas été atteinte. Un échec d'OpenAI ne provoque pas de
503 : la vectorisation manquante est notée `EMBEDDING_UNAVAILABLE` et la recherche se
fait par mots ; une synthèse en échec est notée `AI_TIMEOUT`, `AI_API_ERROR`… et
l'application affiche les extraits.
