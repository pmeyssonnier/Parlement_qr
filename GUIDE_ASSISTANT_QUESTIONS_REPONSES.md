# Construire un assistant questions-réponses sur une autre source

Ce guide décrit les étapes suivies par l'application **Parlement ouvert** :
1. importer les questions écrites du Parlement bruxellois et leurs réponses ;
2. retrouver les réponses qui correspondent à une question posée dans le chat.

Pour chaque étape, il indique le fichier concerné et ce qu'il faut changer pour
brancher une autre source : un autre parlement, une FAQ, une base documentaire, des
fiches produit…

## Vue d'ensemble

```text
 SOURCE                  IMPORT (1 fois par semaine)                    QUESTION POSÉE (à chaque message)
 ──────                  ───────────────────────────                    ────────────────────────────────
 Index officiel ─┐
 (liste JSON)    │  1. Collecte   2. Fiche      3. Passages   4. Vecteurs      5. Recherche      6. Réponse
                 ├─► pages HTML ─► structurée ─► ≤ 2200 car. ─► OpenAI ───┐     mots + sens   ─► IA avec
 Pages fiches ───┘   (Python)     (JSON)        (découpage)    + Supabase │     (SQL, RRF)       citations
                                                                          └──► passages ──────►  vérifiées
```

| Étape | Fichier | Rôle |
|---|---|---|
| 1. Collecte | `web/scripts/refresh-corpus.py` | Télécharge l'index puis chaque fiche, et produit `corpus-refreshed.json` |
| 2. Format commun | `web/src/lib/schema.ts` | Définit ce qu'est une fiche valide (zod) |
| 3. Découpage | `web/src/lib/documents.ts` | Découpe la question et la réponse en passages |
| 4. Import | `web/scripts/import-data.ts` | Calcule les vecteurs, enregistre dans Supabase et active la nouvelle version |
| 5. Recherche | `web/supabase/migrations/006` et `007` | `search_passages` : associe une question posée aux meilleures réponses |
| 6. Réponse | `web/src/lib/server.ts`, `answer.ts` | Rédige la synthèse et vérifie chaque référence |
| Automatisation | `.github/workflows/refresh.yml` | Enchaîne export, collecte, validation et import chaque semaine |

---

## Étape 1 — Collecter la source

**Fichier :** `web/scripts/refresh-corpus.py` (Python, bibliothèque standard uniquement).

1. **Télécharger l'index.** Le Parlement publie la liste de toutes les questions
   d'une législature dans un fichier JSON :
   `https://www.parlement.brussels/prb_includes/weblex/data/dos_qu_legis_24-29.json`.
   Chaque ligne contient le lien de la fiche (`moncode`), la date de réception, le
   titre FR/NL, l'auteur et le destinataire. Le script garde les questions écrites
   (`r[0] == 'PRB'`, `r[15] == '1'`) et les trie de la plus récente à la plus ancienne.
2. **Télécharger chaque fiche** (`/weblex-quest-det/?moncode=…`), avec une pause de
   0,6 s entre deux pages et 3 tentatives en cas d'erreur réseau.
3. **Extraire les champs** (`parse_record`). La section `weblex-quest-det-fr`
   contient deux cellules, `Question` et `Réponse`. Le HTML est converti en texte :
   suppression des balises, conversion des `<br>` et `</p>` en retours à la ligne,
   décodage des entités. Les dates `JJ/MM/AAAA` sont converties au format ISO.
4. **Calculer une empreinte** (`sha256` de la page) et conserver une **copie
   de la page** dans `data/source-snapshots/<horodatage>/` pour garder une trace.
5. **Mise à jour incrémentale.** Une question sans réponse est revérifiée pendant
   240 jours. Une question qui vient d'obtenir sa réponse est revérifiée pendant
   14 jours. Les plus anciennes le sont par rotation, une semaine sur quatre.
   Plusieurs garde-fous (`--max-downloads`, `--max-network-failures`…) arrêtent
   l'exécution sans rien remplacer si le site change de structure ou devient injoignable.

**À adapter pour une autre source :**
- l'URL de l'index et la façon de lire ses lignes (`index_rows`, `code_of`) ;
- l'extraction des champs dans `parse_record` : c'est la partie spécifique à chaque site ;
- s'il n'existe pas d'index, parcourir un plan de site, une API ou un export CSV.

## Étape 2 — Ramener chaque document au même format

