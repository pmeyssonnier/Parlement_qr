import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CorpusSummary, Panel } from "./types";

export function InfoDialog({ panel, corpus, close }: { panel: Panel; corpus: CorpusSummary; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click only; the native dialog closes on Escape via onCancel
    <dialog
      ref={ref}
      className="info-dialog"
      onCancel={close}
      onClick={e => {
        if (e.target === ref.current) close();
      }}
      aria-labelledby="dialog-title"
    >
      <button type="button" className="close-dialog" onClick={close} aria-label="Fermer">
        <X size={20} />
      </button>
      {panel === "method" ? <MethodPanel corpus={corpus} /> : <PrivacyPanel ai={corpus.ai} />}
    </dialog>
  );
}

function MethodPanel({ corpus: { count, answerCount, method, ai } }: { corpus: CorpusSummary }) {
  return (
    <>
      <span className="eyebrow">TRANSPARENCE</span>
      <h2 id="dialog-title">Sources et méthode</h2>
      <p>
        Le corpus contient {count} questions écrites : {answerCount} avec un texte de réponse disponible et{" "}
        {count - answerCount} sans texte de réponse disponible. Les liens vers les fiches officielles permettent de
        vérifier chaque document.
      </p>
      <p>{method}</p>
      <p>
        La recherche sélectionne des passages pertinents.{" "}
        {ai
          ? "Une IA en propose une synthèse ; chaque référence est vérifiée avant affichage. Cette vérification ne garantit pas à elle seule l’exactitude de la synthèse."
          : "Ce mode affiche des extraits exacts, sans rédiger de synthèse par IA."}
      </p>
      <p>
        Les dates sont celles des documents. Une réponse ancienne ne décrit pas nécessairement la situation actuelle.
        Une réponse d’incompétence ou un renvoi n’apporte pas toujours de réponse sur le fond.
      </p>
      <a href="https://www.parlement.brussels/interpellations-et-questions/" target="_blank" rel="noreferrer">
        Accéder à la source officielle ↗
      </a>
    </>
  );
}

function PrivacyPanel({ ai }: { ai: boolean }) {
  return (
    <>
      <span className="eyebrow">VOS DONNÉES</span>
      <h2 id="dialog-title">Confidentialité</h2>
      <p>
        Aucun compte n’est nécessaire. La conversation reste en mémoire dans cet onglet et disparaît lorsque vous
        rechargez ou fermez la page.
      </p>
      <p>
        Un cookie de session valable une heure sert à limiter les abus. Les compteurs de limitation ne contiennent pas
        les textes des messages. L’application ne journalise pas le contenu des conversations.
      </p>
      <p>
        {ai
          ? "Pour produire la réponse, votre question, jusqu’à quatre questions précédentes et les extraits sélectionnés sont transmis à OpenAI. Les traitements et journaux des prestataires restent soumis à leurs propres conditions."
          : "La synthèse par IA est désactivée. Votre question est traitée par le serveur pour rechercher les extraits."}
      </p>
      <p>
        Évitez de saisir des données personnelles ou sensibles. Le service fournit une aide documentaire, pas un avis
        juridique personnalisé.
      </p>
    </>
  );
}
