import { ArrowUp, Mic } from "lucide-react";
import { type RefObject, useEffect } from "react";
import { MAX_QUESTION_LENGTH, MIN_QUESTION_LENGTH } from "@/lib/limits";
import type { CorpusSummary } from "./types";
import { useDictation } from "./use-dictation";

export function Composer({
  corpus,
  input,
  busy,
  textareaRef,
  onChange,
  onSend,
  onShowScope,
}: {
  corpus: CorpusSummary;
  input: string;
  busy: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onSend: () => void;
  onShowScope: () => void;
}) {
  const dictation = useDictation(input, onChange);
  const { cancel } = dictation;
  // A question being answered is no longer dictated into.
  useEffect(() => {
    if (busy) cancel();
  }, [busy, cancel]);
  const send = () => {
    cancel();
    onSend();
  };
  return (
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
          ref={textareaRef}
          id="question"
          placeholder="Que souhaitez-vous savoir sur Bruxelles ?"
          value={input}
          maxLength={MAX_QUESTION_LENGTH}
          rows={2}
          onChange={e => onChange(e.target.value)}
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
            {corpus.ai ? "Réponses avec références" : "Recherche et extraits officiels"}
          </span>
          <div>
            <span className="character-count">{input.length}/1 500</span>
            {dictation.supported && (
              <button
                type="button"
                className={`mic${dictation.listening ? " listening" : ""}`}
                onClick={dictation.toggle}
                disabled={busy}
                aria-pressed={dictation.listening}
                aria-label="Dicter votre question"
                title="Dicter votre question (transcrite par votre navigateur)"
              >
                <Mic size={18} aria-hidden="true" />
              </button>
            )}
            <button
              className="send"
              type="submit"
              disabled={busy || input.trim().length < MIN_QUESTION_LENGTH}
              aria-label="Envoyer la question"
            >
              <ArrowUp size={20} />
            </button>
          </div>
        </div>
      </form>
      <p className="dictation-status" role="status">
        {dictation.listening ? "Je vous écoute… Parlez, puis touchez le micro pour arrêter." : dictation.message}
      </p>
      <p className="scope-note">
        {corpus.count} questions · {corpus.answerCount} réponses disponibles. Ce corpus ne couvre pas tous les travaux
        parlementaires.{" "}
        <button type="button" onClick={onShowScope}>
          Voir le périmètre
        </button>
      </p>
    </div>
  );
}