**Fichier :** `web/src/lib/schema.ts` (`questionSchema`, `corpusSchema`).

Toutes les fiches ont la même forme. Le fichier `data/corpus.json` ressemble à ceci :

```json
{
  "extrait_le": "2026-09-24T12:12:28+00:00",
  "nombre_elements": 1,
  "methode_echantillonnage": "Questions écrites PRB. …",
  "questions": [{
    "id": "PRB-1-170644", "moncode": "170644", "base": 1, "assemblee": "PRB",
    "legislature": "2024-2029", "session": "2025-2026", "type": "question_ecrite",
    "numero": 512, "langue": "fr",
    "titre": "La fréquentation du tram 55", "auteur": "…", "destinataire": "…",
    "date_reception": "2026-05-12", "date_publication": null, "date_reponse": "2026-07-01",
    "question": "Texte de la question…",
    "reponse": "Texte de la réponse… (ou null)",
    "url_source": "https://www.parlement.brussels/weblex-quest-det/?moncode=170644&base=1"
  }]
}
```

`validateCorpus` (`documents.ts`) vérifie trois points :
- le décompte annoncé correspond au nombre de fiches ;
- aucun identifiant n'apparaît deux fois ;
- chaque `url_source` pointe vers un domaine officiel (`safeSourceUrl`).

**À adapter :**
- Gardez **au minimum** `id`, `titre`, `question`, `reponse`, `url_source` et une
  date. Les autres champs (auteur, destinataire…) servent à l'affichage et au
  contexte de l'IA.
- Modifiez la liste des domaines autorisés dans `safeSourceUrl`.
- Si votre source n'est pas au format question/réponse (un article, une page de
  FAQ…), mettez l'intitulé dans `question` et le contenu utile dans `reponse`.

## Étape 3 — Découper en passages

**Fichier :** `web/src/lib/documents.ts` (`splitText`, `passages`).

Une réponse ministérielle peut dépasser 20 000 caractères. Le code la découpe
donc en **passages de 2 200 caractères au plus**, en gardant les paragraphes entiers.
Un paragraphe trop long est coupé entre deux mots. Chaque passage reçoit un
identifiant stable :

```text
PRB-1-170644:reponse:0
PRB-1-170644:reponse:1
PRB-1-170644:question:0
```

Au moment de l'import, chaque passage est précédé du contexte de sa fiche. C'est ce
texte qui est vectorisé et indexé :

```text
<titre>
<auteur>
<destinataire>
REPONSE
<texte du passage>
```

Grâce à ce contexte, un passage qui ne répète pas le sujet (« Les chiffres ne
sont pas disponibles… ») reste rattaché à son titre (« tram 55 »).

**À adapter :** la taille (2 200 caractères convient bien à des textes
administratifs) et les lignes d'en-tête (catégorie, produit, date…).

## Étape 4 — Vectoriser et stocker

**Fichiers :** `web/scripts/import-data.ts`, migrations `001` à `005`.

1. **Empreinte du contenu.** Le script calcule le `sha256` de chaque fiche. Si une
   fiche identique est déjà stockée avec ses vecteurs, **elle n'est pas renvoyée à
   OpenAI** (fonction `ready_documents`). Une actualisation hebdomadaire coûte donc
   quelques centimes au plus.
2. **Vecteurs.** Seules les fiches nouvelles ou modifiées sont envoyées au modèle
   OpenAI `text-embedding-3-small` (1 536 dimensions), par lots de 256 textes au plus.
   Un budget maximal (`IMPORT_MAX_EMBEDDING_CALLS`, `IMPORT_MAX_EMBEDDING_BYTES`) est
   vérifié **avant** tout envoi.
