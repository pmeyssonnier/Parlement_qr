"use client";
import {
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  Landmark,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { dateLabel, shortTitle } from "@/lib/format";
import type { ChatResponse, Source } from "@/lib/schema";

type Turn = { id: string; question: string; response?: ChatResponse; error?: string };
const suggestions = [
  { label: "Mobilité", text: "Que fait la STIB en cas de forte chaleur ?", icon: "01" },
  { label: "Vie démocratique", text: "Comment les expatriés sont-ils informés de leur droit de vote ?", icon: "02" },
  { label: "Environnement", text: "Que prévoit clean.brussels pour réduire les emballages ?", icon: "03" },
];

class ServiceError extends Error {}
function errorMessage(data: unknown) {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "Le service est indisponible.";
}
// Lightweight shape check: zod (chatResponseSchema) stays server-side.
function isChatResponse(data: unknown): data is ChatResponse {
  if (!data || typeof data !== "object") return false;
  const r = data as Record<string, unknown>;
  return (
    (r.mode === "ia" || r.mode === "extraits") &&
    (r.status === "documente" || r.status === "insuffisant") &&
    Array.isArray(r.paragraphs) &&
    Array.isArray(r.sources) &&
    typeof r.notice === "string"
  );
}
function SourceCard({ source, index }: { source: Source; index: number }) {
  return (
    <details className="source-card">
      <summary>
        <span className="source-number">{index + 1}</span>
        <span>
          <strong>{shortTitle(source.title)}</strong>
          <small>
            {source.author} · {dateLabel(source.date)}
          </small>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="source-expanded">
        <p className="recipient">{source.recipient}</p>
        {source.nature === "incompetence" && (
          <p className="warning">Cette réponse indique une absence de compétence du destinataire.</p>
        )}
        <blockquote>{source.excerpt}</blockquote>
        <a href={source.url} target="_blank" rel="noreferrer">
          Lire la fiche officielle <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </details>
  );
}
function Answer({ response }: { response: ChatResponse }) {
  const { mode, paragraphs, sources, notice } = response;
  return (
    <div className="answer">
      <div className="answer-label">
        <span className="mini-brand">
          <Landmark size={15} />
        </span>
        {mode === "ia" ? "SYNTHÈSE DOCUMENTÉE" : "DANS LES DOCUMENTS"}
      </div>
      {paragraphs.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs of a response are immutable and never reordered
        <div key={i} className="answer-paragraph">
          <p>
            {p.text}
            {mode === "ia" &&
              p.sourceIds.map(id => (
                <span className="citation" key={id}>
                  [{sources.findIndex(s => s.id === id) + 1}]
                </span>
              ))}
          </p>
          {mode === "extraits" &&
            p.sourceIds.map(id => <blockquote key={id}>{sources.find(s => s.id === id)?.excerpt}</blockquote>)}
        </div>
      ))}
      {sources.length > 0 && (
        <div className="sources">
          <h3>
            <BookOpen size={15} /> Sources utilisées
          </h3>
          {sources.map((s, i) => (
            <SourceCard key={s.id} source={s} index={i} />
          ))}
        </div>
      )}
      <p className="answer-notice">{notice}</p>
    </div>
  );
}
export function Chat({
  count,
  answerCount,
  extractedAt,
  method,
  ai,
}: {
  count: number;
  answerCount: number;
  extractedAt: string;
  method: string;
  ai: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [panel, setPanel] = useState<"method" | "privacy" | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const controller = useRef<AbortController | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll again whenever a turn or the loading indicator appears
  useEffect(() => {
    if (turns.length) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);
  useEffect(() => () => controller.current?.abort(), []);
  async function send(text = input) {
    const message = text.trim();
    if (busy || message.length < 3 || message.length > 1500) return;
    const id = crypto.randomUUID();
    const history = turns.slice(-4).map(t => ({ role: "user", content: t.question }));
    setTurns(prev => [...prev, { id, question: message }]);
    setInput("");
    setBusy(true);
    controller.current = new AbortController();
    const timer = setTimeout(() => controller.current?.abort(), 55000);
    try {
      const result = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
        signal: controller.current.signal,
      });
      // A platform error page (502, 504…) is HTML: never show a JSON parse error.
      const data: unknown = await result.json().catch(() => null);
      if (!result.ok || !isChatResponse(data)) throw new ServiceError(errorMessage(data));
      setTurns(prev => prev.map(t => (t.id === id ? { ...t, response: data } : t)));
    } catch (error) {
      const message =
        error instanceof ServiceError
          ? error.message
          : error instanceof Error && error.name === "AbortError"
            ? "La recherche a pris trop de temps. Réessayez dans un instant."
            : "Le service est indisponible. Vérifiez votre connexion et réessayez.";
      setTurns(prev => prev.map(t => (t.id === id ? { ...t, error: message } : t)));
    } finally {
      clearTimeout(timer);
      setBusy(false);
      textarea.current?.focus();
    }
  }
  function reset() {
    if (!busy) {
      setTurns([]);
      setInput("");
      setMobileNav(false);
      textarea.current?.focus();
    }
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Aller au chat
      </a>
      <aside className={`sidebar ${mobileNav ? "visible" : ""}`} aria-label="Navigation principale">
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
        <button type="button" className="new-chat" onClick={reset} disabled={busy}>
          <Plus size={17} aria-hidden="true" /> Nouvelle conversation
        </button>
        <div className="nav-label">VOTRE ESPACE</div>
        <button
          type="button"
          className="nav-item active"
          onClick={() => {
            setPanel(null);
            setMobileNav(false);
          }}
        >
          <Search size={17} aria-hidden="true" /> Poser une question <span className="nav-dot" />
        </button>
        <button type="button" className="nav-item" onClick={() => setPanel("method")}>
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
            <strong>{count} questions écrites</strong>
            <p>
              <b>{answerCount} réponses disponibles</b>
            </p>
            <p>{count === 10 ? "Échantillon exploratoire · Français" : "Documents parlementaires · Français"}</p>
            <small>Collecte du {dateLabel(extractedAt.slice(0, 10))}</small>
          </div>
          <p className="independent">
            Une initiative indépendante.
            <br />
            Ce service ne représente pas le Parlement.
          </p>
          <button type="button" className="privacy-button" onClick={() => setPanel("privacy")}>
            Confidentialité
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              type="button"
              className="mobile-menu"
              onClick={() => setMobileNav(!mobileNav)}
              aria-label="Afficher le menu"
              aria-expanded={mobileNav}
            >
              <Menu size={21} />
            </button>
            <span>Le Parlement, à portée de question</span>
          </div>
          <span className="version-badge">{count === 10 ? "VERSION DÉMONSTRATION" : "VERSION BÊTA"}</span>
        </header>
        <main id="main" className={turns.length ? "workspace conversation" : "workspace"}>
          {!turns.length ? (
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
                  <br className="desktop-break" /> Posez votre question, retrouvez les documents et vérifiez les
                  sources.
                </p>
              </div>
              <div className="suggestions-label">POUR COMMENCER</div>
              <div className="suggestions">
                {suggestions.map(s => (
                  <button type="button" key={s.icon} onClick={() => send(s.text)} disabled={busy}>
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
          ) : (
            <div className="turns">
              {turns.map(turn => (
                <article key={turn.id} className="turn">
                  <div className="user-question">
                    <span>VOUS</span>
                    <h2>{turn.question}</h2>
                  </div>
                  {turn.response && <Answer response={turn.response} />}
                  {turn.error && (
                    <p className="error" role="alert">
                      {turn.error}
                    </p>
                  )}
                </article>
              ))}
              {busy && (
                <div className="loading" role="status">
                  <span className="loading-dot" /> Recherche dans les documents…
                </div>
              )}
              <div ref={bottom} />
            </div>
          )}
          <div className="composer-zone">
            <form
              className="composer"
              onSubmit={e => {
                e.preventDefault();
                send();
              }}
            >
              <label htmlFor="question" className="sr-only">
                Votre question sur les documents parlementaires
              </label>
              <textarea
                ref={textarea}
                id="question"
                placeholder="Que souhaitez-vous savoir sur Bruxelles ?"
                value={input}
                maxLength={1500}
                rows={2}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <div className="composer-bottom">
                <span>
                  <span className="green-dot" />
                  {ai ? "Réponses avec références" : "Recherche et extraits officiels"}
                </span>
                <div>
                  <span className="character-count">{input.length}/1 500</span>
                  <button
                    className="send"
                    type="submit"
                    disabled={busy || input.trim().length < 3}
                    aria-label="Envoyer la question"
                  >
                    <ArrowUp size={20} />
                  </button>
                </div>
              </div>
            </form>
            <p className="scope-note">
              {count} questions · {answerCount} réponses disponibles. Ce corpus ne couvre pas tous les travaux
              parlementaires.{" "}
              <button type="button" onClick={() => setPanel("method")}>
                Voir le périmètre
              </button>
            </p>
          </div>
        </main>
        <footer className="footer">
          <span>Des réponses à lire. Des sources à vérifier.</span>
          <span>Parlement de la Région de Bruxelles-Capitale</span>
        </footer>
      </div>
      {panel && (
        <InfoDialog
          panel={panel}
          close={() => setPanel(null)}
          count={count}
          answerCount={answerCount}
          method={method}
          ai={ai}
        />
      )}
    </div>
  );
}
function InfoDialog({
  panel,
  close,
  count,
  answerCount,
  method,
  ai,
}: {
  panel: "method" | "privacy";
  close: () => void;
  count: number;
  answerCount: number;
  method: string;
  ai: boolean;
}) {
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
      {panel === "method" ? (
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
            Les dates sont celles des documents. Une réponse ancienne ne décrit pas nécessairement la situation
            actuelle. Une réponse d’incompétence ou un renvoi n’apporte pas toujours de réponse sur le fond.
          </p>
          <a href="https://www.parlement.brussels/interpellations-et-questions/" target="_blank" rel="noreferrer">
            Accéder à la source officielle ↗
          </a>
        </>
      ) : (
        <>
          <span className="eyebrow">VOS DONNÉES</span>
          <h2 id="dialog-title">Confidentialité</h2>
          <p>
            Aucun compte n’est nécessaire. La conversation reste en mémoire dans cet onglet et disparaît lorsque vous
            rechargez ou fermez la page.
          </p>
          <p>
            Un cookie de session valable une heure sert à limiter les abus. Les compteurs de limitation ne contiennent
            pas les textes des messages. L’application ne journalise pas le contenu des conversations.
          </p>
          <p>
            {ai
              ? "Pour produire la réponse, votre question, jusqu’à quatre questions précédentes et les extraits sélectionnés sont transmis à OpenAI. Les traitements et journaux des prestataires restent soumis à leurs propres conditions."
              : "La synthèse par IA est désactivée. Votre question est traitée par le serveur pour rechercher les extraits."}
          </p>
          <p>
            Évitez de saisir des données personnelles ou sensibles. Le service fournit une aide documentaire, pas un
            avis juridique personnalisé.
          </p>
        </>
      )}
    </dialog>
  );
}
