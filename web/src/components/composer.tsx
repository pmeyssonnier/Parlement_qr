import { ArrowUp } from "lucide-react";
import type { RefObject } from "react";
import { MAX_QUESTION_LENGTH, MIN_QUESTION_LENGTH } from "@/lib/limits";
import type { CorpusSummary } from "./types";

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
  return (
    <div className="composer-zone">
      <form
        className="composer"
        onSubmit={e => {
          e.preventDefault();
          onSend();
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
              onSend();
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
