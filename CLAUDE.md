# parlement-citoyen-test

## Git / déploiement
- Ne jamais pousser directement sur `main` : travailler sur une branche (la branche `claude/…` attribuée à la session) et passer par une pull request.
- Merger dans `main` une seule fois en fin de session, après validation.
- Seul `main` est déployé par Vercel : aucune autre branche n'a de preview (`git.deploymentEnabled` dans `web/vercel.json`). Chaque push sur `main` déclenche un déploiement.
- Le build est ignoré quand rien n'a changé dans `web/` hors fichiers `.md` et `.claude/` (`ignoreCommand` dans `web/vercel.json`). Si le site se met à lire un dossier hors de `web/`, l'ajouter à cette commande.
