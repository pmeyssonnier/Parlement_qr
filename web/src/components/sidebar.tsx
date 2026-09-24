import { ArrowUpRight, BookOpen, Landmark, Plus, Search } from "lucide-react";
import { dateLabel } from "@/lib/format";
import { type CorpusSummary, isDemoCorpus, type Panel } from "./types";

export function Sidebar({
  corpus,
  visible,
  busy,
  onReset,
  onAsk,
  onOpenPanel,
}: {
  corpus: CorpusSummary;
  visible: boolean;
  busy: boolean;
  onReset: () => void;
  onAsk: () => void;
  onOpenPanel: (panel: Panel) => void;
}) {
  return (
    <aside className={`sidebar ${visible ? "visible" : ""}`} aria-label="Navigation principale">
      <a href="/" className="brand">
        <span className="brand-mark">
          <Landmark size={23} aria-hidden="true" />
        </span>
        <span>
          Parlement
          <span className="brand-light">
            ouvert<span className="brand-dot">.</span>
          </span>
        </span>
      </a>
      <div className="sidebar-caption">BRUXELLES · INFORMATION CITOYENNE</div>
      <button type="button" className="new-chat" onClick={onReset} disabled={busy}>
        <Plus size={17} aria-hidden="true" /> Nouvelle conversation
      </button>
      <div className="nav-label">VOTRE ESPACE</div>
      <button type="button" className="nav-item active" onClick={onAsk}>
        <Search size={17} aria-hidden="true" /> Poser une question <span className="nav-dot" />
      </button>
      <button type="button" className="nav-item" onClick={() => onOpenPanel("method")}>
        <BookOpen size={17} aria-hidden="true" /> Sources et méthode
      </button>
      <a
        className="nav-item"
        href="https://www.parlement.brussels/interpellations-et-questions/"
        target="_blank"
        rel="noreferrer"
      >
        <Landmark size={17} aria-hidden="true" /> Le Parlement <ArrowUpRight size={14} aria-hidden="true" />
      </a>
      <div className="sidebar-bottom">
        <div className="corpus-card">
          <span className="live-label">
            <span /> CORPUS DISPONIBLE
          </span>
          <strong>{corpus.count} questions écrites</strong>
          <p>
            <b>{corpus.answerCount} réponses disponibles</b>
          </p>
          <p>{isDemoCorpus(corpus) ? "Échantillon exploratoire · Français" : "Documents parlementaires · Français"}</p>
          <small>Collecte du {dateLabel(corpus.extractedAt.slice(0, 10))}</small>
        </div>
        <p className="independent">
          Une initiative indépendante.
          <br />
          Ce service ne représente pas le Parlement.
        </p>
        <button type="button" className="privacy-button" onClick={() => onOpenPanel("privacy")}>
          Confidentialité
        </button>
      </div>
    </aside>
  );
}