3. **Stockage dans Supabase** (PostgreSQL avec l'extension `pgvector`) :

| Table | Contenu |
|---|---|
| `question_documents` | Une ligne par contenu distinct (`content_hash`) avec la fiche complète en JSON |
| `document_passages` | Les passages : `content`, `search_text`, `embedding vector(1536)`, index plein texte et index HNSW |
| `corpus_versions` | Une ligne par import (nombre de fiches, méthode, version active) |
| `version_questions` | La composition de chaque version (fiche → contenu) |

4. **Activation atomique.** La nouvelle version devient active (`activate_corpus`)
   seulement si ses décomptes sont complets. En cas d'échec, la version précédente
   reste en ligne. En plus de la version active, les 2 versions précédentes sont
   conservées pour un retour arrière (`prune_corpus_versions`, `IMPORT_KEEP_VERSIONS`).

**À adapter :** rien dans le principe. Appliquez les migrations dans un nouveau
projet Supabase et gardez le même modèle de vecteurs à l'import et à la recherche.

## Étape 5 — Associer une question posée aux bonnes réponses

C'est le cœur de l'assistant. Côté serveur, `findHits` (`web/src/lib/server.ts`)
prépare la question, puis appelle la fonction SQL `search_passages` (migration 007).

### 5.1 Préparer la question (`web/src/lib/search.ts`)

- **Relance.** Si le message est une relance (« Et pourquoi ? », « selon la réponse
  du ministre… »), `contextualQuery` y ajoute les questions précédentes.
- **Mots-clés** (`lexicalQuery`). Le texte est mis en minuscules, les accents et les
  mots vides (« le », « pour », « question »…) sont retirés, le « s » final est
  supprimé. Quelques synonymes sont ajoutés (« canicule » → chaleur, climatisation ;
  « tram » → STIB, transports). Les mots sont ensuite reliés par `OR`.
- **Vecteur.** La question est vectorisée avec le même modèle que les passages
  (en mode IA seulement).

### 5.2 Classer les fiches (`search_passages`, en SQL)

Seules les fiches **qui ont une réponse** sont prises en compte.

1. **Score par mots (lexical).** Chaque mot de la question pèse selon sa rareté dans
   le corpus (IDF : `ln(1 + N / (1 + nombre de fiches contenant le mot))`). Un mot
   présent dans le **titre compte triple**. Un mot rare comme « tram 55 » l'emporte
   ainsi sur un mot fréquent comme « STIB ».
2. **Score par le sens (sémantique).** On calcule la similarité cosinus entre le
   vecteur de la question et chaque passage de réponse, puis on garde le meilleur
   passage de chaque fiche. Une fiche doit atteindre au moins **0,35**.
3. **Fusion des deux classements (RRF).** Le score final vaut
   `1/(60 + rang lexical) + 1/(60 + rang sémantique)`. On fusionne les rangs et non
   les scores, car les deux échelles ne sont pas comparables. La première fiche de
   chaque classement est toujours retenue.
4. **Choix des passages.** Pour les 6 meilleures fiches, on garde les passages de
   réponse les plus proches du vecteur (ou, à défaut, ceux qui contiennent le plus de
   mots de la question). La première fiche fournit **ses deux meilleurs passages**,
   les suivantes un seul. Le résultat compte 6 passages au plus.

### 5.3 Sans IA (mode extraits)

Quand il n'y a pas de vecteur (quota IA épuisé ou OpenAI indisponible),
`filterLexicalHits` garde uniquement les réponses qui contiennent **au moins 60 %** des
mots significatifs de la question. L'application affiche alors les extraits
officiels tels quels.

**À adapter :**
- les mots vides et les synonymes de `search.ts`, selon votre domaine ;
- la configuration `'french'` de PostgreSQL si la source est dans une autre langue ;
- le seuil de 0,35, à vérifier avec un jeu de questions de test (voir
  `web/scripts/audit-search.ts` et `data/search-audit.json`).

## Étape 6 — Rédiger une réponse qui cite ses sources

**Fichiers :** `web/src/lib/server.ts` (`answer`), `web/src/lib/answer.ts`.

1. Le modèle `gpt-5-mini` reçoit la question, les questions précédentes et les
   6 passages. Chaque passage arrive avec son `sourceId`, son titre, son auteur, sa
   date de réponse et sa **nature** : `fond`, `incompetence`, `renvoi` ou `absente`,
   déterminée par `nature()` dans `documents.ts`.
2. Les **consignes** (`instructions`) sont les suivantes :
   - répondre uniquement à partir des documents fournis ;
   - citer les `sourceIds` de chaque paragraphe ;
   - distinguer le député du ministre ;
   - ne pas présenter une réponse ancienne comme la situation actuelle ;
   - répondre `insuffisant` si aucun extrait ne porte sur le sujet.
3. **Sortie structurée.** Le modèle doit renvoyer un JSON de la forme
   `{status, paragraphs: [{text, sourceIds}], limits}` (`generatedSchema`).
4. **Vérification serveur** (`validateGenerated`). Chaque paragraphe doit citer au
   moins une source, et chaque `sourceId` doit faire partie des passages réellement
   fournis. Sinon, la synthèse est rejetée et l'utilisateur reçoit les extraits
   officiels. **Aucune référence inventée ne peut s'afficher.**
5. Les liens vers les fiches officielles sont construits par le serveur à partir
   de `url_source`, jamais par l'IA.

**À adapter :** le rôle de l'assistant (« assistant documentaire indépendant sur le
Parlement bruxellois »), les règles propres au domaine (bénéficiaires, compétences…)
et, si besoin, la détection de `nature()`.

