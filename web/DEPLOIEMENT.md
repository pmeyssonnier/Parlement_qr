# Publier une version de test sur Vercel

Ce guide utilise le dossier local à jour : aucun envoi GitHub n'est nécessaire.
Le site utilise le corpus déjà actif dans Supabase. Ne relancez pas l'importation.

## 1. Connecter le dossier à Vercel

Ouvrez une deuxième fenêtre PowerShell :

```powershell
cd "C:\Users\pmeys\OneDrive\Documents\ChatGPT\R Parlement bruxellois\web"
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
