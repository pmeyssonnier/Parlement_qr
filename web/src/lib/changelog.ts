// Update history shown in the « Nouveautés » panel, newest first. Reader-facing
// wording: what changed for someone using the site, not how it was built.
// Add an entry at the top for every visible change (tests/changelog.test.ts
// checks the shape and the order).
export type Release = {
  /** ISO date (yyyy-mm-dd) of the release. */
  date: string;
  title: string;
  items: string[];
};

export const CHANGELOG: Release[] = [
  {
    date: "2026-10-01",
    title: "Législature 2019-2024 : le corpus s’agrandit",
    items: [
      "Les questions écrites de la législature 2019-2024 sont ajoutées par étapes, des plus récentes aux plus anciennes : le corpus dépasse désormais 11 000 questions.",
      "La mention « Documents jusqu’au… » du menu indique jusqu’où vont les documents consultables.",
    ],
  },
  {
    date: "2026-09-30",
    title: "Mode sombre",
    items: ["Un interrupteur dans l’en-tête permet de choisir l’affichage clair ou sombre."],
  },
  {
    date: "2026-09-29",
    title: "Dictée vocale et fiabilité",
    items: [
      "Un bouton micro permet de dicter sa question avant de l’envoyer (la transcription est faite par votre navigateur).",
      "Le menu affiche la date du document le plus récent du corpus.",
      "Si une réponse échoue sans rien produire, votre question n’est plus décomptée de votre quota.",
    ],
  },
  {
    date: "2026-09-28",
    title: "Sources plus précises",
    items: [
      "Les sources sont regroupées par fiche officielle, avec des extraits ciblés et davantage de contexte pour la synthèse.",
      "Quand la synthèse par IA n’est pas disponible, le service affiche les extraits exacts des documents.",
    ],
  },
  {
    date: "2026-09-25",
    title: "Recherche améliorée et export des réponses",
    items: [
      "La recherche ignore les accents, tient compte de la rareté des mots et sépare les mots reliés par un point (par exemple clean.brussels).",
      "La fiche classée première est présentée avec deux passages au lieu d’un.",
      "La durée de la réponse est affichée, et une réponse peut être exportée en fichier HTML.",
      "Une sélection de questions de la législature 2019-2024 (Schaerbeek) rejoint le corpus.",
    ],
  },
  {
    date: "2026-09-24",
    title: "Lancement de Parlement ouvert",
    items: [
      "Interrogation des questions écrites et des réponses des ministres du Parlement bruxellois, avec renvoi vers chaque fiche officielle.",
      "Corpus de la législature 2024-2029, actualisé chaque semaine.",
    ],
  },
];
