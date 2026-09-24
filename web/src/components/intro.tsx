import { ArrowUpRight, Check, FileText, ShieldCheck } from "lucide-react";

const suggestions = [
  { label: "Mobilité", text: "Que fait la STIB en cas de forte chaleur ?", icon: "01" },
  { label: "Vie démocratique", text: "Comment les expatriés sont-ils informés de leur droit de vote ?", icon: "02" },
  { label: "Environnement", text: "Que prévoit clean.brussels pour réduire les emballages ?", icon: "03" },
];

export function Intro({ busy, onAsk }: { busy: boolean; onAsk: (question: string) => void }) {
  return (
    <>
      <div className="intro">
        <div className="eyebrow">
          <span /> COMPRENDRE LA VIE PUBLIQUE BRUXELLOISE
        </div>
        <h1>
          Vos questions.
          <br />
          <em>Des sources pour y répondre.</em>
        </h1>
        <p>
          Explorez les réponses du Parlement bruxellois.
          <br className="desktop-break" /> Posez votre question, retrouvez les documents et vérifiez les sources.
        </p>
      </div>
      <div className="suggestions-label">POUR COMMENCER</div>
      <div className="suggestions">
        {suggestions.map(s => (
          <button type="button" key={s.icon} onClick={() => onAsk(s.text)} disabled={busy}>
            <span className="suggestion-top">
              <span>{s.label}</span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </span>
            <strong>{s.text}</strong>
            <span className="suggestion-index">{s.icon}</span>
          </button>
        ))}
      </div>
      <div className="trust-row">
        <span>
          <FileText size={15} aria-hidden="true" /> Documents officiels
        </span>
        <span>
          <ShieldCheck size={16} aria-hidden="true" /> Sources vérifiables
        </span>
        <span>
          <Check size={15} aria-hidden="true" /> Sans inscription
        </span>
      </div>
    </>
  );
}
