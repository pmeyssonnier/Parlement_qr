"use client";
import { Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { askQuestion, failureMessage } from "@/lib/api-client";
import { MAX_HISTORY, MAX_QUESTION_LENGTH, MIN_QUESTION_LENGTH } from "@/lib/limits";
import { Composer } from "./composer";
import { Conversation, type Turn } from "./conversation";
import { InfoDialog } from "./info-dialog";
import { Intro } from "./intro";
import { Sidebar } from "./sidebar";
import { type CorpusSummary, isDemoCorpus, type Panel } from "./types";

/** Client timeout, just under the route's maxDuration (60 s). */
const REQUEST_TIMEOUT_MS = 55000;

export function Chat({ corpus }: { corpus: CorpusSummary }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function send(text = input) {
    const message = text.trim();
    if (busy || message.length < MIN_QUESTION_LENGTH || message.length > MAX_QUESTION_LENGTH) return;
    const id = crypto.randomUUID();
    const history = turns.slice(-MAX_HISTORY).map(t => ({ role: "user" as const, content: t.question }));
    setTurns(prev => [...prev, { id, question: message }]);
    setInput("");
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await askQuestion(message, history, abort.signal);
      setTurns(prev => prev.map(t => (t.id === id ? { ...t, response } : t)));
    } catch (error) {
      setTurns(prev => prev.map(t => (t.id === id ? { ...t, error: failureMessage(error) } : t)));
    } finally {
      clearTimeout(timer);
      setBusy(false);
      textarea.current?.focus();
    }
  }
  function reset() {
    if (busy) return;
    setTurns([]);
    setInput("");
    setMobileNav(false);
    textarea.current?.focus();
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Aller au chat
      </a>
      <Sidebar
        corpus={corpus}
        visible={mobileNav}
        busy={busy}
        onReset={reset}
        onAsk={() => {
          setPanel(null);
          setMobileNav(false);
        }}
        onOpenPanel={setPanel}
      />
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
          <span className="version-badge">{isDemoCorpus(corpus) ? "VERSION DÉMONSTRATION" : "VERSION BÊTA"}</span>
        </header>
        <main id="main" className={turns.length ? "workspace conversation" : "workspace"}>
          {turns.length ? <Conversation turns={turns} busy={busy} /> : <Intro busy={busy} onAsk={send} />}
          <Composer
            corpus={corpus}
            input={input}
            busy={busy}
            textareaRef={textarea}
            onChange={setInput}
            onSend={() => send()}
            onShowScope={() => setPanel("method")}
          />
        </main>
        <footer className="footer">
          <span>Des réponses à lire. Des sources à vérifier.</span>
          <span>Parlement de la Région de Bruxelles-Capitale</span>
        </footer>
      </div>
      {panel && <InfoDialog panel={panel} corpus={corpus} close={() => setPanel(null)} />}
    </div>
  );
}