## Étape 7 — Automatiser l'actualisation

**Fichier :** `.github/workflows/refresh.yml`, documenté dans `web/ACTUALISATION.md`.

Chaque semaine, GitHub Actions enchaîne cinq étapes :
1. `npm run export:data` : export du corpus actif, pour conserver les fiches déjà ajoutées ;
2. `python3 scripts/refresh-corpus.py` : collecte ;
3. `npm run import:data -- --validate-only` : validation sans rien écrire ;
4. `npm run import:data` : import et activation ;
5. publication d'une copie du corpus en artefact.

---

## Liste de contrôle pour une nouvelle source

1. [ ] Vérifier que la source peut être réutilisée (licence, conditions du site,
   fichier `robots.txt`) et fixer un rythme de téléchargement modéré.
2. [ ] Écrire le collecteur : index → fiches → `corpus.json` au format de l'étape 2
   (voir le modèle Python ci-dessous).
3. [ ] Adapter `questionSchema` (`schema.ts`) et `safeSourceUrl` (`documents.ts`).
4. [ ] Créer un projet Supabase et appliquer les migrations `001` à `007` dans l'ordre.
5. [ ] Lancer `npm run import:data -- --file=data/corpus.json --validate-only`, puis
   l'import réel.
6. [ ] Adapter les mots vides et les synonymes (`search.ts`) ainsi que les consignes
   de l'IA (`answer.ts`).
7. [ ] Écrire 15 à 20 questions de test avec la fiche attendue, puis lancer l'audit
   de recherche.
8. [ ] Déployer (voir `web/DEPLOIEMENT.md`) et programmer l'actualisation.

## Modèle de collecteur pour une autre source (Python / Colab)

Ce squelette produit un `corpus.json` compatible avec l'import. Il suffit de
remplir `lister_fiches` et `lire_fiche` pour la nouvelle source.

```python
# Collecteur générique → corpus.json compatible avec web/scripts/import-data.ts
import datetime as dt, html, json, re, time, urllib.request

USER_AGENT = "MonAssistant/0.1 (recherche documentaire)"

def telecharger(url, tentatives=3):
    for i in range(tentatives):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=40) as r:
                texte = r.read().decode("utf-8-sig")
            time.sleep(0.6)                      # rester poli avec le site
            return texte
        except OSError:
            if i == tentatives - 1:
                raise
            time.sleep(2 * 2 ** i)

def nettoyer(fragment_html):
    """HTML → texte, en gardant les paragraphes."""
    t = re.sub(r"<script\b.*?</script>|<style\b.*?</style>|<!--.*?-->", "", fragment_html, flags=re.S)
    t = re.sub(r"<(?:br\b[^>]*|/p|/li|/tr|/div)>", "\n", t, flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", "", t))
    return "\n".join(" ".join(l.split()) for l in t.splitlines() if l.strip())

def lister_fiches():
    """À ADAPTER : renvoie la liste des fiches à collecter (identifiant, URL, métadonnées de l'index)."""
    index = json.loads(telecharger("https://exemple.org/api/index.json"))
    return [{"code": str(r["id"]), "url": r["url"], "titre": r["titre"], "date": r["date"]} for r in index]

def lire_fiche(entree):
    """À ADAPTER : télécharge une fiche et extrait la question et la réponse."""
    page = telecharger(entree["url"])
    q = re.search(r'<div class="question">(.*?)</div>', page, re.S)
    r = re.search(r'<div class="reponse">(.*?)</div>', page, re.S)
    if not q or not nettoyer(q[1]):
        return None                              # fiche sans texte : écartée
    return {
        "id": "SRC-" + entree["code"], "moncode": entree["code"], "base": 1,
        "assemblee": "SRC", "legislature": "2024-2029", "session": None,
        "type": "question_ecrite", "numero": None, "langue": "fr",
        "titre": entree["titre"], "auteur": "", "destinataire": "",
        "date_reception": entree["date"],        # format AAAA-MM-JJ
        "date_publication": None, "date_reponse": None,
        "question": nettoyer(q[1]),
        "reponse": nettoyer(r[1]) if r and nettoyer(r[1]) else None,
        "url_source": entree["url"],
    }

fiches = [f for f in (lire_fiche(e) for e in lister_fiches()[:50]) if f]   # 50 pour un premier essai
corpus = {
    "extrait_le": dt.datetime.now(dt.timezone.utc).isoformat(),
    "nombre_elements": len(fiches),
    "methode_echantillonnage": "Source exemple : 50 fiches les plus récentes.",
    "questions": fiches,
}
with open("corpus.json", "w", encoding="utf-8") as f:
    json.dump(corpus, f, ensure_ascii=False, indent=2)
print(len(fiches), "fiches,", sum(1 for f in fiches if f["reponse"]), "avec réponse")
```

## Prototype rapide dans Colab (avant de tout brancher)

Pour tester l'association question → réponses sur votre source **sans Supabase ni
application web**, voici la même logique en version simplifiée : passages, vecteurs,
similarité, puis réponse citée. La clé OpenAI est lue dans les secrets de Colab
(icône 🔑, nom `OPENAI_API_KEY`) : ne l'écrivez jamais dans le code.

```python
# !pip install openai numpy
import json, numpy as np
from openai import OpenAI
from google.colab import userdata

client = OpenAI(api_key=userdata.get("OPENAI_API_KEY"))
corpus = json.load(open("corpus.json", encoding="utf-8"))

def decouper(texte, maxi=2200):
    parts, cur = [], ""
    for para in filter(None, (texte or "").split("\n")):
        if cur and len(cur) + len(para) + 1 > maxi:
            parts.append(cur); cur = ""
        cur = (cur + "\n" + para) if cur else para
    return parts + ([cur] if cur else [])

# 1. Passages de réponse, précédés du titre (comme search_text)
passages = [{"id": f"{q['id']}:reponse:{i}", "fiche": q, "texte": t}
            for q in corpus["questions"] if q["reponse"]
            for i, t in enumerate(decouper(q["reponse"]))]

# 2. Vecteurs (par lots de 256)
def vecteurs(textes):
    out = []
    for i in range(0, len(textes), 256):
        r = client.embeddings.create(model="text-embedding-3-small", input=textes[i:i+256])
        out += [d.embedding for d in sorted(r.data, key=lambda d: d.index)]
    v = np.array(out); return v / np.linalg.norm(v, axis=1, keepdims=True)

V = vecteurs([f"{p['fiche']['titre']}\nREPONSE\n{p['texte']}" for p in passages])

# 3. Recherche : meilleur passage par fiche, seuil 0,35, 6 fiches au plus
def rechercher(question, n=6, seuil=0.35):
    s = V @ vecteurs([question])[0]
    vus, res = set(), []
    for i in np.argsort(-s):
        fid = passages[i]["fiche"]["id"]
        if s[i] < seuil or len(res) >= n: break
        if fid not in vus:
            vus.add(fid); res.append((float(s[i]), passages[i]))
    return res

# 4. Réponse citée
CONSIGNES = ("Réponds en français, uniquement avec les sources fournies. Termine chaque paragraphe "
             "par ses références [sourceId]. Si aucune source ne répond au sujet, dis-le.")

def repondre(question):
    trouves = rechercher(question)
    if not trouves:
        return "Aucune source suffisamment proche."
    sources = [{"sourceId": p["id"], "titre": p["fiche"]["titre"],
                "date": p["fiche"]["date_reponse"], "texte": p["texte"]} for _, p in trouves]
    r = client.responses.create(model="gpt-5-mini", instructions=CONSIGNES,
                                input=json.dumps({"question": question, "sources": sources}, ensure_ascii=False))
    liens = "\n".join(f"- [{p['id']}] {p['fiche']['titre']} — {p['fiche']['url_source']} (similarité {s:.2f})"
                      for s, p in trouves)
    return r.output_text + "\n\nSources consultées :\n" + liens

print(repondre("Quelle est la fréquentation du tram 55 ?"))
```

Ce prototype ne fait que la recherche par le sens. L'application y ajoute :
- la recherche par mots avec fusion RRF (étape 5.2) ;
- la vérification serveur des références (étape 6) ;
- les quotas ;
- l'actualisation incrémentale.

Une fois les résultats du prototype satisfaisants, reprenez le dépôt et suivez la
liste de contrôle ci-dessus.
